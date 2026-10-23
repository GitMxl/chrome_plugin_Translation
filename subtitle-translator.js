(() => {
  const MAX_TEXT = 2400, CACHE_LIMIT = 128;
  function cueText(cues) {
    return Array.from(cues || [], cue => typeof cue.getCueAsHTML === 'function' ? cue.getCueAsHTML().textContent : cue.text || '').join('\n').trim();
  }
  function create({ request, otherBusy = () => false }) {
    let host, root, overlay, panel, original, translation, status, videoSelect, sourceSelect, targetSelect, startButton, stopButton;
    let videos = [], video, source, running = false, preparing = false, epoch = 0, timer, current = '', candidate = '', changedAt = 0;
    let snapshot, translationTarget, approval = '', signature = '', busy = false, disposed = false;
    const cache = new Map(), changedModes = new Map();
    const element = (tag, text, id) => { const node = document.createElement(tag); if (text) node.textContent = text; if (id) node.id = id; return node; };
    const icons = {
      '开始 / 恢复': 'm8 5 11 7-11 7Z',
      '确认使用 API 翻译字幕': 'm12 3 8 4v5c0 5-8 9-8 9s-8-4-8-9V7ZM8 12l3 3 5-6',
      '停止': 'M6 6h12v12H6Z',
      '重新检测': 'M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 17.9 17',
      '设置': 'M4 7h9m4 0h3M4 17h3m4 0h9M13 4v6M7 14v6',
      '双语全屏': 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',
      '收起': 'm6 15 6-6 6 6',
      '展开': 'm6 9 6 6 6-6',
      '关闭': 'm6 6 12 12M6 18 18 6'
    };
    function setButtonLabel(node, text) {
      node.title = text; node.setAttribute('aria-label', text);
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '20'); svg.setAttribute('height', '20');
      svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.8');
      svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
      svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', icons[text]);
      svg.append(path); node.replaceChildren(svg);
    }
    function button(text, id, action) { const node = element('button', '', id); node.type = 'button'; setButtonLabel(node, text); node.addEventListener('click', action); return node; }
    function controls() {
      for (const select of [videoSelect, sourceSelect, targetSelect]) select.disabled = running || preparing;
      startButton.disabled = running || preparing; stopButton.disabled = !running && !preparing && !approval;
    }
    function init() {
      if (host) { host.hidden = false; return; }
      host = element('div'); host.setAttribute('data-local-translator-ui', 'subtitles');
      host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none';
      root = host.attachShadow({ mode: 'closed' });
      const style = element('style'); style.textContent = ':host{all:initial}*{box-sizing:border-box}[hidden]{display:none!important}.panel{position:fixed;right:16px;top:16px;width:310px;max-width:calc(100vw - 32px);max-height:calc(100vh - 32px);overflow:auto;padding:14px;background:#fff;color:#19324c;border:1px solid #d6e1db;border-radius:12px;box-shadow:0 6px 28px #18345230;font:13px/1.6 system-ui;pointer-events:auto}.heading,.actions{display:flex;gap:8px;align-items:center;justify-content:space-between}.actions{justify-content:flex-start;flex-wrap:wrap;margin-top:10px}.heading strong{font-size:15px;margin-right:auto}label{display:flex;align-items:center;gap:8px;margin:8px 0}select{flex:1;min-width:0;max-width:100%;padding:5px;border:1px solid #ccd8d2;border-radius:6px;background:#fff;color:#19324c;font:13px system-ui}button{display:inline-flex;align-items:center;justify-content:center;flex:0 0 36px;width:36px;height:36px;border:1px solid #ccd8d2;border-radius:6px;padding:7px;background:#f5f8f6;color:#19324c;cursor:pointer;font:13px system-ui}button svg{display:block;pointer-events:none}button:hover:not(:disabled){background:#e6efe9}button:focus-visible{outline:2px solid #14786b;outline-offset:2px}#subtitle-start{background:#14786b;color:white}button:disabled,select:disabled{opacity:.55;cursor:not-allowed}p{margin:7px 0;white-space:pre-wrap;overflow-wrap:anywhere}.hint{font-size:12px;color:#617267}.captions{position:fixed;text-align:center;color:white;font:600 clamp(15px,2.1vw,24px)/1.5 system-ui;pointer-events:none;overflow:hidden;max-height:40vh;text-shadow:0 1px 3px #000}.captions div{white-space:pre-wrap;overflow-wrap:anywhere;background:#101820dd;padding:2px 10px}.captions #subtitle-translation{color:#b7ffe5}.captions div:empty{display:none}';
      panel = element('section', '', 'subtitle-panel'); panel.className = 'panel'; panel.setAttribute('aria-label', '字幕双语翻译');
      const heading = element('div'); heading.className = 'heading';
      const controlsArea = element('div', '', 'subtitle-controls');
      const collapse = button('收起', 'subtitle-collapse', () => {
        controlsArea.hidden = !controlsArea.hidden;
        setButtonLabel(collapse, controlsArea.hidden ? '展开' : '收起');
        collapse.setAttribute('aria-expanded', String(!controlsArea.hidden));
        panel.style.width = controlsArea.hidden ? '260px' : '310px';
      }); collapse.setAttribute('aria-expanded', 'true');
      heading.append(element('strong', '字幕双语翻译'), collapse, button('关闭', 'subtitle-close', () => { stop(); host.hidden = true; }));
      videoSelect = element('select', '', 'subtitle-video'); sourceSelect = element('select', '', 'subtitle-source');
      const videoLabel = element('label', '视频 '); videoLabel.append(videoSelect);
      const sourceLabel = element('label', '字幕来源 '); sourceLabel.append(sourceSelect);
      const language = globalThis.LocalPageTranslation.targetSelector('subtitle-target'); targetSelect = language.select;
      videoSelect.addEventListener('change', () => { approval = ''; setButtonLabel(startButton, '开始 / 恢复'); refreshSources(); controls(); });
      for (const select of [sourceSelect, targetSelect]) select.addEventListener('change', () => { approval = ''; setButtonLabel(startButton, '开始 / 恢复'); status.textContent = '选择已更新，点击开始翻译。'; controls(); });
      status = element('p', '先开启播放器字幕，再开始翻译。', 'subtitle-status'); status.setAttribute('role', 'status');
      const hint = element('p', '读取现有字幕，不识别音频。若译文跟不上播放，可暂停视频等待。'); hint.className = 'hint';
      const actions = element('div'); actions.className = 'actions';
      startButton = button('开始 / 恢复', 'subtitle-start', () => start()); stopButton = button('停止', 'subtitle-stop', stop);
      actions.append(startButton, stopButton, button('重新检测', 'subtitle-refresh', () => { if (!running && !preparing) { approval = ''; refreshVideos(); status.textContent = '已重新检测视频与字幕。'; } }), button('设置', 'subtitle-settings', () => request('open-settings').catch(error => { status.textContent = error.message; })));
      const fullscreen = button('双语全屏', 'subtitle-fullscreen', async () => {
        try {
          const selected = video || videos[Number(videoSelect.value)];
          const container = selected?.closest('.html5-video-player') || selected?.parentElement;
          if (!container?.requestFullscreen) throw new Error('请先选择视频。');
          await container.requestFullscreen();
        } catch (error) { status.textContent = error.message; }
      });
      actions.append(fullscreen);
      controlsArea.append(videoLabel, sourceLabel, language.label, status, hint, actions); panel.append(heading, controlsArea);
      overlay = element('div', '', 'subtitle-overlay'); overlay.className = 'captions'; overlay.hidden = true;
      original = element('div', '', 'subtitle-original'); original.dir = 'auto';
      translation = element('div', '', 'subtitle-translation'); translation.dir = 'auto';
      overlay.append(original, translation); root.append(style, panel, overlay); document.documentElement.append(host);
      document.addEventListener('fullscreenchange', layout);
      window.addEventListener('resize', layout); window.addEventListener('scroll', layout, true);
      refreshVideos(); controls();
    }
    function options(select, items) {
      select.replaceChildren(...items.map(([value, text]) => { const option = element('option', text); option.value = value; return option; }));
    }
    function refreshVideos(videoURL) {
      videos = Array.from(document.querySelectorAll('video')).filter(item => item.getClientRects().length).sort((a, b) => Number(a.paused) - Number(b.paused) || b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height);
      options(videoSelect, videos.map((item, index) => [String(index), `视频 ${index + 1}${item.paused ? '' : '（正在播放）'}`]));
      if (videoURL) { const index = videos.findIndex(item => item.currentSrc === videoURL || item.src === videoURL); if (index >= 0) videoSelect.value = String(index); }
      refreshSources();
    }
    function refreshSources() {
      const selected = videos[Number(videoSelect.value)];
      const tracks = Array.from(selected?.textTracks || []).map((track, index) => ({ track, index })).filter(({ track }) => ['subtitles', 'captions'].includes(track.kind));
      const items = tracks.map(({ track, index }) => [`track-${index}`, track.label || track.language || `字幕轨道 ${index + 1}`]);
      if (selected?.closest('.html5-video-player')) items.unshift(['youtube', 'YouTube 已显示字幕']);
      options(sourceSelect, items);
      const showing = tracks.find(({ track }) => track.mode === 'showing');
      if (showing) sourceSelect.value = `track-${showing.index}`;
    }
    function layout() {
      if (!host) return;
      const fullscreen = document.fullscreenElement;
      const parent = fullscreen && fullscreen.tagName !== 'VIDEO' ? fullscreen : document.documentElement;
      if (host.parentElement !== parent) parent.append(host);
      if (!video?.isConnected) { overlay.hidden = true; return; }
      const rect = video.getBoundingClientRect();
      const left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right);
      const bottom = Math.min(innerHeight, rect.bottom) - Math.min(64, rect.height * .14);
      overlay.style.left = `${left}px`; overlay.style.width = `${Math.max(0, right - left)}px`;
      overlay.style.bottom = `${Math.max(0, innerHeight - bottom)}px`;
      overlay.hidden = !running || !current || bottom <= 0 || rect.top >= innerHeight || right <= left || fullscreen?.tagName === 'VIDEO';
      if (fullscreen?.tagName === 'VIDEO' && running) status.textContent = '原生视频全屏无法叠加字幕，请退出后使用「双语全屏」。';
    }
    function read() {
      if (!video?.isConnected || video.ended) return '';
      if (source === 'youtube') {
        const player = video.closest('.html5-video-player');
        return Array.from(player?.querySelectorAll('.ytp-caption-segment') || []).filter(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden').map(node => node.textContent).join('\n').trim();
      }
      const track = video.textTracks[Number(source.slice(6))];
      return cueText(Array.from(track?.activeCues || []).filter(cue => cue.startTime <= video.currentTime && video.currentTime < cue.endTime));
    }
    function stop() {
      epoch++; running = preparing = false; approval = ''; clearInterval(timer); timer = null;
      if (busy) request('cancel').catch(() => {});
      current = candidate = ''; original && (original.textContent = ''); translation && (translation.textContent = '');
      if (overlay) overlay.hidden = true;
      for (const [track, mode] of changedModes) if (track.mode === 'hidden') track.mode = mode;
      changedModes.clear();
      if (host) { setButtonLabel(startButton, '开始 / 恢复'); status.textContent = '已停止字幕翻译。'; controls(); }
    }
    async function start(videoURL) {
      if (disposed) return;
      init();
      if (running || preparing) return;
      if (otherBusy()) { status.textContent = '其他翻译正在进行，请先停止或等待完成。'; return; }
      if (!videos[Number(videoSelect.value)]?.isConnected || videoURL) refreshVideos(videoURL);
      video = videos[Number(videoSelect.value)]; source = sourceSelect.value;
      if (!video) { status.textContent = '未找到当前页面的视频。仅支持顶层网页中的视频，请打开视频所在网页后重试。'; return; }
      if (!source) { status.textContent = '没有可读取的字幕轨道。请先开启播放器字幕，再点击重新检测。暂不支持语音识别或画面内嵌字幕。'; return; }
      const run = ++epoch; preparing = true; controls(); status.textContent = '正在读取翻译设置…';
      try {
        const settings = await request('settings');
        if (run !== epoch) return;
        translationTarget = targetSelect.value || undefined;
        const key = JSON.stringify([settings.mode, settings.engine, settings.target, translationTarget, videoSelect.value, source]);
        if (settings.mode === 'api' && approval !== key) {
          approval = key; setButtonLabel(startButton, '确认使用 API 翻译字幕');
          status.textContent = 'API 模式会持续发送当前字幕文字至你配置的服务。点击确认后开始，不发送视频或音频。'; return;
        }
        approval = ''; snapshot = settings;
        if (signature !== key) { cache.clear(); signature = key; }
        if (source.startsWith('track-')) {
          const track = video.textTracks[Number(source.slice(6))];
          if (!track) throw new Error('字幕轨道已变化，请重新检测。');
          if (track.mode !== 'hidden') { changedModes.set(track, track.mode); track.mode = 'hidden'; }
        }
        running = true; current = candidate = ''; setButtonLabel(startButton, '开始 / 恢复');
        status.textContent = '字幕翻译已开启，等待字幕出现。';
        timer = setInterval(tick, 200); tick();
      } catch (error) { if (run === epoch) status.textContent = error.message; }
      finally { if (run === epoch) { preparing = false; controls(); } }
    }
    function tick() {
      if (!running) return;
      if (!video.isConnected) { stop(); status.textContent = '视频已切换，请重新检测后开始。'; return; }
      let text;
      try { text = read(); } catch { stop(); status.textContent = '无法读取此字幕，请开启可访问的字幕轨道后重试。'; return; }
      if (text !== current) {
        current = text; original.textContent = text; translation.textContent = '';
        candidate = text; changedAt = Date.now();
        status.textContent = text ? '正在准备当前字幕译文…' : '等待下一句字幕；没有文字时请确认播放器已开启字幕。';
      }
      layout();
      if (!text) return;
      if ([...text].length > MAX_TEXT) { status.textContent = '当前字幕过长，已跳过，请选择较短的字幕轨道。'; return; }
      if (cache.has(text)) { translation.textContent = cache.get(text); status.textContent = '双语字幕已同步。'; return; }
      if (!busy && candidate === text && Date.now() - changedAt >= 250) pump(text);
    }
    async function pump(text) {
      const run = epoch; busy = true;
      try {
        const translated = [];
        for (const part of globalThis.LocalPageTranslation.splitText(text)) {
          if (!running || run !== epoch || current !== text) return;
          const result = await request('translate', { text: part, subtitleTranslation: true, settingsSnapshot: snapshot, translationTarget }, update => {
            if (!running || run !== epoch || current !== text) return;
            if (typeof update.partial === 'string') translation.textContent = [...translated, update.partial].join('\n');
            status.textContent = update.text || '正在生成字幕译文…';
          });
          if (run !== epoch) return;
          translated.push(result);
        }
        cache.set(text, translated.join('\n'));
        if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
        if (running && current === text) { translation.textContent = translated.join('\n'); status.textContent = '双语字幕已同步。'; }
      } catch (error) {
        if (run === epoch && running) { stop(); status.textContent = `字幕翻译已暂停：${error.message} 点击开始可重试。`; }
      } finally { busy = false; }
    }
    function destroy() { stop(); disposed = true; host?.remove(); cache.clear(); document.removeEventListener('fullscreenchange', layout); window.removeEventListener('resize', layout); window.removeEventListener('scroll', layout, true); }
    return { start, stop, destroy, isRunning: () => running || preparing };
  }
  globalThis.LocalSubtitleTranslation = Object.freeze({ create, cueText });
})();
