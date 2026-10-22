# 验证记录

## 整页进度长期停在 0 的处理

修复了整页任务未消费模型加载 / 流式消息的问题：推理状态带任务标识，后台按归属标记路由，整页展示加载百分比、生成字数、等待时间和正在生成的译文。默认分段降到约 240 字；完成数仍只按真实完成请求累计，不伪造进度。

增加推理任务的无进展超时（3 分钟）和总时限（10 分钟），超时释放 Worker；停止整页任务按请求和页面归属强制释放，旧 Worker 的迟到结果丢弃。页面内容变化导致的跳过会单独说明。已完成段落和磁盘模型缓存保留。

相关检查通过，覆盖进度续期、卡住任务释放、恢复后新任务、页面间取消隔离、总时限和旧 Worker 迟到消息。真实浏览器的整页流程检查通过，受控测试明确验证段落完成前加载提示与流式文字已出现；此类页面测试不作为模型推理证据。本次未下载模型、未执行打包或构建。

## 整页翻译

`node tests/check.mjs` 通过。新增分段检查覆盖 Unicode、600 字上限和正文保留；后台检查验证本地任务在设置改为 API 后拒绝发送下一段；推理编排检查验证整页分段不写入划词历史。Manifest 检查确认整页控制脚本先于划词脚本加载。

`node tests/browser-check.mjs --page-translation` 在真实 Edge Chromium 中通过。实际扩展入口把命令发往当前网页，未缓存模型时显示真实中断 / 下载提示，没有插入虚构译文。页面算法在同一浏览器中以明确标注的受控测试数据验证：六段请求串行处理、内联空格保留、跳过表单 / 代码 / 隐藏 / 可编辑内容、保留原有元素和点击事件、完成后继续不重复、处理动态新增正文、取消后不插入迟到结果、还原及 API 二次确认。

记录：[page-translation-result.json](../tests/page-translation-result.json)。受控页面测试不作为模型推理证据，本次未下载模型、未执行打包或构建。真实模型引擎沿用既有实现，整页请求直接调用相同推理接口，无模拟翻译兜底。

## 双语对照与翻译历史

`node tests/check.mjs` 通过。新增检查：并发结果串行保存、200 条上限、去重、搜索、单条删除、清空、关闭记录、错误后的队列恢复、排除地址与密钥、设置页及历史锚点权限、拒绝网页读取历史、拒绝伪造推理结果、历史写入失败仍返回译文并显示提示。推理编排检查验证成功结果携带原文与语言信息，取消和错误不发出成功结果。

`node tests/browser-check.mjs --selection-popup --history-ui` 在 Edge Chromium 中通过，覆盖真实鼠标划词浮层的原文显示、试译原文快照、浮层历史入口、双语历史卡片、大小写不敏感的搜索、删除、记录开关持久化、保留既有记录及清空确认。HTML 形式原文只作为文本渲染。记录：[history-ui-result.json](../tests/history-ui-result.json)。界面检查明确使用独立配置中的测试数据，不作为模型推理证据。

本次另尝试 `--inference --history` 真实模型复核，但权重下载因网络中断，报 `Cache.put() encountered a network error`，未进入模型推理，未记为通过；未用模拟译文替代。此前真实 WebLLM / Transformers.js 推理记录见下文。本次未执行打包或构建。

## 划词浮层点击后闪退修复

已通过真实鼠标按下 / 松开复现旧代码问题：浮层刚显示就被延迟的网页选区处理隐藏。原因是在事件分发结束后调用 `composedPath()`，不能再用它判定点击来自封闭 Shadow DOM。

修复为在 `mouseup` 同步阶段判断浮层来源，延迟处理仅保留网页目标；「译」按钮阻止鼠标按下时改变原选区，浮层内 Shift 选区也不会触发新的网页翻译。

`node tests/browser-check.mjs --selection-popup` 通过：真实点击「译」后保持打开，重试 / 取消不关闭，明确点击「关闭」与 Escape 正常关闭，再次划词可重开。本次使用真实的未缓存模型提示验证浮层，不模拟译文、不下载模型。原回归在修复前失败，修复后通过。记录：[selection-popup-result.json](../tests/selection-popup-result.json)。相关检查通过，未执行打包或构建。

## 下载按钮悬停状态修复

禁用按钮原先统一使用 `cursor: wait`，使尚未保存的引擎选择看起来像在下载。现改为禁用光标，并明确区分「请先保存所选引擎」「等待设备检测」「当前设备不支持本地模型」；只有实际操作期间显示进度光标和 `aria-busy`。

`node tests/browser-check.mjs --transformers --download-button` 已在真实浏览器验证：未保存时按钮禁用、显示保存提示且光标为 `not-allowed`；检测完成后恢复「确认下载 / 修复缓存」、启用和 `pointer`。记录：[download-button-result.json](../tests/download-button-result.json)。未下载模型，未执行打包或构建。

## 当前电脑支持检测

`node tests/check.mjs` 通过，新增覆盖 WebAssembly / WebGPU 缺失、无适配器、驱动异常、缓冲区限制不足、设备创建失败、计算结果错误、资源释放及内存 / 存储提示。

`node tests/browser-check.mjs --transformers --device-check` 在本机 Edge Chromium / Intel GPU 上通过。实际在推理 Worker 创建 GPU 设备、编译和执行计算、回读得到预期值；单缓冲区上限 2048 MiB，存储绑定上限 2047 MiB。页面展示五项检测结果及浏览器资源估计，不把这些上限称为显存容量。

