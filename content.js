(() => {
  let host, root, box, original, output, status, trigger, port, active, selection = '', requestNumber = 0;
  const requests = new Map();
  const pageTranslator = globalThis.LocalPageTranslation.create({ request: call, selectionBusy: () => !!active });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message.target !== 'page-translator') return;
    if (message.command === 'start') pageTranslator.start();
    else if (message.command === 'stop') pageTranslator.stop();
    else if (message.command === 'restore') pageTranslator.restore();
    else return;
    respond({ accepted: true });
  });
  let historyWarning = '';
  function connect() {
    if (port) return port;
    port = chrome.runtime.connect({ name: 'translator' });
    port.onMessage.addListener(message => {
      if (message.state && active) status.textContent = message.state.text;
      const task = requests.get(message.id);
      if (!task) return;
      if (message.id === active && message.historyError) historyWarning = message.historyError;
      if ('partial' in message && active === message.id) output.textContent = message.partial;
      if (message.error || 'result' in message) {
        requests.delete(message.id);
        clearTimeout(task.timer);
        message.error ? task.reject(new Error(message.error)) : task.resolve(message.result);
      }
    });
    port.onDisconnect.addListener(() => {
      port = null;
      for (const task of requests.values()) { clearTimeout(task.timer); task.reject(new Error('扩展连接已中断，请重试；更新扩展后请刷新网页。')); }
      requests.clear();
    });
    return port;
  }
  function call(command, extra = {}, id = `page-${++requestNumber}`) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { requests.delete(id); reject(new Error('等待超时，请取消后重试。')); }, 180000);
      requests.set(id, { resolve, reject, timer });
      try { connect().postMessage({ command, id, ...extra }); }
      catch (error) { clearTimeout(timer); requests.delete(id); reject(error); }
    });
  }
  function button(text, action) {
    const element = document.createElement('button'); element.type = 'button'; element.textContent = text; element.addEventListener('click', action); return element;
  }
  function init() {
    if (host) return;
    host = document.createElement('div');
    host.setAttribute('data-local-translator-ui', 'selection');
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
    root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = ':host{all:initial}*{box-sizing:border-box}button{cursor:pointer;border:1px solid #ccd5e3;border-radius:7px;padding:6px 10px;background:#f3f6fb;color:#162945;font:13px system-ui}button:hover{background:#e3ecfc}#trigger{position:absolute;pointer-events:auto;background:#245bd5;color:white;border:0}#box{position:absolute;pointer-events:auto;width:360px;max-width:calc(100vw - 20px);background:#fff;color:#162945;border:1px solid #cbd6e6;border-radius:12px;box-shadow:0 8px 32px #14264430;padding:16px;font:14px/1.6 system-ui;text-align:left}h3{margin:0 0 8px;font:600 15px system-ui}#status{font-size:12px;color:#536680;margin-bottom:8px}#output{white-space:pre-wrap;overflow-wrap:anywhere;max-height:40vh;overflow:auto;user-select:text}.actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px}[hidden]{display:none!important}';
    style.textContent += '.comparison{max-height:45vh;overflow:auto}.label{font-size:12px;font-weight:600;color:#526680;margin:8px 0 4px}#original{white-space:pre-wrap;overflow-wrap:anywhere;color:#526680;border-bottom:1px solid #e2e8f0;padding-bottom:10px;user-select:text}#output{max-height:none;overflow:visible}#box{overflow:auto}';
    trigger = button('译', () => { box.hidden = false; trigger.hidden = true; translate(); }); trigger.id = 'trigger'; trigger.hidden = true;
    trigger.addEventListener('mousedown', event => event.preventDefault());
    box = document.createElement('section'); box.id = 'box'; box.hidden = true; box.setAttribute('aria-label', '划词翻译');
    const title = document.createElement('h3'); title.textContent = '划词翻译';
    status = document.createElement('div'); status.id = 'status'; status.setAttribute('role', 'status');
    output = document.createElement('div'); output.id = 'output';
    original = document.createElement('div'); original.id = 'original';
    const comparison = document.createElement('div'); comparison.className = 'comparison';
    const sourceLabel = document.createElement('div'); sourceLabel.className = 'label'; sourceLabel.textContent = '原文';
    const translationLabel = document.createElement('div'); translationLabel.className = 'label'; translationLabel.textContent = '译文';
    comparison.append(sourceLabel, original, translationLabel, output);
    const actions = document.createElement('div'); actions.className = 'actions';
    actions.append(button('重试', translate), button('取消', () => { const old = active; active = null; call('cancel').catch(() => {}); if (old) status.textContent = '已请求取消'; }), button('设置 / 下载模型', () => call('open-settings').catch(error => { status.textContent = error.message; })), button('关闭', close));
    actions.append(button('翻译历史', () => call('open-history').catch(error => { status.textContent = error.message; })));
    box.append(title, status, comparison, actions); root.append(style, trigger, box); document.documentElement.append(host);
  }
  function close() { if (!host) return; trigger.hidden = true; box.hidden = true; const wasActive = !!active; active = null; if (wasActive) call('cancel').catch(() => {}); }
  async function translate() {
    if (pageTranslator.isRunning()) { status.textContent = '整页翻译正在进行，请先停止整页任务。'; return; }
    if (active) { status.textContent = '请先取消当前任务，等待结束后重试。'; return; }
    const sourceText = selection;
    const id = `page-${++requestNumber}`; active = id; historyWarning = ''; original.textContent = sourceText; output.textContent = ''; status.textContent = '正在准备翻译…';
    try {
      const settings = await call('settings');
      if (active !== id) return;
      status.textContent = settings.mode === 'api' ? 'API 模式：文字将发送至你配置的服务…' : '正在准备本地模型…';
      const result = await call('translate', { text: sourceText }, id);
      if (active === id) { output.textContent = result; status.textContent = (settings.mode === 'api' ? 'API 翻译完成' : '本地翻译完成 · 文字未上传') + (historyWarning ? ` · ${historyWarning}` : ''); }
    } catch (error) { if (active === id) status.textContent = error.message; }
    finally { if (active === id) active = null; }
  }
  function fromOverlay(event) {
    return !!event.target?.closest?.('[data-local-translator-ui]') || (!!host && (event.target === host || event.composedPath().includes(host)));
  }
  function selected(target) {
    if (target?.closest?.('input,textarea,[contenteditable="true"]')) return;
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!text || !sel.rangeCount) { if (!active && trigger) trigger.hidden = true; return; }
    init();
    if (active) call('cancel').catch(() => {});
    active = null; selection = text; box.hidden = true;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const left = Math.max(10, Math.min(rect.left, window.innerWidth - 375));
    const top = Math.max(10, Math.min(rect.bottom + 8, window.innerHeight - 240));
    box.style.left = left + 'px'; box.style.top = top + 'px'; trigger.style.left = Math.max(10, Math.min(rect.right, innerWidth - 45)) + 'px'; trigger.style.top = Math.max(5, Math.min(rect.bottom + 5, innerHeight - 38)) + 'px'; trigger.hidden = false;
    box.style.maxHeight = Math.max(100, innerHeight - top - 10) + 'px';
  }
  document.addEventListener('mouseup', event => {
    // composedPath() is only available during dispatch. Classify overlay clicks
    // before deferring selection handling, otherwise the just-opened box is hidden.
    if (fromOverlay(event)) return;
    const target = event.target;
    setTimeout(() => selected(target), 0);
  });
  document.addEventListener('keyup', event => { if (event.key === 'Escape') close(); else if (event.shiftKey && !fromOverlay(event)) selected(event.target); });
  window.addEventListener('pagehide', () => { port?.disconnect(); });
})();
