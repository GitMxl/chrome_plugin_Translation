(() => {
  let host, root, box, original, output, status, trigger, port, active, selection = '', requestNumber = 0;
  const requests = new Map();
  const pageTranslator = globalThis.LocalPageTranslation.create({
    request: (command, extra, onProgress) => {
      if (command === 'cancel') {
        const task = [...requests].find(([, task]) => task.pageTranslation);
        return call(command, task ? { force: true, requestId: task[0] } : {});
      }
      return call(command, extra, undefined, onProgress);
    }, selectionBusy: () => !!active
  });
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
    if (!globalThis.chrome?.runtime?.id || typeof chrome.runtime.connect !== 'function') {
      throw new Error('扩展连接已失效，请刷新当前网页后重试；如果刚刚更新或重新加载插件，旧网页需要刷新。');
    }
    if (port) return port;
    try { port = chrome.runtime.connect({ name: 'translator' }); }
    catch (error) { throw new Error(/context invalidated/i.test(error.message) ? '扩展连接已失效，请刷新当前网页后重试。' : error.message); }
    port.onMessage.addListener(message => {
      if (message.state && active) status.textContent = message.state.text;
      if (message.state && message.jobId && message.ownJob) requests.get(message.jobId)?.onProgress?.(message.state);
      const task = requests.get(message.id);
      if (!task) return;
      if (typeof message.partial === 'string') task.onProgress?.({ phase: 'translating', partial: message.partial });
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
  function call(command, extra = {}, id = `page-${++requestNumber}`, onProgress) {
    return new Promise((resolve, reject) => {
      const expire = () => {
        requests.delete(id);
        if (extra.pageTranslation) { try { port?.postMessage({ command: 'cancel', force: true, requestId: id, id: `timeout-${++requestNumber}` }); } catch {} }
        reject(new Error('当前段落长时间没有进展，已请求释放任务，请点击继续重试。'));
      };
      const task = { resolve, reject, timer: null, pageTranslation: !!extra.pageTranslation,
        onProgress: value => {
          if (extra.pageTranslation) { clearTimeout(task.timer); task.timer = setTimeout(expire, 180000); }
          onProgress?.(value);
        } };
      task.timer = setTimeout(expire, 180000);
      requests.set(id, task);
      try { connect().postMessage({ command, id, ...extra }); }
      catch (error) { clearTimeout(task.timer); requests.delete(id); reject(error); }
    });
  }
  function button(text, action) {
    const element = document.createElement('button'); element.type = 'button'; element.textContent = text; element.addEventListener('click', action); return element;
  }
  function iconButton(label, icon, action) {
    const element = button('', action);
    element.className = 'icon-button'; element.title = label; element.setAttribute('aria-label', label);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    const paths = {
      retry: ['M20 7v5h-5', 'M20 12a8 8 0 1 0-2.3 5.7'],
      cancel: ['M7 7h10v10H7z'],
      settings: ['M4 7h16M4 17h16', 'M8 4v6M16 14v6'],
      history: ['M3 4v6h6', 'M3 10a9 9 0 1 1 2 8', 'M12 7v5l3 2'],
      close: ['M6 6l12 12M18 6 6 18']
    };
    for (const d of paths[icon]) { const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', d); svg.append(path); }
    element.append(svg); return element;
  }
  function init() {
    if (host) return;
    host = document.createElement('div');
    host.setAttribute('data-local-translator-ui', 'selection');
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
    root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = ':host{all:initial}*{box-sizing:border-box}button{cursor:pointer;border:1px solid #ccd5e3;border-radius:7px;padding:6px 10px;background:#f3f6fb;color:#162945;font:13px system-ui}button:hover{background:#e3ecfc}#trigger{position:absolute;pointer-events:auto;background:#245bd5;color:white;border:0}#box{position:absolute;pointer-events:auto;width:360px;max-width:calc(100vw - 20px);background:#fff;color:#162945;border:1px solid #cbd6e6;border-radius:12px;box-shadow:0 8px 32px #14264430;padding:16px;font:14px/1.6 system-ui;text-align:left}h3{margin:0 0 8px;font:600 15px system-ui}#status{font-size:12px;color:#536680;margin-bottom:8px}#output{white-space:pre-wrap;overflow-wrap:anywhere;max-height:40vh;overflow:auto;user-select:text}.actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px}[hidden]{display:none!important}';
    style.textContent += '.comparison{max-height:45vh;overflow:auto}.label{font-size:12px;font-weight:600;color:#526680;margin:8px 0 4px}#original{white-space:pre-wrap;overflow-wrap:anywhere;color:#526680;border-bottom:1px solid #e2e8f0;padding-bottom:10px;user-select:text}#output{max-height:none;overflow:visible}#box{overflow:auto}#status:empty{display:none}';
    style.textContent += '.popup-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}.popup-heading h3{margin:0}.icon-button{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;flex-shrink:0;padding:7px;border-color:#dce6e2;background:#f5f8f6;color:#49665b}.icon-button:hover{background:#e5f0e9;color:#14786b}.icon-button:focus-visible{outline:2px solid #14786b;outline-offset:2px}.icon-button svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}#close{border-color:transparent;background:transparent;color:#7a8983}#close:hover{background:#fff0ed;color:#ad5048}.actions{border-top:1px solid #e4ebe6;padding-top:10px;gap:8px}';
    trigger = button('译', () => { box.hidden = false; trigger.hidden = true; translate(); }); trigger.id = 'trigger'; trigger.hidden = true;
    trigger.addEventListener('mousedown', event => event.preventDefault());
    box = document.createElement('section'); box.id = 'box'; box.hidden = true; box.setAttribute('aria-label', '划词翻译');
    const title = document.createElement('h3'); title.textContent = '划词翻译';
    const heading = document.createElement('div'); heading.className = 'popup-heading';
    const closeButton = iconButton('关闭', 'close', close); closeButton.id = 'close';
    heading.append(title, closeButton);
    status = document.createElement('div'); status.id = 'status'; status.setAttribute('role', 'status');
    output = document.createElement('div'); output.id = 'output';
    original = document.createElement('div'); original.id = 'original';
    const comparison = document.createElement('div'); comparison.className = 'comparison';
    const sourceLabel = document.createElement('div'); sourceLabel.className = 'label'; sourceLabel.textContent = '原文';
    const translationLabel = document.createElement('div'); translationLabel.className = 'label'; translationLabel.textContent = '译文';
    comparison.append(sourceLabel, original, translationLabel, output);
    const actions = document.createElement('div'); actions.className = 'actions';
    actions.append(iconButton('重试', 'retry', translate), iconButton('取消', 'cancel', () => { const old = active; active = null; call('cancel').catch(() => {}); if (old) status.textContent = '已请求取消'; }), iconButton('设置 / 下载模型', 'settings', () => call('open-settings').catch(error => { status.textContent = error.message; })));
    actions.append(iconButton('翻译历史', 'history', () => call('open-history').catch(error => { status.textContent = error.message; })));
    box.append(heading, status, comparison, actions); root.append(style, trigger, box); document.documentElement.append(host);
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
      if (active === id) { output.textContent = result; status.textContent = [settings.mode === 'api' ? 'API 翻译完成' : '', historyWarning].filter(Boolean).join(' · '); }
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