负向浏览器检查明确注入了「无 WebGPU」条件：下载与本地试译按钮被禁用，显示建议，API 模式仍可选择；负向注入不是对真实设备情况的描述。本次未下载模型，未执行打包或构建。记录：[device-browser-result.json](../tests/device-browser-result.json)。

## Transformers.js 新增引擎

`node tests/browser-check.mjs --inference --transformers` 已在同一 Intel WebGPU / Edge Chromium 环境完成真实 ONNX q4 模型下载、加载与推理：`Hello, world!` → `你好，世界！`；释放实例并开启离线网络条件后，从独立缓存重新加载，`今天天气很好。` → `Today's weather is nice.`。实际网页选择文字并点击浮层也得到 `你好，世界！`，没有使用模拟译文。

记录：[transformers-browser-result.json](../tests/transformers-browser-result.json)。相关检查还覆盖引擎参数、ONNX 缓存完整性、跨引擎下载地址隔离，以及远程可执行文件被拒绝。运行库版本 3.7.3，模型与 WebLLM 使用同一 Qwen 0.5B 基础模型的不同格式。WebLLM 默认设置及 API 可选模式保持兼容。

自动测试每次创建新的独立浏览器配置，避免部分 Chromium 浏览器在重启时阻止命令行安装的测试扩展；这不影响用户在扩展管理页手动安装。测试目录可在浏览器退出后删除。

后续慢速网络复核遇到下载期间路由后台被回收、连接中断。已加入离屏页任务心跳：只在有任务未完成时每 20 秒发送短消息，完成后停止；相关检查验证任务期间发送、完成后停止。首次完整真实推理记录保留；后续网络中断的下载不记为通过。

验证日期：2026-10-22（Asia/Shanghai）。仅执行相关检查和测试，未运行项目打包或构建命令。第三方运行库直接使用官方已发布文件。

## 相关检查

`node tests/check.mjs`：通过。

覆盖应用及运行库 JavaScript 语法、MV3 Manifest/CSP、本地 WASM 有效性、运行依赖 SHA-256、语言方向、提示词数据封装、600 字输入限制、API 参数、缓存缺失时禁止隐式下载、Cache.add 网络门控、模型实例复用、忙碌请求不影响在途推理、按来源取消、释放显存、清缓存、不支持 WebGPU 的提示。

这些编排单元检查使用受控依赖，不将其中的测试占位文本视为模型结果。

## 真实浏览器与真实模型

`tests/browser-check.mjs --inference` 在本机 Microsoft Edge 155 的 Chromium MV3 环境通过，检测到 Intel WebGPU 设备。独立测试配置与日常浏览器配置分离。

- 首次未缓存时，翻译提示确认约 300 MB 下载，没有自动加载模型。
- 勾选下载确认后，实际下载 Qwen2.5 0.5B 权重并通过本地 WASM 加载。
- 实际模型生成：`Hello, world!` → `你好，世界！`。
- 释放模型实例，对扩展页面及 Worker 设置离线网络条件，从缓存重新加载并实际生成：`今天天气很好。` → `Today the weather is nice.`。
- 本地 HTTP 测试网页加载内容脚本，选择 `Hello, world!`、点击 Shadow DOM 中的「译」，浮层显示 `你好，世界！` 及「本地翻译完成 · 文字未上传」。

机器可读记录：[browser-result.json](../tests/browser-result.json)。

本机 Chrome 稳定版禁止通过自动测试的命令行参数加载未打包扩展，故真实自动化验证使用 Edge Chromium；尚未在用户日常 Chrome 配置中手动安装验证。`chrome://extensions` 中的手动加载步骤见 README。未测试全部 GPU、操作系统及第三方 API 服务，轻量模型的译文质量仍需按实际语境判断。

# 图片区域翻译（2026-10-22）

- `node tests/check.mjs` 通过：新增图片选区的缩放、反向拖动、越界、最小尺寸及中文识别空格整理；截图入口权限、受限页面、截图过程中切换标签页、过期数据清理、打开结果页失败后的临时数据清理、翻译模式快照校验。
- `CHROME_PATH` 指向本机 Edge，执行 `node tests/browser-check.mjs --image-translation` 通过。真实扩展页使用随扩展提供的 Tesseract.js/WASM/中英文数据，从包含英中文的画布截图中框选并实际识别出 `Hello world` 和 `图片文字翻译`。读取截图后确认会话存储已清除截图。
- 翻译部分使用本机 HTTP 测试服务返回固定译文，验证仅点击翻译后发出文字请求、不发送图片；此项不作为模型真实翻译质量的证据。本地翻译继续复用现有引擎与模型下载流程。
- 360 像素宽度无横向溢出，截图见 `tests/image-ui.png`，浏览器结果见 `tests/image-translation-result.json`。截图捕获路由的权限与异常分支使用受控依赖测试；浏览器 OCR 测试向会话存储提供确定性截图，不代表自动化覆盖了真实工具栏点击授权。
- 未打包、未构建。
- 右键入口的受控依赖测试通过：菜单覆盖网页与图片，复用现有截图流程；点击后严格核对来源标签页，失败时打开结果页显示错误。未自动化验证原生右键菜单的实际点击。
