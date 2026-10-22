import assert from 'node:assert/strict';
import { detectDeviceSupport } from '../device-support.js';

assert.equal((await detectDeviceSupport('webllm', {})).supported, false);
assert.match((await detectDeviceSupport('webllm', {})).summary, /WebGPU/);
assert.match((await detectDeviceSupport('webllm', {}, { validate: () => false })).summary, /WebAssembly/);
assert.equal((await detectDeviceSupport('webllm', { gpu: { requestAdapter: async () => null } })).supported, false);
assert.match((await detectDeviceSupport('webllm', { gpu: { requestAdapter: async () => { throw new Error('驱动异常'); } } })).summary, /驱动异常/);
assert.match((await detectDeviceSupport('webllm', { gpu: { requestAdapter: async () => ({ info: {}, limits: { maxBufferSize: 128 * 1024 ** 2, maxStorageBufferBindingSize: 64 * 1024 ** 2 } }) } })).summary, /限制不足/);

function fixture({ result = 42, failDevice = false } = {}) {
  let destroyed = 0, bufferCount = 0, submitted = 0;
  const device = {
    destroy() { destroyed++; },
    createShaderModule: () => ({}),
    createComputePipelineAsync: async () => ({ getBindGroupLayout: () => ({}) }),
    createBuffer: () => { bufferCount++; return { destroy() { destroyed++; }, mapAsync: async () => {}, getMappedRange: () => new Uint32Array([result]).buffer, unmap() {} }; },
    createBindGroup: () => ({}),
    createCommandEncoder: () => ({ beginComputePass: () => ({ setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {} }), copyBufferToBuffer() {}, finish() {} }),
    queue: { submit() { submitted++; } }
  };
  const nav = { deviceMemory: 8, storage: { estimate: async () => ({ quota: 100 * 1024 ** 2, usage: 0 }) }, gpu: { requestAdapter: async () => ({ info: { vendor: 'test' }, limits: { maxBufferSize: 1024 ** 3, maxStorageBufferBindingSize: 128 * 1024 ** 2 }, requestDevice: async () => { if (failDevice) throw new Error('设备创建失败'); return device; } }) } };
  return { nav, metrics: () => ({ destroyed, bufferCount, submitted }) };
}
const working = fixture();
const report = await detectDeviceSupport('transformers', working.nav);
assert.equal(report.supported, true);
assert.equal(report.backend, 'transformers');
assert.equal(report.memoryGB, 8);
assert.equal(report.checks.every(check => check.ok), true);
assert.match(report.warnings.join(' '), /存储空间偏少/);
assert.match(report.warnings.join(' '), /无法读取实际可用显存/);
assert.deepEqual(working.metrics(), { destroyed: 3, bufferCount: 2, submitted: 1 });
const broken = fixture({ result: 0 });
assert.equal((await detectDeviceSupport('webllm', broken.nav)).supported, false);
assert.equal(broken.metrics().destroyed, 3);
assert.match((await detectDeviceSupport('webllm', fixture({ failDevice: true }).nav)).summary, /设备创建失败/);
console.log('PASS: absent WebGPU/WASM/adapter, driver failure, insufficient limits, requestDevice failure, compute readback, cleanup, resource estimates and honest VRAM reporting.');
