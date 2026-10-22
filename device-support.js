const MiB = 1024 * 1024;
function timed(promise, label, lateCleanup) {
  let timer, expired = false;
  const task = Promise.resolve(promise).then(value => {
    if (expired) lateCleanup?.(value);
    return value;
  });
  return Promise.race([task, new Promise((_, reject) => {
    timer = setTimeout(() => { expired = true; reject(new Error(`${label}超时，请检查显卡驱动或重启浏览器后重新检测。`)); }, 8000);
  })]).finally(() => clearTimeout(timer));
}

// Runs in the same dedicated worker as inference. No model download or large allocation.
export async function detectDeviceSupport(backend = 'webllm', nav = globalThis.navigator, wasm = globalThis.WebAssembly) {
  const report = { backend, supported: false, gpu: '未检测到', checks: [], warnings: [], memoryGB: nav?.deviceMemory || null, storageAvailableBytes: null };
  const check = (name, ok, detail) => report.checks.push({ name, ok, detail });
  let gpu, storage, readback;
  try {
    const wasmOK = !!wasm?.validate?.(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
    check('WebAssembly', wasmOK, wasmOK ? '可用' : '当前浏览器无法执行 WebAssembly，请升级浏览器。');
    if (!wasmOK) throw new Error('不支持 WebAssembly，请升级 Chrome 后重试。');
    check('WebGPU 接口', !!nav?.gpu, nav?.gpu ? '可用' : '不可用，请升级 Chrome 并开启「使用图形加速功能」。');
    if (!nav?.gpu) throw new Error('不支持 WebGPU：请升级 Chrome，开启图形加速并重启浏览器。也可主动切换自定义 API 模式。');
    const adapter = await timed(nav.gpu.requestAdapter(), '获取 GPU 适配器');
    check('GPU 适配器', !!adapter, adapter ? '可用' : '无法获取，请检查显卡驱动、图形加速或浏览器的 GPU 限制。');
    if (!adapter) throw new Error('无法获得 WebGPU 适配器，请检查显卡驱动和浏览器图形加速。');
    const info = adapter.info || (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : {});
    report.gpu = info.description || info.vendor || '浏览器未公开显卡名称';
    report.limits = { maxBufferSize: adapter.limits.maxBufferSize, maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize };
    const limitsOK = report.limits.maxBufferSize >= 256 * MiB && report.limits.maxStorageBufferBindingSize >= 128 * MiB;
    check('GPU 缓冲区基础限制', limitsOK, `单缓冲区 ${Math.floor(report.limits.maxBufferSize / MiB)} MiB，存储绑定 ${Math.floor(report.limits.maxStorageBufferBindingSize / MiB)} MiB；基础要求分别为 256 / 128 MiB。`);
    if (!limitsOK) throw new Error('GPU 缓冲区限制不足，当前设备不满足本地模型的基础条件。可主动切换 API 模式。');
    gpu = await timed(adapter.requestDevice(), '创建 GPU 设备', device => device.destroy());
    const pipeline = await timed(gpu.createComputePipelineAsync({ layout: 'auto', compute: { module: gpu.createShaderModule({ code: '@group(0) @binding(0) var<storage, read_write> value: array<u32>; @compute @workgroup_size(1) fn main() { value[0] = 42u; }' }), entryPoint: 'main' } }), '编译 GPU 计算程序');
    // STORAGE | COPY_SRC; MAP_READ | COPY_DST. Only eight bytes of probe buffers.
    storage = gpu.createBuffer({ size: 4, usage: 128 | 4 });
    readback = gpu.createBuffer({ size: 4, usage: 1 | 8 });
    const encoder = gpu.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, gpu.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: storage } }] }));
    pass.dispatchWorkgroups(1); pass.end();
    encoder.copyBufferToBuffer(storage, 0, readback, 0, 4);
    gpu.queue.submit([encoder.finish()]);
    await timed(readback.mapAsync(1), '执行 GPU 计算');
    const computeOK = new Uint32Array(readback.getMappedRange())[0] === 42;
    readback.unmap();
    check('GPU 实际计算与回读', computeOK, computeOK ? '执行成功' : '计算结果不正确，请更新显卡驱动。');
    if (!computeOK) throw new Error('GPU 实际计算验证失败，请更新显卡驱动后重试。');
    if (adapter.isFallbackAdapter) report.warnings.push('浏览器正在使用软件适配器，推理可能很慢。');
    report.supported = true;
    report.summary = `WebGPU 可用 · ${report.gpu} · 基础兼容性检测通过`;
  } catch (error) {
    report.summary = error.message || '设备检测失败，请重试。';
    if (!report.checks.some(item => !item.ok)) check('GPU 实际设备 / 计算验证', false, report.summary);
  } finally {
    readback?.destroy(); storage?.destroy(); gpu?.destroy();
  }
  try {
    const estimate = await nav?.storage?.estimate?.();
    if (Number.isFinite(estimate?.quota) && Number.isFinite(estimate?.usage)) {
      report.storageAvailableBytes = Math.max(0, estimate.quota - estimate.usage);
      if (report.storageAvailableBytes < (backend === 'transformers' ? 1024 : 400) * MiB) report.warnings.push('浏览器估计的可用存储空间偏少，下载前请检查磁盘空间；此估计不等于真实剩余磁盘空间。');
    }
  } catch { report.warnings.push('浏览器未能提供存储空间估计。'); }
  report.warnings.push(`浏览器无法读取实际可用显存。${backend === 'transformers' ? 'Transformers.js 建议 2 GB 以上显存' : 'WebLLM 预计约需 1.1 GB 显存'}，完整兼容性需在模型加载时确认。`);
  return report;
}
