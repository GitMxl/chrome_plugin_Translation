import { TF_MODEL_ID, TF_REVISION, TF_CACHE } from './shared.js';

// Runtime JS, ONNX loader and WASM are all supplied by the extension.
export class TransformersEngine {
  constructor({ initProgressCallback }) { this.progress = initProgressCallback; }
  async reload() {
    this.runtime = await import('./vendor/transformers/transformers.min.js');
    const { env, pipeline, InterruptableStoppingCriteria } = this.runtime;
    env.allowLocalModels = false;
    env.allowRemoteModels = true; // Cache misses are gated by the host worker's consent policy.
    env.useBrowserCache = false;
    env.useCustomCache = true;
    env.customCache = await caches.open(TF_CACHE);
    env.backends.onnx.wasm.wasmPaths = new URL('./vendor/transformers/', import.meta.url).href;
    env.backends.onnx.wasm.numThreads = 1;
    env.backends.onnx.wasm.proxy = false;
    this.stop = new InterruptableStoppingCriteria();
    this.pipe = await pipeline('text-generation', TF_MODEL_ID, {
      revision: TF_REVISION, device: 'webgpu', dtype: 'q4',
      progress_callback: event => {
        this.progress({ progress: event.status === 'ready' ? 1 : (event.progress || 0) / 100,
          text: event.status === 'progress' ? `正在下载 ${event.file}：${Math.round(event.progress || 0)}%` : `Transformers.js 加载中：${event.file || event.status}` });
      }
    });
  }
  async translate(messages, onPartial) {
    this.stop.reset();
    let partial = '', count = 0;
    const streamer = new this.runtime.TextStreamer(this.pipe.tokenizer, { skip_prompt: true, skip_special_tokens: true,
      callback_function: text => { partial += text; onPartial(partial); },
      token_callback_function: tokens => { count += tokens.length; }
    });
    const output = await this.pipe(messages, { max_new_tokens: 1600, do_sample: false, return_full_text: false, streamer, stopping_criteria: [this.stop] });
    if (count >= 1600) throw new Error('译文达到输出上限，请缩短选区后重试。');
    const generated = output[0]?.generated_text;
    return (typeof generated === 'string' ? generated : generated?.at(-1)?.content || partial).trim();
  }
  interruptGenerate() { this.stop?.interrupt(); }
  async unload() { if (this.pipe) { const pipe = this.pipe; this.pipe = null; await pipe.dispose(); } }
}
