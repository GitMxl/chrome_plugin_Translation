import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { DEFAULTS, validateSettings, validateText, isTargetLanguage } from '../shared.js';
import { createHistoryStore } from '../history-store.js';
let sequence = 0, onConnect, onMessage;
const saved = {}, ports = [];
const storage = { get: async () => JSON.parse(JSON.stringify(saved)), set: async value => Object.assign(saved, value), setAccessLevel: async () => {} };
const runtime = { id: 'test', getURL: file => 'chrome-extension://test/' + file, onConnect: { addListener: callback => { onConnect = callback; } }, onMessage: { addListener: callback => { onMessage = callback; } }, sendMessage: async () => {}, openOptionsPage: async () => {} };
const context = vm.createContext({ DEFAULTS, validateSettings, validateText, isTargetLanguage,
  createHistoryStore: store => createHistoryStore(store, { makeId: () => `record-${++sequence}` }),
  crypto: { randomUUID: () => `owner-${++sequence}` },
  chrome: { runtime, storage: { local: storage }, tabs: { create: async () => {} } }
});
vm.runInContext((await fs.readFile(new URL('../background.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, ''), context);
function port(url) {
  const messages = [];
  let receive;
  const value = { name: 'translator', sender: { id: 'test', url }, postMessage: message => messages.push(message), onMessage: { addListener: callback => { receive = callback; } }, onDisconnect: { addListener() {} } };
  onConnect(value); ports.push(value);
  return { messages, request: async (command, extra = {}) => { const id = `request-${++sequence}`; await receive({ command, id, ...extra }); return messages.find(message => message.id === id); } };
}
const webpage = port('https://example.test/');
assert.match((await webpage.request('history-list')).error, /设置页/);
const settings = port('chrome-extension://test/options.html#history');
assert.equal((await settings.request('history-list')).result.total, 0);
const original = { source: 'Hello', target: '简体中文', mode: 'local', engine: 'webllm' };
// A trusted worker completion is used here solely to exercise routing/storage.
onMessage({ target: 'clients', owner: 'owner-1', id: 'completed', result: '你好', translationRecord: original }, { id: 'test', url: 'chrome-extension://test/offscreen.html' });
await new Promise(resolve => setImmediate(resolve));
assert.equal((await settings.request('history-list')).result.total, 1);
assert.equal(webpage.messages.find(message => message.id === 'completed').translationRecord, undefined);
onMessage({ target: 'clients', owner: 'owner-1', id: 'forged', result: 'forged', translationRecord: original }, { id: 'test', url: 'https://example.test/' });
await new Promise(resolve => setImmediate(resolve));
assert.equal(webpage.messages.some(message => message.id === 'forged'), false);
await settings.request('history-toggle', { enabled: false });
onMessage({ target: 'clients', owner: 'owner-1', id: 'disabled', result: '世界', translationRecord: { ...original, source: 'World' } }, { id: 'test', url: 'chrome-extension://test/offscreen.html' });
await new Promise(resolve => setImmediate(resolve));
assert.equal((await settings.request('history-list')).result.total, 1);
await settings.request('history-clear');
assert.equal((await settings.request('history-list')).result.total, 0);
await settings.request('history-toggle', { enabled: true });
const originalSet = storage.set;
storage.set = async () => { throw new Error('Disk full'); };
onMessage({ target: 'clients', owner: 'owner-1', id: 'disk-full', result: '你好', translationRecord: original }, { id: 'test', url: 'chrome-extension://test/offscreen.html' });
await new Promise(resolve => setImmediate(resolve));
assert.equal(webpage.messages.find(message => message.id === 'disk-full').result, '你好');
assert.match(webpage.messages.find(message => message.id === 'disk-full').historyError, /保存失败/);
storage.set = originalSet;
saved.settings = { ...DEFAULTS, mode: 'api' };
const changedMode = await webpage.request('translate', { text: 'Page text', pageTranslation: true, settingsSnapshot: { mode: 'local', engine: 'webllm', target: 'auto' } });
assert.match(changedMode.error, /设置已变更/);
console.log('PASS: history permissions, hash-linked settings, trusted completion persistence, opt-out and forged-message rejection.');
