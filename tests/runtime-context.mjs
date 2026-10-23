import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { DEFAULTS, MAX_INPUT, validateSettings, validateText, extensionRuntime, EXTENSION_CONTEXT_ERROR, languageLabel } from '../shared.js';

for (const browser of [undefined, {}, { runtime: {} }, { runtime: { connect() {} } }]) {
  assert.throws(() => extensionRuntime(browser), { message: EXTENSION_CONTEXT_ERROR });
}
const valid = { runtime: { id: 'test-extension', connect() {} } };
assert.equal(extensionRuntime(valid), valid.runtime);
const source = (await fs.readFile(new URL('../options.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
for (const browser of [{}, { runtime: { id: 'old-extension', connect() { throw new Error('Extension context invalidated.'); } } }]) {
  const elements = new Map(), timers = new Set();
  const document = { getElementById(id) {
    if (!elements.has(id)) elements.set(id, { value: DEFAULTS[id] || '', textContent: '', addEventListener() {}, querySelector() { return { remove() {} }; } });
    return elements.get(id);
  } };
  const context = vm.createContext({ document, chrome: browser, DEFAULTS, MAX_INPUT, validateSettings, validateText, languageLabel, populateTargets() {},
    extensionRuntime: () => extensionRuntime(browser), EXTENSION_CONTEXT_ERROR,
    setTimeout(fn) { const timer = {}; timers.add(timer); return timer; }, clearTimeout(timer) { timers.delete(timer); } });
  await vm.runInContext(`(async () => { ${source}\n })()`, context);
  assert.equal(elements.get('input-status').textContent, EXTENSION_CONTEXT_ERROR);
  assert.equal(elements.get('phase').textContent, '未连接');
  assert.equal(elements.get('message').textContent, EXTENSION_CONTEXT_ERROR);
  assert.equal(timers.size, 0, 'Failed connections must not leave request timers');
}
console.log('PASS: missing and invalidated extension runtime, actionable input-page errors and request timer cleanup.');
