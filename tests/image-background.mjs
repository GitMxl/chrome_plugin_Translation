import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { DEFAULTS, validateSettings, validateText, isTargetLanguage, TARGET_LANGUAGES } from '../shared.js';
import { createHistoryStore } from '../history-store.js';
let connect, captured = 0, serial = 0, switched = false, failOpen = false;
let currentURL = 'https://example.test/';
let installed, menuClick;
const menus = [];
const engineRequests = [];
const pageMessages = [];
const temporary = { 'image-capture-expired': { created: 0, data: 'old' } }, created = [];
const runtime = { id: 'test', getURL: file => 'chrome-extension://test/' + file,
  onConnect: { addListener: listener => { connect = listener; } }, onInstalled: { addListener: listener => { installed = listener; } }, onMessage: { addListener() {} }, getContexts: async () => [{}], sendMessage: async message => { engineRequests.push(message); } };
const context = vm.createContext({ DEFAULTS, validateSettings, validateText, isTargetLanguage, createHistoryStore, Date, encodeURIComponent,
  crypto: { randomUUID: () => `abc-${++serial}` },
  chrome: { runtime, contextMenus: { removeAll: callback => { menus.length = 0; callback(); }, create: menu => menus.push(menu), onClicked: { addListener: listener => { menuClick = listener; } } }, storage: {
    local: { get: async () => ({ settings: DEFAULTS }), setAccessLevel: async () => {} },
    session: { get: async () => ({ ...temporary }), set: async value => Object.assign(temporary, value), remove: async keys => { for (const key of [].concat(keys)) delete temporary[key]; } }
  }, tabs: {
    sendMessage: async (tab, message, options) => { pageMessages.push({ tab, message, options }); return true; },
    query: async query => [{ id: query.windowId && switched ? 2 : 1, windowId: 10, url: currentURL }],
    captureVisibleTab: async (window, options) => { assert.equal(window, 10); assert.equal(options.format, 'png'); captured++; return 'data:image/png;base64,test'; },
    create: async value => { if (failOpen) throw new Error('tab failed'); created.push(value); }
  } }
});
vm.runInContext((await fs.readFile(new URL('../background.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, ''), context);
function client(url) {
  let receive; const messages = [];
  connect({ name: 'translator', sender: { id: 'test', url }, postMessage: message => messages.push(message), onMessage: { addListener: listener => { receive = listener; } }, onDisconnect: { addListener() {} } });
  return async (command, extra = {}) => { const id = `req-${++serial}`; await receive({ id, command, ...extra }); return messages.find(message => message.id === id); };
}
const webpage = client('https://example.test/'), settings = client('chrome-extension://test/options.html');
assert.match((await webpage('image-capture')).error, /扩展图标/);
assert.equal(captured, 0);
currentURL = 'chrome://extensions';
assert.match((await settings('image-capture')).error, /普通 HTTP/);
assert.equal(captured, 0);
currentURL = 'https://example.test/'; switched = true;
assert.match((await settings('image-capture')).error, /网页已切换/);
assert.equal(created.length, 0);
switched = false;
assert.equal((await settings('image-capture')).result, true);
assert.equal(created.length, 1);
assert.equal(temporary['image-capture-expired'], undefined);
const token = created[0].url.split('#')[1];
assert.equal(temporary[token].data, 'data:image/png;base64,test');
const before = Object.keys(temporary).length;
failOpen = true;
assert.match((await settings('image-capture')).error, /tab failed/);
assert.equal(Object.keys(temporary).length, before, 'failed tab creation must remove its screenshot');
failOpen = false;
installed();
const imageMenu = menus.find(menu => menu.id === 'image-capture');
assert.ok(imageMenu.contexts.includes('image'));
assert.ok(imageMenu.contexts.includes('page'));
assert.equal(imageMenu.documentUrlPatterns.length, 2);
const capturedBefore = captured;
await menuClick({ menuItemId: 'image-capture' }, { id: 1, windowId: 10, url: currentURL });
assert.equal(captured, capturedBefore + 1);
assert.match(created.at(-1).url, /image\.html#image-capture-/);
// A context-menu event must capture its originating tab, never another active tab.
await menuClick({ menuItemId: 'image-capture' }, { id: 2, windowId: 10, url: currentURL });
assert.equal(captured, capturedBefore + 1);
assert.match(created.at(-1).url, /image\.html\?error=/);
assert.match(decodeURIComponent(created.at(-1).url), /网页已切换/);
assert.match((await webpage('translate', { text: 'hello', imageTranslation: true, settingsSnapshot: { ...DEFAULTS, mode: 'api' } })).error, /重新截图/);
for (const { code: translationTarget } of TARGET_LANGUAGES) {
  for (const surface of [{}, { pageTranslation: true }, { imageTranslation: true }, { subtitleTranslation: true }]) {
    await webpage('translate', { text: 'hello', ...surface, settingsSnapshot: { ...DEFAULTS }, translationTarget });
    assert.equal(engineRequests.at(-1).settings.target, translationTarget);
    assert.equal(engineRequests.at(-1).recordHistory, !surface.pageTranslation && !surface.imageTranslation && !surface.subtitleTranslation);
    assert.equal(DEFAULTS.target, 'auto', 'temporary target must never change saved/default settings');
  }
}
await webpage('translate', { text: 'hello' });
assert.equal(engineRequests.at(-1).settings.target, DEFAULTS.target);
for (const translationTarget of ['invalid', '', null, 1, {}]) {
  const count = engineRequests.length;
  assert.match((await webpage('translate', { text: 'hello', translationTarget })).error, /无效的目标语言/);
  assert.equal(engineRequests.length, count);
}
assert.match((await webpage('translate', { text: 'hello', imageTranslation: true, settingsSnapshot: { ...DEFAULTS, mode: 'api' }, translationTarget: 'en' })).error, /重新截图/);
assert.match((await webpage('translate', { text: 'hello', subtitleTranslation: true, settingsSnapshot: { ...DEFAULTS, mode: 'api' } })).error, /字幕翻译/);
assert.match((await webpage('subtitle-start')).error, /扩展图标/);
assert.equal((await settings('subtitle-start')).result, true);
assert.equal(pageMessages.at(-1).message.target, 'subtitle-translator');
assert.equal(pageMessages.at(-1).message.command, 'start');
assert.equal(pageMessages.at(-1).options.frameId, 0);
assert.ok(menus.find(menu => menu.id === 'subtitle-start').contexts.includes('video'));
await menuClick({ menuItemId: 'subtitle-start', srcUrl: 'https://example.test/video' }, { id: 42 });
assert.equal(pageMessages.at(-1).tab, 42);
assert.equal(pageMessages.at(-1).message.videoURL, 'https://example.test/video');
await menuClick({ menuItemId: 'subtitle-stop' }, { id: 42 });
assert.equal(pageMessages.at(-1).message.command, 'stop');
console.log('PASS: screenshot entry permission, image/page context menus, originating tab validation, visible menu errors, expiry, failed-tab cleanup and image translation mode snapshot.');
console.log('PASS: all three translation surfaces accept validated temporary targets, preserve global preferences and retain mode snapshot protection.');
