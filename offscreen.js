let worker;
const pending = new Map();
function launch() {
  worker = new Worker('engine-worker.js', { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.id && ('result' in data || data.error)) pending.delete(`${data.owner}:${data.id}`);
    chrome.runtime.sendMessage({ ...data, target: 'clients' }).catch(() => {});
  };
  worker.onerror = () => {
    for (const job of pending.values()) chrome.runtime.sendMessage({ ...job, target: 'clients', error: '推理 Worker 异常退出，请重试；如反复出现，请释放模型或重启扩展。' }).catch(() => {});
    pending.clear();
    worker.terminate();
    launch();
  };
}
launch();
// Keep only the lightweight routing worker reachable while long downloads/inference
// are active. No heartbeat is sent once every pending operation has completed.
setInterval(() => {
  if (pending.size) chrome.runtime.sendMessage({ target: 'clients', heartbeat: true }).catch(() => {});
}, 20000);
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('background.js') || message.target !== 'engine') return;
  if (message.id) pending.set(`${message.owner}:${message.id}`, { owner: message.owner, id: message.id });
  worker.postMessage(message);
  respond({ accepted: true });
});
