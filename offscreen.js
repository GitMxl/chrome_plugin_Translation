let worker;
const pending = new Map();
function restart(message) {
  for (const job of pending.values()) chrome.runtime.sendMessage({ owner: job.owner, id: job.id, target: 'clients', error: message }).catch(() => {});
  pending.clear(); worker.terminate(); launch();
}
function launch() {
  worker = new Worker('engine-worker.js', { type: 'module' });
  const instance = worker;
  worker.onmessage = ({ data }) => {
    if (worker !== instance) return;
    const key = data.jobId ? `${data.jobOwner}:${data.jobId}` : `${data.owner}:${data.id}`;
    if (pending.has(key) && (data.state || typeof data.partial === 'string')) pending.get(key).lastActivity = Date.now();
    if (data.id && ('result' in data || data.error)) pending.delete(`${data.owner}:${data.id}`);
    chrome.runtime.sendMessage({ ...data, target: 'clients' }).catch(() => {});
  };
  worker.onerror = () => {
    if (worker !== instance) return;
    restart('推理 Worker 异常退出，请重试；如反复出现，请释放模型或重启扩展。');
  };
}
launch();
// Keep only the lightweight routing worker reachable while long downloads/inference
// are active. No heartbeat is sent once every pending operation has completed.
setInterval(() => {
  const now = Date.now();
  if ([...pending.values()].some(job => job.command === 'translate' && (now - job.lastActivity > 180000 || now - job.started > 600000))) {
    restart('当前段落的模型加载或推理超时，已释放卡住的任务。请点击「翻译 / 继续」重试，必要时改用 WebLLM 或缩短原文。');
    return;
  }
  if (pending.size) chrome.runtime.sendMessage({ target: 'clients', heartbeat: true }).catch(() => {});
}, 20000);
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('background.js') || message.target !== 'engine') return;
  if (message.command === 'cancel' && message.force && typeof message.requestId === 'string') {
    const task = pending.get(`${message.owner}:${message.requestId}`);
    if (task?.command === 'translate') restart('已停止当前段落，模型资源已释放。已完成的页面译文保留，可点击继续。');
    if (message.id) chrome.runtime.sendMessage({ target: 'clients', owner: message.owner, id: message.id, result: true }).catch(() => {});
    respond({ accepted: true }); return;
  }
  if (message.id) pending.set(`${message.owner}:${message.id}`, { owner: message.owner, id: message.id, command: message.command, started: Date.now(), lastActivity: Date.now() });
  worker.postMessage(message);
  respond({ accepted: true });
});
