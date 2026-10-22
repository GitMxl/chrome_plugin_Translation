import { DEFAULTS, validateSettings, validateText, MAX_INPUT, extensionRuntime, EXTENSION_CONTEXT_ERROR } from './shared.js';
const $ = id => document.getElementById(id);
let port, serial = 0, active, savedEngine = DEFAULTS.engine;
let capability = null, downloading = false;
let historyRequest = 0, historySearchTimer, historyWarning = '';
const pending = new Map();
function show(text) { $('message').textContent = text; $('message').hidden = false; }
function inputStatus(text) { $('input-status').textContent = text; show(text); $('message').hidden = true; }
function updateAvailability() {
  const compatible = capability?.backend === $('engine').value && capability.supported;
  $('download').disabled = downloading || !compatible || $('engine').value !== savedEngine;
  const label = downloading ? '正在下载 / 加载模型…'
    : $('engine').value !== savedEngine ? '请先保存所选引擎'
    : !capability ? '等待设备检测'
    : !compatible ? '当前设备不支持本地模型'
    : '确认下载 / 修复缓存';
  $('download').textContent = label;
  $('download').title = downloading ? '模型任务正在进行，进度见上方。'
    : $('engine').value !== savedEngine ? '请先点击上方「保存设置」，完成设备检测后再确认下载。'
    : !capability ? '正在等待设备检测结果，可点击「重新检测当前电脑」。'
    : !compatible ? capability.summary || '请查看上方设备检测结果。'
    : '勾选下载确认后，点击下载所选引擎的模型。';
  $('download').setAttribute('aria-busy', String(downloading));
  $('translate').disabled = !!active || ($('mode').value === 'local' && (!compatible || $('engine').value !== savedEngine));
  $('translate').textContent = active ? '正在翻译…' : '翻译';
  $('translate').setAttribute('aria-busy', String(!!active));
  $('cancel').disabled = !active;
  $('input-clear').disabled = !!active;
  $('input-copy').disabled = !!active || !$('translation').textContent;
}
function renderSupport(support) {
  if (!support || support.backend !== $('engine').value) return;
  capability = support;
  $('device-checks').replaceChildren(...support.checks.map(check => {
    const row = document.createElement('li'); row.textContent = `${check.ok ? '通过' : '未通过'} · ${check.name}：${check.detail}`; return row;
  }));
  $('device-resources').textContent = `系统内存估计：${support.memoryGB ? support.memoryGB + ' GB（浏览器近似值）' : '浏览器未提供'}；浏览器可用存储估计：${support.storageAvailableBytes === null ? '未知' : (support.storageAvailableBytes / 1024 ** 3).toFixed(1) + ' GB'}。`;
  $('device-warnings').textContent = support.warnings.join(' ');
  updateAvailability();
}
function render(state) {
  $('device').textContent = state.device;
  $('cache').textContent = state.cached ? '完整缓存，可离线使用' : '未完整缓存，请确认下载或修复';
  $('phase').textContent = ({ idle: '未加载', downloading: '下载 / 加载中', loading: '加载中', ready: '已就绪', translating: '翻译中', error: '出现错误，可重试' })[state.phase] || state.phase;
  $('progress').value = Math.min(1, Math.max(0, state.progress || 0));
  $('detail').textContent = state.text;
  renderSupport(state.support);
}
function connection() {
  const runtime = extensionRuntime();
  if (port) return port;
  try { port = runtime.connect({ name: 'translator' }); }
  catch (error) { throw new Error(/context invalidated/i.test(error.message) ? EXTENSION_CONTEXT_ERROR : error.message); }
  port.onMessage.addListener(message => {
    if (message.state) render(message.state);
    if (message.state && active && message.ownJob) $('input-status').textContent = message.state.text;
    if (message.partial !== undefined && message.id === active) { $('translation').textContent = message.partial; $('input-status').textContent = '正在生成译文…'; }
    const request = pending.get(message.id);
    if (!request || (!message.error && !('result' in message))) return;
    if (message.id === active && message.historyError) historyWarning = message.historyError;
    pending.delete(message.id); clearTimeout(request.timer);
    message.error ? request.reject(new Error(message.error)) : request.resolve(message.result);
  });
  port.onDisconnect.addListener(() => {
    // Read lastError while the disconnect callback is active to avoid an unchecked runtime error.
    const detail = chrome.runtime?.lastError?.message;
    port = null;
    const message = detail && /context invalidated|receiving end does not exist/i.test(detail) ? EXTENSION_CONTEXT_ERROR : '后台连接已中断，请重试；更新扩展后请关闭旧翻译页面并重新打开。';
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error(message)); }
    pending.clear();
  });
  return port;
}
function call(command, extra = {}, id = `settings-${++serial}`) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('操作超时，请重新检测状态或重试。')); }, command === 'download' ? 30 * 60 * 1000 : 180000);
    pending.set(id, { resolve, reject, timer });
    try { connection().postMessage({ command, id, ...extra }); } catch (error) { pending.delete(id); clearTimeout(timer); reject(error); }
  });
}
for (const [id, text] of [['page-start', '整页翻译已启动，请在网页右下角查看进度；API 模式需要在网页中再次确认。'], ['page-stop', '已请求停止整页翻译。'], ['page-restore', '已请求还原页面。']]) {
  $(id).addEventListener('click', async () => {
    $(id).disabled = true;
    try { await call(id); $('page-message').textContent = text; }
    catch (error) { $('page-message').textContent = error.message; }
    finally { $(id).disabled = false; }
  });
}
async function loadHistory() {
  const request = ++historyRequest;
  try {
    const data = await call('history-list', { query: $('history-search').value });
    if (request !== historyRequest) return;
    $('history-enabled').checked = data.enabled;
    $('history-status').textContent = `${data.enabled ? '正在记录' : '已关闭新记录'} · 共 ${data.total} / ${data.limit} 条${$('history-search').value.trim() ? `，匹配 ${data.items.length} 条` : ''}`;
    const cards = data.items.map(item => {
      const card = document.createElement('article'); card.className = 'history-card'; card.dataset.historyId = item.id;
      const meta = document.createElement('p'); meta.className = 'history-meta';
      meta.textContent = `${new Date(item.createdAt).toLocaleString('zh-CN')} · ${item.target === 'English' ? '英文' : '简体中文'} · ${item.mode === 'api' ? '自定义 API' : item.engine === 'transformers' ? 'Transformers.js' : 'WebLLM'}`;
      const pair = document.createElement('div'); pair.className = 'bilingual-grid';
      for (const [label, text] of [['原文', item.source], ['译文', item.translation]]) {
        const column = document.createElement('div'), heading = document.createElement('h3'), body = document.createElement('pre');
        heading.textContent = label; body.textContent = text; column.append(heading, body); pair.append(column);
      }
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'danger'; remove.textContent = '删除此条';
      remove.addEventListener('click', async () => {
        remove.disabled = true;
        try { await call('history-delete', { entryId: item.id }); await loadHistory(); }
        catch (error) { $('history-status').textContent = error.message; remove.disabled = false; }
      });
      card.append(meta, pair, remove); return card;
    });
    if (!cards.length) { const empty = document.createElement('p'); empty.textContent = data.total ? '没有找到匹配记录。' : '暂无翻译历史，成功翻译后会显示在这里。'; cards.push(empty); }
    $('history-list').replaceChildren(...cards);
  } catch (error) { if (request === historyRequest) $('history-status').textContent = `读取历史失败：${error.message}`; }
}
$('history-search').addEventListener('input', () => { clearTimeout(historySearchTimer); historySearchTimer = setTimeout(loadHistory, 200); });
$('history-refresh').addEventListener('click', loadHistory);
$('history-enabled').addEventListener('change', async () => {
  $('history-enabled').disabled = true;
  try { await call('history-toggle', { enabled: $('history-enabled').checked }); await loadHistory(); }
  catch (error) { $('history-status').textContent = error.message; }
  finally { $('history-enabled').disabled = false; }
});
$('history-clear').addEventListener('click', async () => {
  if (!confirm('删除全部翻译历史？此操作无法恢复，不会清除模型缓存或设置。')) return;
  $('history-clear').disabled = true;
  try { await call('history-clear'); await loadHistory(); }
  catch (error) { $('history-status').textContent = error.message; }
  finally { $('history-clear').disabled = false; }
});
function modelInfo() {
  const transformers = $('engine').value === 'transformers';
  $('model-name').textContent = transformers ? 'Qwen2.5-0.5B-Instruct · ONNX q4 · Transformers.js' : 'Qwen2.5-0.5B-Instruct · q4f32_1 · WebLLM';
  $('model-size').textContent = transformers ? '首次下载约 800 MB，建议预留 1 GB 磁盘、2 GB 以上显存；实际需求取决于设备。' : '首次下载约 300 MB，建议预留 400 MB 磁盘和约 1.1 GB 显存。';
}
function toggle() { $('api-fields').hidden = $('mode').value !== 'api'; modelInfo(); updateAvailability(); }
$('engine').addEventListener('change', () => {
  $('agree').checked = false; capability = null; $('device').textContent = '请保存设置后检测所选引擎';
  $('device-checks').replaceChildren(); $('device-resources').textContent = ''; $('device-warnings').textContent = '';
  modelInfo(); updateAvailability(); show('引擎已选择，请保存设置后检测兼容性。');
});
$('mode').addEventListener('change', toggle);
$('settings').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const settings = validateSettings(Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, $(key).value])));
    if (settings.mode === 'api') {
      const allowed = await chrome.permissions.request({ origins: [new URL(settings.endpoint).origin + '/*'] });
      if (!allowed) throw new Error('需要允许访问你配置的 API 站点，才能启用 API 模式。');
    }
    await call('save', { settings }); savedEngine = settings.engine; await call('status'); show('设置已保存。');
  } catch (error) { show(error.message); }
});
async function operation(button, command, success) {
  if ($('engine').value !== savedEngine) { show('请先保存所选引擎，再执行操作。'); return; }
  button.disabled = true;
  if (command === 'download') downloading = true;
  button.setAttribute('aria-busy', 'true');
  updateAvailability();
  try { await call(command, { engine: savedEngine }); show(success); } catch (error) { show(error.message); }
  finally { if (command === 'download') downloading = false; button.disabled = false; button.setAttribute('aria-busy', 'false'); updateAvailability(); }
}
$('download').addEventListener('click', () => {
  if (!$('agree').checked) { show('请先勾选同意下载模型数据（体积见上方）。'); return; }
  operation($('download'), 'download', '模型已就绪，可以离线翻译。');
});
$('clear').addEventListener('click', () => {
  if (confirm('清理会删除模型数据，下次使用需重新确认下载。继续吗？')) operation($('clear'), 'clear', '模型缓存已清理。');
});
$('release').addEventListener('click', () => operation($('release'), 'release', '模型显存已释放。'));
$('refresh').addEventListener('click', () => operation($('refresh'), 'status', '状态已更新。'));
$('source').maxLength = MAX_INPUT * 2;
function countInput() {
  const length = [...$('source').value].length;
  $('input-count').textContent = `${length} / ${MAX_INPUT} 字符${length > MAX_INPUT ? '，请缩短后再翻译' : ''}`;
  $('source').setAttribute('aria-invalid', String(length > MAX_INPUT));
}
$('source').addEventListener('input', countInput);
$('source').addEventListener('keydown', event => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) {
    event.preventDefault(); if (!$('translate').disabled) $('translate').click();
  }
});
$('input-clear').addEventListener('click', () => {
  if (active) return;
  $('source').value = ''; $('translation').textContent = ''; $('trial-original').textContent = '';
  $('trial-comparison').hidden = true; countInput(); updateAvailability(); inputStatus('已清空，可以输入新的文字。'); $('source').focus();
});
$('input-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('translation').textContent); inputStatus('译文已复制。'); }
  catch { inputStatus('复制失败，请在译文区域选择文字后手动复制。'); }
});
$('input-open').addEventListener('click', async () => {
  try {
    const runtime = extensionRuntime();
    await chrome.tabs.create({ url: runtime.getURL('options.html#input-translation') });
    inputStatus('已打开独立标签页，请在新页面输入文字。');
  } catch (error) { inputStatus(error.message); }
});
$('translate').addEventListener('click', async () => {
  if ($('engine').value !== savedEngine) { inputStatus('请先保存所选引擎，再翻译。'); return; }
  if (active) return;
  let sourceText;
  try {
    if (!$('source').value.trim()) throw new Error('请先输入需要翻译的文字。');
    if ([...$('source').value].length > MAX_INPUT) throw new Error(`最多支持 ${MAX_INPUT} 个字符，请缩短输入后重试。`);
    sourceText = validateText($('source').value);
  }
  catch (error) { inputStatus(error.message); countInput(); $('source').focus(); return; }
  const id = `settings-${++serial}`; active = id; historyWarning = ''; $('trial-comparison').hidden = false; $('trial-original').textContent = sourceText; $('translation').textContent = ''; updateAvailability(); inputStatus('正在准备翻译…');
  try { const text = await call('translate', { text: sourceText }, id); if (active === id) { $('translation').textContent = text; inputStatus(historyWarning || '翻译完成。'); await loadHistory(); } }
  catch (error) { if (active === id) inputStatus(error.message); }
  finally { active = null; updateAvailability(); }
});
$('cancel').addEventListener('click', () => call('cancel').then(() => inputStatus('已请求取消，等待当前操作结束。')).catch(error => inputStatus(error.message)));
try {
  loadHistory();
  const settings = await call('settings');
  savedEngine = settings.engine;
  for (const key of Object.keys(DEFAULTS)) $(key).value = settings[key];
  toggle(); await call('status');
} catch (error) {
  inputStatus(error.message);
  $('device').textContent = '扩展初始化失败，请按提示重新打开';
  $('phase').textContent = '未连接';
  $('input-status').textContent = error.message;
}
