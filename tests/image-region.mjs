import assert from 'node:assert/strict';
import { imageRegion, normalizeOCRText } from '../image-region.js';
assert.equal(normalizeOCRText(' Hello world\n图 片 文 字 翻 译 '), 'Hello world\n图片文字翻译');
const bounds = { left: 100, top: 50, width: 800, height: 450 };
assert.deepEqual(imageRegion({ x: 200, y: 100 }, { x: 500, y: 300 }, bounds, 1600, 900), { left: 200, top: 100, width: 600, height: 400 });
assert.deepEqual(imageRegion({ x: 500, y: 300 }, { x: 200, y: 100 }, bounds, 1600, 900), { left: 200, top: 100, width: 600, height: 400 });
assert.deepEqual(imageRegion({ x: -100, y: -100 }, { x: 1200, y: 900 }, bounds, 1600, 900), { left: 0, top: 0, width: 1600, height: 900 });
assert.throws(() => imageRegion({ x: 200, y: 100 }, { x: 200, y: 101 }, bounds, 1600, 900), /太小/);
assert.throws(() => imageRegion({ x: 200, y: 100 }, { x: 400, y: 200 }, { ...bounds, width: 0 }, 1600, 900), /尺寸/);
// Fractional CSS dimensions / browser zoom must not silently drop edge pixels.
assert.deepEqual(imageRegion({ x: 0, y: 0 }, { x: 333.3, y: 200 }, { left: 0, top: 0, width: 333.3, height: 200 }, 1000, 600), { left: 0, top: 0, width: 1000, height: 600 });
console.log('PASS: image crop scaling, reverse dragging, bounds, zoom and minimum selection.');
