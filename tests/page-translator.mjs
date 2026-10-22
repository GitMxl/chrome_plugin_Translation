import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
const context = vm.createContext({});
vm.runInContext(await fs.readFile(new URL('../languages.js', import.meta.url), 'utf8'), context);
vm.runInContext(await fs.readFile(new URL('../page-translator.js', import.meta.url), 'utf8'), context);
const { splitText } = context.LocalPageTranslation;
for (const text of ['', 'Hello world!', '字'.repeat(1601), '😀'.repeat(1001), 'Hello world. '.repeat(150), '第一段。\n\n第二段！'.repeat(100)]) {
  const parts = splitText(text);
  assert.equal(parts.every(part => [...part].length <= 600), true);
  assert.equal(parts.join('').replace(/\s/gu, ''), text.replace(/\s/gu, ''));
  assert.equal(parts.some(part => /[\uD800-\uDBFF]$/.test(part) || /^[\uDC00-\uDFFF]/.test(part)), false);
}
console.log('PASS: whole-page segmentation bounds, sentence boundaries, Unicode and text preservation.');
