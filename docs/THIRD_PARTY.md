# 第三方文件

- `vendor/ocr/tesseract.min.js`、`worker.min.js`：官方 npm `tesseract.js@6.0.1` 的 `dist` 产物，未构建或修改。来源：https://registry.npmjs.org/tesseract.js/-/tesseract.js-6.0.1.tgz 。Apache-2.0 许可证保存在 `vendor/ocr/LICENSE-Tesseract.md`，附带依赖声明见两个 `.LICENSE.txt` 文件。
- `vendor/ocr/tesseract-core-lstm.wasm.js` 与 `.wasm`：官方 npm `tesseract.js-core@6.0.0`，Apache-2.0，许可证见 `vendor/ocr/LICENSE-Core`。来源：https://registry.npmjs.org/tesseract.js-core/-/tesseract.js-core-6.0.0.tgz 。使用本地非 SIMD LSTM 核心以兼容支持的浏览器。
- `vendor/ocr/eng.traineddata.gz`、`chi_sim.traineddata.gz`：Tesseract 简体中文与英文整数 LSTM 数据，Apache-2.0。来源：https://github.com/naptha/tessdata/tree/gh-pages/4.0.0_best_int ，于 2026-10-22 下载并以 `vendor/checksums.json` 中的 SHA-256 固定本地内容。所有 OCR 代码与数据随扩展提供，不使用远程脚本或运行时 CDN。

- `vendor/transformers/transformers.min.js`、`ort-wasm-simd-threaded.jsep.mjs`、`ort-wasm-simd-threaded.jsep.wasm`：从官方 npm 发布包 `@huggingface/transformers@3.7.3` 的 `dist` 目录直接复制，未执行构建。包含 Transformers.js（Apache-2.0）、ONNX Runtime（MIT）等上游依赖，许可证及声明保留在官方发布包、`vendor/transformers/LICENSE` 与 `vendor/transformers/LICENSE-ONNXRuntime` 中。来源：https://registry.npmjs.org/@huggingface/transformers/-/transformers-3.7.3.tgz 。
- Transformers.js 所用 Qwen ONNX 权重：https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct ，固定提交 `22942cb7d7ba4cc81bb4673549ca4d4614469b5e`，派生自同一 Apache-2.0 Qwen 模型。模型权重按用户确认下载，不随代码预下载。

- `vendor/webllm.js`：直接复制自 npm 官方发布包 `@mlc-ai/web-llm@0.2.79` 的 `lib/index.js`，未执行构建或压缩。包内已包含 WebLLM、TVM Web runtime、tokenizers、xgrammar、loglevel 等运行依赖与嵌入式 WASM。来源：https://registry.npmjs.org/@mlc-ai/web-llm/-/web-llm-0.2.79.tgz 。保留发布包及源码映射以便审查上游版权声明。
- `vendor/LICENSE-WebLLM`：官方发布包 Apache-2.0 许可证。
- `vendor/qwen2-0.5b-q4f32.wasm`：MLC 官方预编译模型库，来源：https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_48/Qwen2-0.5B-Instruct-q4f32_1-ctx4k_cs1k-webgpu.wasm 。通过本地扩展 URL 加载，不远程下载执行。
- `vendor/model-info.json`、`vendor/ndarray-info.json`：模型仓库元信息与分片信息，记录版本和大小，不是模型权重。
- Qwen2.5-0.5B-Instruct 原始模型：Qwen 团队，Apache-2.0：https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct/blob/main/LICENSE 。转换权重：https://huggingface.co/mlc-ai/Qwen2.5-0.5B-Instruct-q4f32_1-MLC 。首次使用经用户确认后下载。

扩展将这些组件组合用于本地翻译，不表示上述项目为本扩展提供背书。本地文件 SHA-256 记录于 `vendor/checksums.json`。
