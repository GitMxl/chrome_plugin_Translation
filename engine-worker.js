import { MLCEngine } from './vendor/webllm.js';
import { detectDeviceSupport } from './device-support.js';
import { MODEL_ID, MODEL_BASE, TF_BASE, TF_CACHE, validateText, messagesFor, validateSettings, targetLanguage } from './shared.js';

const appConfig = { model_list: [{ model_id: MODEL_ID, model: MODEL_BASE, model_lib: new URL('./vendor/qwen2-0.5b-q4f32.wasm', import.meta.url).href, overrides: { context_window_size: 4096 } }] };
const nativeFetch = globalThis.fetch.bind(globalThis);
let networkAllowed = false;
// Only the explicit download command can fetch remote model data. Translation is cache-only.
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('chrome-extension:')) return nativeFetch(input, init);
  const allowedBase = networkAllowed === 'transformers' ? TF_BASE : MODEL_BASE;
  if (!networkAllowed || !url.startsWith(allowedBase) || !/\.(json|bin|model|txt|onnx)$/.test(new URL(url).pathname)) throw new Error('模型缓存不完整。请到设置页确认下载或修复模型后重试。');
  return nativeFetch(input, init);
};
// Cache.add performs a browser-internal fetch and otherwise bypasses globalThis.fetch.
// Route WebLLM's cache misses through the same consent/offline gate.
Cache.prototype.add = async function(input) {
  const response = await globalThis.fetch(input);
  if (!response.ok) throw new Error(`模型文件下载失败（HTTP ${response.status}），请检查网络后重试。`);
  await this.put(input, response);
};
Cache.prototype.addAll = async function(inputs) {
  for (const input of inputs) await this.add(input);
};
let engine, loadedBackend, busy = false, current, idleTimer;
let state = { phase: 'idle', text: '尚未加载模型', progress: 0, cached: false, device: '尚未检测', supported: false };
const send = data => postMessage(data);
function publish(patch) { state = { ...state, ...patch }; send({ state, ...(current ? { jobOwner: current.job.owner, jobId: current.job.id } : {}) }); }
function reply(job, result) { send({ owner: job.owner, id: job.id, result }); }
function fail(job, error) { send({ owner: job.owner, id: job.id, error: error.message || String(error) }); }
async function inspectCache(backend = 'webllm') {
  if (backend === 'transformers') {
    const cache = await caches.open(TF_CACHE);
    for (const file of ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_q4.onnx']) if (!await cache.match(TF_BASE + file)) return false;
    return true;
  }
  const config = await caches.match(MODEL_BASE + 'mlc-chat-config.json');
  const manifest = await caches.match(MODEL_BASE + 'ndarray-cache.json');
  if (!config || !manifest) return false;
  const cfg = await config.json(), meta = await manifest.json();
  const files = [...meta.records.map(record => record.dataPath), ...(cfg.tokenizer_files || []).filter(name => ['tokenizer.json', 'tokenizer.model'].includes(name))];
  if (!files.length) return false;
  for (const name of files) if (!await caches.match(MODEL_BASE + name)) return false;
  return true;
}
async function device(backend = 'webllm') {
  const support = await detectDeviceSupport(backend);
  publish({ supported: support.supported, device: support.summary, support });
  return support.supported;
}
async function unload() {
  clearTimeout(idleTimer);
  if (engine) { const previous = engine; engine = null; await previous.unload(); }
}
function armIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    if (busy) return;
    await unload(); publish({ phase: 'idle', text: '空闲 10 分钟，已释放显存；下次从缓存加载。' });
  }, 10 * 60 * 1000);
}
async function load(allowDownload, backend = 'webllm') {
  if (engine && loadedBackend === backend) return;
  if (engine) await unload();
  if (!await device(backend)) throw new Error(state.device);
  if (!allowDownload && !await inspectCache(backend)) throw new Error(backend === 'transformers' ? '首次使用 Transformers.js 需下载约 800 MB 模型数据（建议预留 1 GB 磁盘、2 GB 以上显存）。请打开设置并确认下载。' : '首次使用需下载约 300 MB 模型数据（建议预留 400 MB 磁盘、约 1.1 GB 显存）。请打开设置并确认下载。');
  publish({ phase: allowDownload ? 'downloading' : 'loading', text: allowDownload ? '正在下载 / 加载模型…' : '正在从本地缓存加载模型…', progress: 0 });
  networkAllowed = allowDownload ? backend : false;
  let candidate;
  try {
    const Engine = backend === 'transformers' ? (await import('./transformers-engine.js')).TransformersEngine : MLCEngine;
    candidate = new Engine({ appConfig, initProgressCallback: report => publish({ progress: report.progress, text: report.text }), logLevel: 'WARN' });
    await candidate.reload(MODEL_ID);
    const cached = await inspectCache(backend);
    if (!cached) throw new Error('模型缓存写入不完整，请检查磁盘空间，清理当前引擎缓存后重新下载。');
    engine = candidate;
    loadedBackend = backend;
    publish({ cached, phase: 'ready', text: '模型已就绪，可离线翻译', progress: 1 });
  } catch (error) { await candidate?.unload().catch(() => {}); throw error; }
  finally { networkAllowed = false; }
}
async function apiTranslate(job, text) {
  const settings = validateSettings(job.settings);
  const response = await nativeFetch(settings.endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}) },
    body: JSON.stringify({ model: settings.apiModel, messages: messagesFor(text, settings.target), temperature: 0, max_tokens: 1600, stream: false }), signal: current.controller.signal, credentials: 'omit', redirect: 'error'
  });
  if (!response.ok) throw new Error(`API 请求失败（HTTP ${response.status}），请检查地址、权限、模型和密钥。`);
  const result = (await response.json()).choices?.[0]?.message?.content;
  if (typeof result !== 'string' || !result.trim()) throw new Error('API 没有返回有效译文。');
  return result.trim();
}
function cancel(owner) {
  if (!current || (owner && current.job.owner !== owner)) return;
  current.cancelled = true;
  current.controller.abort();
  engine?.interruptGenerate();
}
self.onmessage = async ({ data: job }) => {
  let acquired = false;
  try {
    if (job.command === 'cancel') { cancel(job.owner); if (job.id) reply(job, true); return; }
    if (job.command === 'status') { await device(job.settings?.engine); publish({ cached: await inspectCache(job.settings?.engine) }); reply(job, state); return; }
    if (job.command === 'reset') { cancel(); reply(job, true); return; }
    if (busy) throw new Error('模型正忙，请先取消当前任务或稍后重试。');
    busy = true; acquired = true; clearTimeout(idleTimer);
    current = { job, cancelled: false, controller: new AbortController() };
    if (job.command === 'clear') {
      await unload();
      for (const key of await caches.keys()) if (job.settings?.engine === 'transformers' ? key === TF_CACHE : key.startsWith('webllm/')) await caches.delete(key);
      publish({ phase: 'idle', cached: false, progress: 0, text: '模型缓存已清理' }); reply(job, true);
    } else if (job.command === 'release') {
      await unload(); publish({ phase: 'idle', text: '已释放模型显存，缓存保留' }); reply(job, true);
    } else if (job.command === 'download') {
      await load(true, job.settings?.engine); reply(job, true);
    } else if (job.command === 'translate') {
      const text = validateText(job.text);
      let result;
      if (job.settings.mode === 'api') {
        publish({ phase: 'translating', text: '正在通过自定义 API 翻译（文字会发送至配置的服务）…' });
        const timeout = setTimeout(() => current?.controller.abort(), 120000);
        try { result = await apiTranslate(job, text); } finally { clearTimeout(timeout); }
      } else {
        await load(false, job.settings?.engine);
        if (current.cancelled) throw new Error('已取消翻译。');
        publish({ phase: 'translating', text: '正在本地翻译…' });
        if (engine.translate) {
          result = await engine.translate(messagesFor(text, job.settings.target), partial => {
            if (!current.cancelled) send({ owner: job.owner, id: job.id, partial });
          });
        } else {
          result = '';
          let finishReason;
          const stream = await engine.chat.completions.create({ messages: messagesFor(text, job.settings.target), temperature: 0, max_tokens: 1600, stream: true });
          for await (const chunk of stream) {
            if (current.cancelled) { engine.interruptGenerate(); break; }
            result += chunk.choices[0]?.delta?.content || '';
            finishReason = chunk.choices[0]?.finish_reason || finishReason;
            send({ owner: job.owner, id: job.id, partial: result });
          }
          if (finishReason === 'length') throw new Error('译文达到输出上限，请缩短选区后重试。');
          result = result.trim();
        }
      }
      if (current.cancelled) throw new Error('已取消翻译。');
      if (!result) throw new Error('模型没有生成译文，请重试。');
      send({ owner: job.owner, id: job.id, result, ...(job.recordHistory === false ? {} : { translationRecord: { source: text, target: targetLanguage(text, job.settings.target), mode: job.settings.mode, engine: job.settings.engine || 'webllm' } }) });
      publish({ phase: engine ? 'ready' : 'idle', text: '翻译完成' });
    } else throw new Error('未知操作。');
  } catch (error) {
    if (acquired && job.command === 'translate' && job.settings?.mode !== 'api' && engine && !current?.cancelled) await unload().catch(() => {});
    if (acquired) publish({ phase: 'error', text: error.name === 'AbortError' ? '已取消或请求超时，请重试。' : error.message });
    fail(job, error.name === 'AbortError' ? new Error('已取消或请求超时，请重试。') : error);
  } finally {
    if (current?.job === job) { current = null; busy = false; armIdle(); }
  }
};
