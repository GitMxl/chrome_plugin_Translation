(() => {
  const MAX_SEGMENTS = 500, MAX_CHARS = 60000;
  const EXCLUDE = 'script,style,noscript,template,textarea,input,select,button,form,pre,code,svg,math,canvas,iframe,[contenteditable]:not([contenteditable="false"]),[hidden],[aria-hidden="true"],[data-local-translator-ui],[data-local-page-translation]';
  const BLOCK = 'p,li,h1,h2,h3,h4,h5,h6,blockquote,td,th,dt,dd,figcaption,div,section,article,main';
  function targetSelector(id) {
    const label = document.createElement('label'); label.className = 'target-language'; label.textContent = '目标语言 ';
    const select = document.createElement('select'); select.id = id;
    globalThis.LocalTranslationLanguages.populateTargets(select, true);
    label.append(select); return { label, select };
  }
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
      const parts = splitText(source, 240);
      if (segments + parts.length > MAX_SEGMENTS || chars + [...source].length > MAX_CHARS) { limited = true; continue; }
      items.push({ element, source, parts }); chars += [...source].length; segments += parts.length;
    }
    return { items, segments, limited };
  }
  function create({ request, selectionBusy = () => false }) {
    let toolbar, shadow, status, progress, startButton, stopButton, restoreButton, settingsButton, targetSelect;
    let running = false, cancelled = false, apiApproval = null, runNumber = 0, pendingNode, ticker;
    const done = new Map();
    function init() {
      if (toolbar) return;
      toolbar = document.createElement('div'); toolbar.setAttribute('data-local-translator-ui', 'page');
      toolbar.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:calc(100vw - 32px)';
      shadow = toolbar.attachShadow({ mode: 'closed' });
      const style = document.createElement('style'); style.textContent = ':host{all:initial}.panel{width:340px;max-width:calc(100vw - 32px);padding:14px;background:#fff;color:#19324c;border:1px solid #cbd6e6;border-radius:12px;box-shadow:0 6px 28px #18345230;font:13px/1.6 system-ui}strong{font-size:14px}p{white-space:pre-wrap;overflow-wrap:anywhere;margin:7px 0}progress{width:100%;accent-color:#285bd6}.actions{display:flex;gap:6px;flex-wrap:wrap}button{cursor:pointer;padding:6px 9px;border:1px solid #d1dbe8;border-radius:6px;background:#eef3fd;color:#234883;font:12px system-ui}button:disabled{cursor:not-allowed;opacity:.5}[hidden]{display:none!important}';
      style.textContent += '*{box-sizing:border-box}.panel-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px}.icon-button{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;flex-shrink:0;padding:7px;border-color:#dce6e2;background:#f5f8f6;color:#49665b}.icon-button:hover{background:#e5f0e9;color:#14786b}.icon-button:focus-visible{outline:2px solid #14786b;outline-offset:2px}.icon-button svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}#page-close{border-color:transparent;background:transparent;color:#7a8983}#page-close:hover{background:#fff0ed;color:#ad5048}#page-start{background:#14786b;border-color:#14786b;color:#fff}#page-start:hover{background:#106357}progress{accent-color:#14786b}.actions{border-top:1px solid #e4ebe6;padding-top:10px;margin-top:10px;gap:8px}';
      const panel = document.createElement('section'); panel.className = 'panel'; panel.setAttribute('aria-label', '整页翻译');
      style.textContent += '.target-language{display:flex;align-items:center;gap:8px;margin:8px 0}select{min-width:0;flex:1;border:1px solid #ccd8d2;border-radius:6px;padding:6px;background:#fff;color:#19324c;font:13px system-ui}select:disabled{opacity:.6}';
      const language = targetSelector('page-target'); targetSelect = language.select;
      targetSelect.addEventListener('change', () => {
        if (running) return;
        apiApproval = null; startLabel('翻译 / 继续'); progress.value = 0;
        status.textContent = '目标语言已切换，点击「翻译 / 继续」重新翻译页面。';
      });
      const title = document.createElement('strong'); title.textContent = '整页双语翻译';
      status = document.createElement('p'); status.id = 'page-status'; status.setAttribute('role', 'status'); status.textContent = '准备翻译当前页面';
      progress = document.createElement('progress'); progress.id = 'page-progress'; progress.max = 1; progress.value = 0;
      const actions = document.createElement('div'); actions.className = 'actions';
      function button(label, icon, action) {
        const value = document.createElement('button'); value.type = 'button'; value.className = 'icon-button';
        value.title = label; value.setAttribute('aria-label', label); value.addEventListener('click', action);
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
        const paths = { start: ['M8 5l11 7-11 7z'], stop: ['M7 7h10v10H7z'], restore: ['M4 5v6h6', 'M4 11a8 8 0 1 1 2.3 7'], settings: ['M4 7h16M4 17h16', 'M8 4v6M16 14v6'], close: ['M6 6l12 12M18 6 6 18'] };
        for (const d of paths[icon]) { const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', d); svg.append(path); }
        value.append(svg); return value;
      }
      startButton = button('翻译 / 继续', 'start', () => start()); startButton.id = 'page-start';
      stopButton = button('停止', 'stop', stop); stopButton.id = 'page-stop'; stopButton.disabled = true;
      restoreButton = button('还原页面', 'restore', restore); restoreButton.id = 'page-restore';
      settingsButton = button('设置 / 下载模型', 'settings', () => request('open-settings').catch(error => { status.textContent = error.message; }));
      const closeButton = button('关闭面板', 'close', () => { panelVisible(false); stop(); }); closeButton.id = 'page-close';
      const heading = document.createElement('div'); heading.className = 'panel-heading'; heading.append(title, closeButton);
      actions.append(startButton, stopButton, restoreButton, settingsButton);
      panel.append(heading, language.label, status, progress, actions); shadow.append(style, panel); document.documentElement.append(toolbar);
    }
    function panelVisible(visible) {
      toolbar.hidden = !visible;
      // The host's all:initial overrides the browser's default [hidden] display rule.
      // Control display explicitly on the host, outside its shadow root.
      toolbar.style.setProperty('display', visible ? 'block' : 'none', 'important');
    }
    function startLabel(label) { startButton.title = label; startButton.setAttribute('aria-label', label); }
    function stop() {
      const awaitingApproval = apiApproval !== null;
      apiApproval = null;
      if (!running) {
        if (awaitingApproval && toolbar) { startLabel('翻译 / 继续'); status.textContent = '已取消 API 整页翻译确认，未发送正文。'; }
        return;
      }
      cancelled = true; status.textContent = '正在停止，已完成的译文保留…';
      request('cancel').catch(() => {});
    }
    function restore() {
      stop(); runNumber++;
      pendingNode?.remove(); pendingNode = null;
      for (const { node } of done.values()) node.remove();
      done.clear();
      if (toolbar) { progress.value = 0; status.textContent = '页面已还原，原文和网页交互保持不变。'; }
    }
    async function start() {
      init(); panelVisible(true);
      if (running) { status.textContent = '整页翻译正在进行，可停止后重试。'; return; }
      if (selectionBusy()) { status.textContent = '划词翻译正在进行，请先取消或等待完成。'; return; }
      const run = ++runNumber;
      running = true; cancelled = false; startButton.disabled = true; stopButton.disabled = false;
      targetSelect.disabled = true;
      const translationTarget = targetSelect.value || undefined;
      const alive = () => !cancelled && run === runNumber;
      let completed = 0, total = 0, skipped = 0;
      try {
        for (const [element, result] of done) if (!element.isConnected || !result.node.isConnected) { result.node.remove(); done.delete(element); }
        const settings = await request('settings');
        if (!alive()) return;
        const signature = JSON.stringify([settings.mode, settings.engine, translationTarget || settings.target, settings.glossaryRevision || '']);
        if (settings.mode === 'api' && apiApproval !== signature) {
          apiApproval = signature;
          startLabel('确认使用 API 翻译本页');
          status.textContent = '当前为自定义 API 模式。整页翻译会逐段发送本页正文至你配置的服务；点击 ▶ 图标确认使用 API 翻译本页后才会开始。';
          return;
        }
        apiApproval = null; startLabel('翻译 / 继续');
        for (const [element, result] of done) {
          if (result.signature !== signature) { result.node.remove(); done.delete(element); }
        }
        status.textContent = '正在收集页面中的可见正文…';
        const plan = await collect(done, signature, () => !alive());
        if (!alive()) return;
        total = plan.segments || 0; progress.max = total || 1; progress.value = 0;
        if (!total) { status.textContent = plan.limited ? '本轮未找到可处理的段落，单个段落可能超过本轮上限。' : '没有新的可翻译文字。已跳过表单、代码、隐藏内容和已完成段落。'; return; }
        for (const item of plan.items) {
          if (!alive()) break;
          if (!item.element.isConnected || originalText(item.element) !== item.source) { skipped += item.parts.length; continue; }
          const translated = [];
          const node = document.createElement('span'); node.setAttribute('data-local-page-translation', ''); node.setAttribute('aria-busy', 'true'); node.dir = 'auto';
          node.style.cssText = 'display:block;white-space:pre-wrap;overflow-wrap:anywhere;border-left:3px solid #5081dd;padding:6px 10px;margin:6px 0;color:inherit;background:rgba(80,129,221,.08);font:inherit';
          item.element.append(node); pendingNode = node;
          for (const part of item.parts) {
            if (!alive()) break;
            const started = Date.now(); let stage = settings.mode === 'api' ? '正在请求自定义 API' : '正在准备本地模型', partial = '';
            const renderProgress = () => {
              if (!alive()) return;
              status.textContent = `已完成 ${completed} / ${total} 段，正在处理第 ${completed + 1} 段\n${stage} · 已等待 ${Math.floor((Date.now() - started) / 1000)} 秒${partial ? ` · 已生成 ${[...partial].length} 字` : ''}`;
            };
            renderProgress(); clearInterval(ticker); ticker = setInterval(renderProgress, 1000);
            const result = await request('translate', { text: part, pageTranslation: true, settingsSnapshot: settings, translationTarget }, update => {
              if (!alive() || !node.isConnected) return;
              if (update.phase === 'loading' || update.phase === 'downloading') stage = `正在加载模型${Number.isFinite(update.progress) ? `（${Math.round(update.progress * 100)}%）` : ''}${update.text ? '：' + update.text : ''}`;
              else if (update.phase === 'translating') stage = '正在生成译文';
              else if (update.text) stage = update.text;
              if (typeof update.partial === 'string') { partial = update.partial; node.textContent = [...translated, partial].join('\n'); }
              renderProgress();
            });
            clearInterval(ticker); ticker = null;
            if (!alive()) break;
            translated.push(result); completed++; progress.value = completed;
            node.textContent = translated.join('\n');
          }
          if (!alive()) break;
          if (!item.element.isConnected || originalText(item.element) !== item.source) { node.remove(); pendingNode = null; skipped += item.parts.length; continue; }
          done.get(item.element)?.node.remove();
          node.removeAttribute('aria-busy'); pendingNode = null;
          done.set(item.element, { node, source: item.source, signature });
        }
        if (run === runNumber) status.textContent = cancelled ? `已停止，完成 ${completed} / ${total} 段。已显示的译文保留，可继续或还原。` : `本轮完成 ${completed} / ${total} 段。${skipped ? `页面内容发生变化，跳过 ${skipped} 段，请点击继续重新收集。` : ''}${plan.limited ? '已达到本轮 500 段 / 6 万字上限，可点击继续处理剩余内容。' : '可继续处理新加载的正文，或还原页面。'}`;
      } catch (error) {
        if (run === runNumber) status.textContent = cancelled ? `已停止，完成 ${completed} / ${total} 段。` : `翻译中断（${completed} / ${total}）：${error.message} 已完成的段落保留，可点击继续重试。`;
      } finally {
        clearInterval(ticker); ticker = null; pendingNode?.remove(); pendingNode = null;
        if (cancelled && run === runNumber) status.textContent = `已停止，完成 ${completed} / ${total} 段。已显示的译文保留，可继续或还原。`;
        running = false; startButton.disabled = false; stopButton.disabled = true; targetSelect.disabled = false;
      }
    }
    return { start, stop, restore, isRunning: () => running };
  }
  globalThis.LocalPageTranslation = Object.freeze({ create, splitText, targetSelector });
})();
