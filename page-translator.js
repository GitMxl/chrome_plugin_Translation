(() => {
  const MAX_SEGMENTS = 500, MAX_CHARS = 60000;
  const EXCLUDE = 'script,style,noscript,template,textarea,input,select,button,form,pre,code,svg,math,canvas,iframe,[contenteditable]:not([contenteditable="false"]),[hidden],[aria-hidden="true"],[data-local-translator-ui],[data-local-page-translation]';
  const BLOCK = 'p,li,h1,h2,h3,h4,h5,h6,blockquote,td,th,dt,dd,figcaption,div,section,article,main';
  function eligible(node) {
    const parent = node.parentElement;
    if (!parent || !node.nodeValue || parent.closest(EXCLUDE)) return false;
    const css = getComputedStyle(parent);
    if (css.visibility !== 'visible' || css.display === 'none' || !parent.getClientRects().length) return false;
    for (let ancestor = parent; ancestor; ancestor = ancestor.parentElement) if (getComputedStyle(ancestor).opacity === '0') return false;
    return true;
  }
  const owner = parent => parent.closest(BLOCK) || parent;
  function splitText(text, limit = 600) {
    const chars = [...text], parts = [];
    for (let start = 0; start < chars.length;) {
      let end = Math.min(start + limit, chars.length);
      if (end < chars.length) {
        for (let cut = end; cut > start + Math.floor(limit / 2); cut--) {
          if (/[\s。！？.!?；;]/u.test(chars[cut - 1])) { end = cut; break; }
        }
      }
      const piece = chars.slice(start, end).join('').trim();
      if (piece) parts.push(piece);
      start = end;
    }
    return parts;
  }
  function originalText(element) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const text = []; let node;
    while ((node = walker.nextNode())) if (eligible(node) && owner(node.parentElement) === element) text.push(node.nodeValue);
    return text.join('').trim();
  }
  async function collect(done, signature, cancelled) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), groups = new Map();
    let node, scanned = 0, limited = false;
    while ((node = walker.nextNode())) {
      if (++scanned % 250 === 0) { await new Promise(resolve => setTimeout(resolve, 0)); if (cancelled()) return { items: [], limited: false }; }
      if (scanned > 50000) { limited = true; break; }
      if (!eligible(node)) continue;
      const block = owner(node.parentElement);
      if (!groups.has(block)) groups.set(block, []);
      groups.get(block).push(node.nodeValue);
    }
    const items = []; let chars = 0, segments = 0;
    for (const [element, texts] of groups) {
      const source = texts.join('').trim();
      if (!/[\p{L}]/u.test(source)) continue;
      const previous = done.get(element);
      if (previous?.source === source && previous.signature === signature && previous.node.isConnected) continue;
      if (previous && previous.source !== source) { previous.node.remove(); done.delete(element); }
      const parts = splitText(source);
      if (segments + parts.length > MAX_SEGMENTS || chars + [...source].length > MAX_CHARS) { limited = true; continue; }
      items.push({ element, source, parts }); chars += [...source].length; segments += parts.length;
    }
    return { items, segments, limited };
  }
  function create({ request, selectionBusy = () => false }) {
    let toolbar, shadow, status, progress, startButton, stopButton, restoreButton, settingsButton;
    let running = false, cancelled = false, apiApproval = null, runNumber = 0;
    const done = new Map();
    function init() {
      if (toolbar) return;
      toolbar = document.createElement('div'); toolbar.setAttribute('data-local-translator-ui', 'page');
      toolbar.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:calc(100vw - 32px)';
      shadow = toolbar.attachShadow({ mode: 'closed' });
      const style = document.createElement('style'); style.textContent = ':host{all:initial}.panel{width:340px;max-width:calc(100vw - 32px);padding:14px;background:#fff;color:#19324c;border:1px solid #cbd6e6;border-radius:12px;box-shadow:0 6px 28px #18345230;font:13px/1.6 system-ui}strong{font-size:14px}p{white-space:pre-wrap;overflow-wrap:anywhere;margin:7px 0}progress{width:100%;accent-color:#285bd6}.actions{display:flex;gap:6px;flex-wrap:wrap}button{cursor:pointer;padding:6px 9px;border:1px solid #d1dbe8;border-radius:6px;background:#eef3fd;color:#234883;font:12px system-ui}button:disabled{cursor:not-allowed;opacity:.5}[hidden]{display:none!important}';
      const panel = document.createElement('section'); panel.className = 'panel'; panel.setAttribute('aria-label', '整页翻译');
      const title = document.createElement('strong'); title.textContent = '整页双语翻译';
      status = document.createElement('p'); status.id = 'page-status'; status.setAttribute('role', 'status'); status.textContent = '准备翻译当前页面';
      progress = document.createElement('progress'); progress.id = 'page-progress'; progress.max = 1; progress.value = 0;
      const actions = document.createElement('div'); actions.className = 'actions';
      function button(label, action) { const value = document.createElement('button'); value.type = 'button'; value.textContent = label; value.addEventListener('click', action); actions.append(value); return value; }
      startButton = button('翻译 / 继续', () => start()); startButton.id = 'page-start';
      stopButton = button('停止', stop); stopButton.id = 'page-stop'; stopButton.disabled = true;
      restoreButton = button('还原页面', restore); restoreButton.id = 'page-restore';
      settingsButton = button('设置 / 下载模型', () => request('open-settings').catch(error => { status.textContent = error.message; }));
      button('关闭面板', () => { stop(); toolbar.hidden = true; });
      panel.append(title, status, progress, actions); shadow.append(style, panel); document.documentElement.append(toolbar);
    }
    function stop() {
      const awaitingApproval = apiApproval !== null;
      apiApproval = null;
      if (!running) {
        if (awaitingApproval && toolbar) { startButton.textContent = '翻译 / 继续'; status.textContent = '已取消 API 整页翻译确认，未发送正文。'; }
        return;
      }
      cancelled = true; status.textContent = '正在停止，已完成的译文保留…';
      request('cancel').catch(() => {});
    }
    function restore() {
      stop(); runNumber++;
      for (const { node } of done.values()) node.remove();
      done.clear();
      if (toolbar) { progress.value = 0; status.textContent = '页面已还原，原文和网页交互保持不变。'; }
    }
    async function start() {
      init(); toolbar.hidden = false;
      if (running) { status.textContent = '整页翻译正在进行，可停止后重试。'; return; }
      if (selectionBusy()) { status.textContent = '划词翻译正在进行，请先取消或等待完成。'; return; }
      const run = ++runNumber;
      running = true; cancelled = false; startButton.disabled = true; stopButton.disabled = false;
      const alive = () => !cancelled && run === runNumber;
      let completed = 0, total = 0;
      try {
        for (const [element, result] of done) if (!element.isConnected || !result.node.isConnected) { result.node.remove(); done.delete(element); }
        const settings = await request('settings');
        if (!alive()) return;
        const signature = JSON.stringify([settings.mode, settings.engine, settings.target]);
        if (settings.mode === 'api' && apiApproval !== signature) {
          apiApproval = signature;
          startButton.textContent = '确认使用 API 翻译本页';
          status.textContent = '当前为自定义 API 模式。整页翻译会逐段发送本页正文至你配置的服务；点击「确认使用 API 翻译本页」后才会开始。';
          return;
        }
        apiApproval = null; startButton.textContent = '翻译 / 继续';
        status.textContent = '正在收集页面中的可见正文…';
        const plan = await collect(done, signature, () => !alive());
        if (!alive()) return;
        total = plan.segments || 0; progress.max = total || 1; progress.value = 0;
        if (!total) { status.textContent = plan.limited ? '本轮未找到可处理的段落，单个段落可能超过本轮上限。' : '没有新的可翻译文字。已跳过表单、代码、隐藏内容和已完成段落。'; return; }
        for (const item of plan.items) {
          if (!alive()) break;
          if (!item.element.isConnected || originalText(item.element) !== item.source) continue;
          const translated = [];
          for (const part of item.parts) {
            if (!alive()) break;
            status.textContent = `正在${settings.mode === 'api' ? '通过 API' : '本地'}翻译：${completed} / ${total} 段。原文保持可见。`;
            const result = await request('translate', { text: part, pageTranslation: true, settingsSnapshot: settings });
            if (!alive()) break;
            translated.push(result); completed++; progress.value = completed;
          }
          if (!alive()) break;
          if (!item.element.isConnected || originalText(item.element) !== item.source) continue;
          done.get(item.element)?.node.remove();
          const node = document.createElement('span'); node.setAttribute('data-local-page-translation', '');
          node.style.cssText = 'display:block;white-space:pre-wrap;overflow-wrap:anywhere;border-left:3px solid #5081dd;padding:6px 10px;margin:6px 0;color:inherit;background:rgba(80,129,221,.08);font:inherit';
          node.textContent = translated.join('\n');
          item.element.append(node); done.set(item.element, { node, source: item.source, signature });
        }
        if (run === runNumber) status.textContent = cancelled ? `已停止，完成 ${completed} / ${total} 段。已显示的译文保留，可继续或还原。` : `本轮完成 ${completed} / ${total} 段。${plan.limited ? '已达到本轮 500 段 / 6 万字上限，可点击继续处理剩余内容。' : '可继续处理新加载的正文，或还原页面。'}`;
      } catch (error) {
        if (run === runNumber) status.textContent = cancelled ? `已停止，完成 ${completed} / ${total} 段。` : `翻译中断（${completed} / ${total}）：${error.message} 已完成的段落保留，可点击继续重试。`;
      } finally {
        if (cancelled && run === runNumber) status.textContent = `已停止，完成 ${completed} / ${total} 段。已显示的译文保留，可继续或还原。`;
        running = false; startButton.disabled = false; stopButton.disabled = true;
      }
    }
    return { start, stop, restore, isRunning: () => running };
  }
  globalThis.LocalPageTranslation = Object.freeze({ create, splitText });
})();
