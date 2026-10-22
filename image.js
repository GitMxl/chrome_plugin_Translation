import { extensionRuntime, validateText, MAX_INPUT } from './shared.js';
import { imageRegion, normalizeOCRText } from './image-region.js';
const $ = id => document.getElementById(id);
let region, start, worker, busy = false, translating = false, generation = 0, port, serial = 0, active, settings;
const pending = new Map();
function status(text) { $('image-status').textContent = text; }
function update() {
  $('recognize').disabled = busy || translating || !region;
  $('reselect').disabled = busy || translating || !$('capture').naturalWidth;
  $('ocr-cancel').disabled = !busy;
  $('ocr-text').disabled = busy;
  $('capture-stage').setAttribute('aria-busy', String(busy || translating));
  const size = [...$('ocr-text').value].length;
  $('ocr-count').textContent = `${size} / ${MAX_INPUT} 字符${size > MAX_INPUT ? '，请删减或重新框选更小区域' : ''}`;
  $('image-translate').disabled = busy || translating || !settings || !size || size > MAX_INPUT;
  $('translation-cancel').disabled = !translating;
  $('copy-result').disabled = translating || !$('result').textContent;
}
function call(command, extra = {}) {
  const id = `image-${++serial}`;
  if (command === 'translate') active = id;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); if (command === 'translate') call('cancel').catch(() => {}); reject(new Error('操作超时，请重试。')); }, 180000);
    pending.set(id, { resolve, reject, timer });
    try { port.postMessage({ command, id, ...extra }); }
    catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
  });
}
function clearSelection() { region = start = null; $('selection').hidden = true; update(); }
function showRegion() {
  const image = $('capture');
  const style = $('selection').style;
  style.left = `${region.left / image.naturalWidth * 100}%`;
  style.top = `${region.top / image.naturalHeight * 100}%`;
  style.width = `${region.width / image.naturalWidth * 100}%`;
  style.height = `${region.height / image.naturalHeight * 100}%`;
  $('selection').hidden = false;
}
$('capture').addEventListener('pointerdown', event => {
  if (busy || translating || event.button !== 0) return;
  event.preventDefault(); clearSelection(); start = { x: event.clientX, y: event.clientY }; $('capture').setPointerCapture(event.pointerId);
});
function move(event) {
  if (!start) return;
  try { region = imageRegion(start, { x: event.clientX, y: event.clientY }, $('capture').getBoundingClientRect(), $('capture').naturalWidth, $('capture').naturalHeight); showRegion(); }
  catch { region = null; $('selection').hidden = true; }
}
$('capture').addEventListener('pointermove', move);
$('capture').addEventListener('pointerup', event => { if (!start) return; move(event); start = null; update(); status(region ? '选区已就绪，点击「识别选中区域」。' : '选区太小，请重新框选。'); });
$('capture').addEventListener('pointercancel', clearSelection);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !busy && !translating) clearSelection();
  if (event.key === 'Enter' && event.target === $('capture') && !busy && !translating) {
    region = { left: 0, top: 0, width: $('capture').naturalWidth, height: $('capture').naturalHeight }; showRegion(); update(); status('已选择整张截图。');
  }
});
$('reselect').addEventListener('click', () => { clearSelection(); status('请重新拖动框选。'); $('capture').focus(); });
async function stopOCR() { generation++; busy = false; const current = worker; worker = null; update(); if (current) await current.terminate(); }
$('ocr-cancel').addEventListener('click', () => { stopOCR().catch(() => {}); status('已取消识别，可重新选择区域。'); });
$('recognize').addEventListener('click', async () => {
  if (busy || translating || !region) return;
  busy = true; const job = ++generation; update(); status('正在加载本地文字识别…');
  let current;
  const timeout = setTimeout(() => { if (job === generation) { stopOCR().catch(() => {}); status('识别超时，请缩小选区后重试。'); } }, 120000);
  try {
    const canvas = document.createElement('canvas');
    // Bound OCR memory while preserving small text at its original resolution.
    const scale = Math.min(2, 2400 / Math.max(region.width, region.height));
    canvas.width = Math.max(1, Math.round(region.width * scale)); canvas.height = Math.max(1, Math.round(region.height * scale));
    canvas.getContext('2d').drawImage($('capture'), region.left, region.top, region.width, region.height, 0, 0, canvas.width, canvas.height);
    current = await Tesseract.createWorker('eng+chi_sim', 1, {
      workerPath: chrome.runtime.getURL('vendor/ocr/worker.min.js'),
      corePath: chrome.runtime.getURL('vendor/ocr/tesseract-core-lstm.wasm.js'),
      langPath: chrome.runtime.getURL('vendor/ocr'), workerBlobURL: false, gzip: true,
      logger: message => { if (job === generation) status(`正在识别文字… ${Math.round((message.progress || 0) * 100)}%`); }
    });
    if (job !== generation) return;
    worker = current;
    const { data } = await current.recognize(canvas);
    if (job !== generation) return;
    $('ocr-text').value = normalizeOCRText(data.text);
    status(data.text.trim() ? '识别完成。请核对原文，再点击翻译。' : '没有识别到文字，请框选清晰、较大的文字区域。');
  } catch (error) { if (job === generation) status(`文字识别失败：${error.message || '请重试'}`); }
  finally { clearTimeout(timeout); if (current) await current.terminate().catch(() => {}); if (job === generation) { worker = null; busy = false; update(); } }
});
$('ocr-text').addEventListener('input', update);
$('image-translate').addEventListener('click', async () => {
  if (busy || translating) return;
  try {
    const text = validateText($('ocr-text').value);
    translating = true; $('comparison').hidden = false; $('original').textContent = text; $('result').textContent = ''; update();
    $('translation-status').textContent = '正在准备翻译…';
    // Require the mode displayed in this tab; avoid silently uploading after a settings change.
    const result = await call('translate', { text, imageTranslation: true, settingsSnapshot: settings });
    $('result').textContent = result; $('translation-status').textContent = '翻译完成。';
  } catch (error) { $('translation-status').textContent = error.message; }
  finally { translating = false; active = null; update(); }
});
$('translation-cancel').addEventListener('click', () => call('cancel', { force: true, requestId: active }).catch(error => { $('translation-status').textContent = error.message; }));
$('copy-result').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('result').textContent); $('translation-status').textContent = '译文已复制。'; }
  catch { $('translation-status').textContent = '复制失败，请选择译文手动复制。'; }
});
window.addEventListener('pagehide', () => { worker?.terminate(); port?.disconnect(); });
try {
  const launchError = new URLSearchParams(location.search).get('error');
  if (launchError) throw new Error(launchError);
  const runtime = extensionRuntime();
  port = runtime.connect({ name: 'translator' });
  port.onMessage.addListener(message => {
    if (message.id === active && typeof message.partial === 'string') $('result').textContent = message.partial;
    if (message.state && message.ownJob && translating) $('translation-status').textContent = message.state.text;
    const request = pending.get(message.id);
    if (!request || (!message.error && !('result' in message))) return;
    pending.delete(message.id); clearTimeout(request.timer); message.error ? request.reject(new Error(message.error)) : request.resolve(message.result);
  });
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('扩展连接已中断，请重新截图。')); }
    pending.clear(); settings = null; update();
  });
  settings = await call('settings');
  $('privacy').textContent = settings.mode === 'api' ? '当前为 API 模式：点击翻译会将上方文字发送至已配置服务。截图不会上传。' : '当前为本地模式：文字识别与翻译均在本机完成。';
  const key = location.hash.slice(1);
  if (!/^image-capture-[a-f0-9-]+$/.test(key)) throw new Error('截图不存在，请回到目标网页点击扩展图标重新截图。');
  const stored = (await chrome.storage.session.get(key))[key];
  await chrome.storage.session.remove(key);
  if (!stored || Date.now() - stored.created > 300000) throw new Error('截图已过期，请重新截图。');
  $('capture').src = stored.data; await $('capture').decode(); $('capture-stage').hidden = false;
  status('拖动框选图片中的文字，然后点击识别。'); update();
} catch (error) { status(error.message); }
