// Real Chrome MV3 integration check. No dependencies, build, or mocked inference.
// Usage: node tests/browser-check.mjs [--inference]
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
const cwd = process.cwd();
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
// Fresh profiles avoid Chromium blocking command-line-installed extensions after restart.
const profile = path.join(cwd, `.browser-test-profile-${Date.now()}`);
const evidence = [];
const server = http.createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (process.argv.includes('--page-translation')) {
    response.end('<!doctype html><html lang="en"><title>Whole-page test fixture</title><main id="fixture"><h1 id="heading">Page fixture heading</h1><p id="one">Hello <strong>world</strong>!</p><p id="two"><span>Another</span> <em>paragraph.</em></p><p id="long">' + 'Long sentence. '.repeat(90) + '</p><form><label>Private form text<input value="Private input"></label></form><pre>Private code sample</pre><div style="display:none">Private hidden text</div><p contenteditable="true">Private editable text</p><p>123456</p><button id="counter">Click counter</button><div id="dynamic"></div></main></html>');
    return;
  }
  response.end('<!doctype html><html lang="en"><title>Selection translation test</title><p id="sample">Hello, world!</p></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const child = spawn(chrome, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--remote-debugging-pipe', `--user-data-dir=${profile}`, `--disable-extensions-except=${cwd}`, `--load-extension=${cwd}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], windowsHide: true });
let buffer = '', serial = 0;
const pending = new Map();
const workerSessions = new Map();
child.stderr.on('data', () => {});
child.stdio[4].on('data', chunk => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\0')) !== -1) {
    const raw = buffer.slice(0, index); buffer = buffer.slice(index + 1);
    if (!raw) continue;
    const message = JSON.parse(raw), task = pending.get(message.id);
    if (message.method === 'Target.attachedToTarget') workerSessions.set(message.params.targetInfo.url, message.params.sessionId);
    if (task) { pending.delete(message.id); clearTimeout(task.timer); message.error ? task.reject(new Error(JSON.stringify(message.error))) : task.resolve(message.result); }
  }
});
function cdp(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 45000);
    pending.set(id, { resolve, reject, timer });
    child.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
}
async function evaluate(session, expression) {
  const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  let extension;
  // Installed extensions can start with a dormant service worker on subsequent runs.
  for (const file of ['Secure Preferences', 'Preferences']) {
    try {
      const preferences = JSON.parse(await fs.readFile(path.join(profile, 'Default', file), 'utf8'));
      const entry = Object.entries(preferences.extensions?.settings || {}).find(([, value]) => value.path && path.resolve(value.path).toLowerCase() === cwd.toLowerCase());
      if (entry) extension = { url: `chrome-extension://${entry[0]}/background.js` };
    } catch {}
  }
  for (let tries = 0; tries < 30; tries++) {
    if (extension) break;
    const targets = await cdp('Target.getTargets');
    extension = targets.targetInfos.find(target => target.type === 'service_worker' && target.url.endsWith('/background.js'));
    if (extension) break; await pause(500);
  }
  if (!extension) throw new Error('Chrome did not load the extension. Use Chrome for Testing or Chromium if this browser disables --load-extension.');
  const origin = extension.url.slice(0, extension.url.lastIndexOf('/'));
  const target = await cdp('Target.createTarget', { url: origin + '/options.html' });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  // A persisted extension may not yet be registered when a new browser process starts.
  let pageReady = false;
  for (let tries = 0; tries < 40; tries++) {
    pageReady = await evaluate(sessionId, `!!document.getElementById('engine')`);
    if (pageReady) break;
    if (tries % 4 === 3) await cdp('Page.navigate', { url: origin + '/options.html' }, sessionId);
    await pause(500);
  }
  if (!pageReady) throw new Error('Extension settings page failed to open: ' + await evaluate(sessionId, `location.href + ' ' + document.body?.innerText?.slice(0,200)`));
  if (process.argv.includes('--transformers')) {
    for (let tries = 0; tries < 40; tries++) {
      if (await evaluate(sessionId, `!!document.getElementById('engine') && document.getElementById('device').textContent !== '正在检测…'`)) break;
      await pause(500);
    }
    await evaluate(sessionId, `document.getElementById('engine').value='transformers';document.getElementById('engine').dispatchEvent(new Event('change'));document.getElementById('settings').requestSubmit()`);
    for (let tries = 0; tries < 40; tries++) {
      if (await evaluate(sessionId, `document.getElementById('message').textContent === '设置已保存。'`)) break;
      await pause(500);
    }
  }
  let status;
  for (let tries = 0; tries < 40; tries++) {
    status = await evaluate(sessionId, `({ device:document.getElementById('device')?.textContent, cache:document.getElementById('cache')?.textContent, error:document.getElementById('message')?.textContent, checks:Array.from(document.querySelectorAll('#device-checks li'),item=>item.textContent), resources:document.getElementById('device-resources')?.textContent, downloadEnabled:!document.getElementById('download')?.disabled })`);
    if (status?.device && status.device !== '正在检测…') break; await pause(500);
  }
  if (!status?.device || status.device === '正在检测…') throw new Error('MV3 messaging/offscreen initialization failed: ' + JSON.stringify(status));
  console.log('REAL_CHROME_STATUS', JSON.stringify(status));
  await evaluate(sessionId, `document.getElementById('source').value='Hello, world!';document.getElementById('translate').click()`);
  await pause(1200);
  const first = await evaluate(sessionId, `document.getElementById('message').textContent`);
  if (!/首次使用|WebGPU|兼容/.test(first) && status.cache !== '完整缓存，可离线使用') throw new Error('Expected consent or unsupported-device message: ' + first);
  console.log('FIRST_USE', first);
  if (process.argv.includes('--page-translation')) {
    const page = await cdp('Target.createTarget', { url: `http://127.0.0.1:${server.address().port}/` });
    const attached = await cdp('Target.attachToTarget', { targetId: page.targetId, flatten: true });
    const pageSession = attached.sessionId;
    await pause(700);
    await evaluate(sessionId, `document.getElementById('page-start').click()`);
    let productionStatus = '';
    for (let tries = 0; tries < 40; tries++) {
      const tree = await cdp('DOM.getDocument', { depth: -1, pierce: true }, pageSession);
      function findStatus(node) {
        const attrs = node.attributes || [];
        for (let i = 0; i < attrs.length; i += 2) if (attrs[i] === 'id' && attrs[i + 1] === 'page-status') return node;
        for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) { const found = findStatus(child); if (found) return found; }
      }
      const node = findStatus(tree.root);
      productionStatus = node?.children?.map(child => child.nodeValue).join('') || '';
      if (productionStatus.includes('首次使用')) break;
      await pause(200);
    }
    if (!productionStatus.includes('首次使用') || !productionStatus.includes('翻译中断')) throw new Error('Production page command did not expose real uncached-model error: ' + productionStatus);
    if (await evaluate(pageSession, `document.querySelectorAll('[data-local-page-translation]').length`)) throw new Error('Uncached production engine inserted fabricated text');
    await evaluate(pageSession, await fs.readFile('page-translator.js', 'utf8'));
    const workflow = await evaluate(pageSession, `(async () => {
      // Controlled DOM/scheduling fixtures only. These outputs are not model translations.
      const calls = []; let inFlight = 0, maxInFlight = 0, mode = 'local', held, holdNext = false;
      const fixture = document.getElementById('fixture'); const before = fixture.innerHTML;
      let clicks = 0; document.getElementById('counter').addEventListener('click',()=>clicks++);
      const request = async (command, options) => {
        if (command === 'settings') return {mode,engine:'webllm',target:'auto'};
        if (command === 'cancel') { held?.('[UI fixture cancelled]'); held = null; return true; }
        if (command !== 'translate') return true;
        calls.push(options); inFlight++; maxInFlight = Math.max(maxInFlight,inFlight);
        let value;
        if (holdNext) { holdNext = false; value = await new Promise(resolve=>held=resolve); }
        else { await new Promise(resolve=>setTimeout(resolve,5)); value = '[UI fixture, not model output] ' + options.text; }
        inFlight--; return value;
      };
      const controller = LocalPageTranslation.create({request});
      await controller.start();
      if (maxInFlight !== 1 || calls.some(call=>[...call.text].length>600 || !call.pageTranslation)) throw new Error('Batching/serialization failed');
      if (!calls.some(call=>call.text==='Another paragraph.') || calls.some(call=>/Private|Click counter/.test(call.text))) throw new Error('DOM extraction/skip rules failed');
      if (!document.getElementById('one').querySelector('strong') || !document.getElementById('one').querySelector('[data-local-page-translation]')) throw new Error('Inline original was not preserved');
      const firstCount = calls.length; await controller.start();
      if (calls.length !== firstCount) throw new Error('Finished paragraphs were translated again');
      controller.restore();
      if (fixture.innerHTML !== before) throw new Error('Restore changed original DOM');
      document.getElementById('counter').click(); if (clicks!==1) throw new Error('Restore lost page event listeners');
      document.getElementById('dynamic').textContent='New dynamic paragraph';
      await controller.start();
      if (!calls.some(call=>call.text==='New dynamic paragraph')) throw new Error('Dynamic text was not translated on continue');
      controller.restore();
      holdNext=true; const stopping=controller.start();
      while(!held) await new Promise(resolve=>setTimeout(resolve,5));
      controller.restore(); await stopping;
      if (document.querySelector('[data-local-page-translation]')) throw new Error('Cancelled task inserted a late translation');
      mode='api'; const beforeAPI=calls.length; await controller.start();
      if (calls.length!==beforeAPI) throw new Error('API page text sent before explicit confirmation');
      await controller.start();
      if (calls.length===beforeAPI) throw new Error('Confirmed API batch did not proceed');
      controller.restore();
      return {type:'whole-page-explicit-dom-fixtures-not-inference',segments:firstCount,maxInFlight,excludesSensitiveInputs:true,inlineDOMPreserved:true,restore:true,eventListenersPreserved:true,continueSkipsDone:true,dynamicContent:true,cancelRejectsLateResults:true,apiRequiresConfirmation:true};
    })()`);
    evidence.push({ type: 'production-whole-page-uncached-error', status: productionStatus }, workflow);
    console.log('WHOLE_PAGE', JSON.stringify(evidence));
  }
  if (process.argv.includes('--selection-popup')) {
    const page = await cdp('Target.createTarget', { url: `http://127.0.0.1:${server.address().port}/` });
    const attached = await cdp('Target.attachToTarget', { targetId: page.targetId, flatten: true });
    const pageSession = attached.sessionId;
    await pause(1000);
    function findPopupNode(node, match) {
      if (match(node)) return node;
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) { const found = findPopupNode(child, match); if (found) return found; }
    }
    async function popupNode(id, label) {
      const tree = await cdp('DOM.getDocument', { depth: -1, pierce: true }, pageSession);
      const node = findPopupNode(tree.root, node => {
        const attrs = node.attributes || [];
        if (id) { for (let i = 0; i < attrs.length; i += 2) if (attrs[i] === 'id' && attrs[i + 1] === id) return true; }
        return label && node.nodeName === 'BUTTON' && node.children?.some(child => child.nodeValue === label);
      });
      if (!node) throw new Error('Popup node missing: ' + (id || label));
      return node;
    }
    async function popupState() {
      const node = await popupNode('box');
      const object = await cdp('DOM.resolveNode', { nodeId: node.nodeId }, pageSession);
      const result = await cdp('Runtime.callFunctionOn', { objectId: object.object.objectId, functionDeclaration: 'function(){return {hidden:this.hidden,status:this.querySelector("#status").textContent}}', returnByValue: true }, pageSession);
      return result.result.value;
    }
    async function realClick(id, label) {
      const node = await popupNode(id, label);
      const { model } = await cdp('DOM.getBoxModel', { nodeId: node.nodeId }, pageSession);
      const x = (model.content[0] + model.content[2]) / 2, y = (model.content[1] + model.content[5]) / 2;
      await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, pageSession);
      await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, pageSession);
      await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, pageSession);
      await pause(500);
    }
    async function selectText(text) {
      await evaluate(pageSession, `(() => {const sample=document.getElementById('sample');sample.textContent=${JSON.stringify(text)};const range=document.createRange();range.selectNodeContents(sample);getSelection().removeAllRanges();getSelection().addRange(range);sample.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));})()`);
      await pause(100);
    }
    await selectText('Hello, world!');
    await realClick('trigger');
    const opened = await popupState();
    if (opened.hidden) throw new Error('Popup closed after real mouse click: ' + JSON.stringify(opened));
    await realClick(null, '重试');
    if ((await popupState()).hidden) throw new Error('Retry closed the popup');
    await realClick(null, '取消');
    if ((await popupState()).hidden) throw new Error('Cancel closed the popup');
    await realClick(null, '关闭');
    if (!(await popupState()).hidden) throw new Error('Explicit close did not close the popup');
    await selectText('Good morning!'); await realClick('trigger');
    if ((await popupState()).hidden) throw new Error('Second selection did not stay open');
    if (process.argv.includes('--history-ui')) {
      const original = await popupNode('original');
      if (original.children?.map(node => node.nodeValue).join('') !== 'Good morning!') throw new Error('Bilingual popup original text missing');
      await realClick(null, '翻译历史');
    }
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' }, pageSession);
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' }, pageSession);
    if (!(await popupState()).hidden) throw new Error('Escape did not close the popup');
    evidence.push({ type: 'real-mouse-popup-events', opened, retryStaysOpen: true, cancelStaysOpen: true, explicitClose: true, secondSelection: true, escapeClose: true });
    console.log('SELECTION_POPUP', JSON.stringify(evidence));
  }
  if (process.argv.includes('--history-ui')) {
    // Explicit UI fixtures: these are not model outputs or inference evidence.
    const fixtures = [
      { id: 'ui-fixture-a', createdAt: Date.now(), source: 'UI fixture: <img src=x onerror=alert(1)>', translation: '历史界面测试数据 A（非模型译文）', target: '简体中文', mode: 'local', engine: 'webllm' },
      { id: 'ui-fixture-b', createdAt: Date.now() - 1000, source: '界面测试原文 B', translation: 'History UI fixture B (not inference)', target: 'English', mode: 'local', engine: 'transformers' }
    ];
    await evaluate(sessionId, `chrome.storage.local.set({translationHistory:${JSON.stringify(fixtures)},translationHistoryEnabled:true})`);
    let target = (await cdp('Target.getTargets')).targetInfos.find(target => target.url === origin + '/options.html#history');
    if (!target) throw new Error('History shortcut did not open its settings tab');
    const attached = await cdp('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    const historySession = attached.sessionId;
    const cards = () => evaluate(historySession, `Array.from(document.querySelectorAll('.history-card'),card=>card.textContent)`);
    for (let tries = 0; tries < 40 && (await cards()).length !== 2; tries++) {
      await evaluate(historySession, `document.getElementById('history-refresh')?.click()`); await pause(100);
    }
    if ((await cards()).length !== 2) throw new Error('History fixtures not rendered');
    if (await evaluate(historySession, `!!document.querySelector('#history-list img')`)) throw new Error('History rendered source as HTML');
    await evaluate(historySession, `document.getElementById('history-search').value='UI FIXTURE';document.getElementById('history-search').dispatchEvent(new Event('input'))`); await pause(400);
    if ((await cards()).length !== 2) throw new Error('Case-insensitive bilingual search failed');
    await evaluate(historySession, `document.getElementById('history-search').value='onerror';document.getElementById('history-search').dispatchEvent(new Event('input'))`); await pause(400);
    if ((await cards()).length !== 1) throw new Error('Source search failed');
    await evaluate(historySession, `document.querySelector('.history-card button').click()`); await pause(300);
    if ((await cards()).length) throw new Error('Single history deletion failed');
    await evaluate(historySession, `document.getElementById('history-search').value='';document.getElementById('history-enabled').checked=false;document.getElementById('history-enabled').dispatchEvent(new Event('change'))`); await pause(300);
    const enabled = await evaluate(historySession, `chrome.storage.local.get('translationHistoryEnabled').then(data=>data.translationHistoryEnabled)`);
    if (enabled !== false || (await cards()).length !== 1) throw new Error('History opt-out did not preserve prior records');
    await cdp('Page.enable', {}, historySession);
    await evaluate(historySession, `setTimeout(()=>document.getElementById('history-clear').click(),0)`); await pause(150);
    await cdp('Page.handleJavaScriptDialog', { accept: true }, historySession); await pause(250);
    if ((await cards()).length) throw new Error('History clear failed');
    const snapshot = await evaluate(sessionId, `({original:document.getElementById('trial-original').textContent,visible:!document.getElementById('trial-comparison').hidden})`);
    if (snapshot.original !== 'Hello, world!' || !snapshot.visible) throw new Error('Trial bilingual original was not captured');
    evidence.push({ type: 'history-ui-explicit-fixtures-not-inference', rendered: 2, safeText: true, search: true, delete: true, persistedOptOut: true, priorRecordsRetained: true, clear: true, trialOriginal: snapshot.original, popupOriginal: 'Good morning!', historyShortcut: true });
    console.log('HISTORY_UI', JSON.stringify(evidence.at(-1)));
  }
  if (process.argv.includes('--download-button')) {
    const savedEngine = process.argv.includes('--transformers') ? 'transformers' : 'webllm';
    const otherEngine = savedEngine === 'transformers' ? 'webllm' : 'transformers';
    await evaluate(sessionId, `document.getElementById('engine').value=${JSON.stringify(otherEngine)};document.getElementById('engine').dispatchEvent(new Event('change'))`);
    const unsaved = await evaluate(sessionId, `({label:document.getElementById('download').textContent,disabled:document.getElementById('download').disabled,cursor:getComputedStyle(document.getElementById('download')).cursor,busy:document.getElementById('download').getAttribute('aria-busy'),title:document.getElementById('download').title})`);
    if (unsaved.label !== '请先保存所选引擎' || !unsaved.disabled || unsaved.cursor !== 'not-allowed' || unsaved.busy !== 'false') throw new Error('Unsaved engine resembles active download: ' + JSON.stringify(unsaved));
    await evaluate(sessionId, `document.getElementById('engine').value=${JSON.stringify(savedEngine)};document.getElementById('engine').dispatchEvent(new Event('change'))`);
    const checking = await evaluate(sessionId, `({label:document.getElementById('download').textContent,cursor:getComputedStyle(document.getElementById('download')).cursor})`);
    if (checking.label !== '等待设备检测' || checking.cursor !== 'not-allowed') throw new Error('Unknown compatibility resembles active download: ' + JSON.stringify(checking));
    await evaluate(sessionId, `document.getElementById('refresh').click()`);
    for (let tries = 0; tries < 40; tries++) { if (!await evaluate(sessionId, `document.getElementById('refresh').disabled`)) break; await pause(250); }
    const ready = await evaluate(sessionId, `({label:document.getElementById('download').textContent,disabled:document.getElementById('download').disabled,cursor:getComputedStyle(document.getElementById('download')).cursor})`);
    if (ready.label !== '确认下载 / 修复缓存' || ready.disabled || ready.cursor !== 'pointer') throw new Error('Download button did not recover: ' + JSON.stringify(ready));
    evidence.push({ type: 'download-button-unsaved-engine', ...unsaved }, { type: 'download-button-before-check', ...checking }, { type: 'download-button-ready', ...ready });
    console.log('DOWNLOAD_BUTTON', JSON.stringify(evidence));
  }
  if (process.argv.includes('--device-check')) {
    if (status.checks.length < 5 || !status.downloadEnabled || !status.device.includes('基础兼容性检测通过')) throw new Error('Device report incomplete: ' + JSON.stringify(status));
    const targets = await cdp('Target.getTargets');
    const offscreen = targets.targetInfos.find(target => target.url.endsWith('/offscreen.html'));
    if (!offscreen) throw new Error('Offscreen target not found');
    const attached = await cdp('Target.attachToTarget', { targetId: offscreen.targetId, flatten: true });
    await cdp('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, attached.sessionId);
    for (let tries = 0; tries < 20 && ![...workerSessions.keys()].some(url => url.endsWith('/engine-worker.js')); tries++) await pause(100);
    const workerSession = [...workerSessions.entries()].find(([url]) => url.endsWith('/engine-worker.js'))?.[1];
    if (!workerSession) throw new Error('Inference worker session not found');
    await evaluate(workerSession, `Object.defineProperty(navigator,'gpu',{value:undefined,configurable:true})`);
    await evaluate(sessionId, `document.getElementById('refresh').click()`);
    await pause(1000);
    const blocked = await evaluate(sessionId, `({device:document.getElementById('device').textContent,downloadDisabled:document.getElementById('download').disabled,translateDisabled:document.getElementById('translate').disabled})`);
    if (!blocked.device.includes('不支持 WebGPU') || !blocked.downloadDisabled || !blocked.translateDisabled) throw new Error('Unsupported device was not blocked: ' + JSON.stringify(blocked));
    await evaluate(sessionId, `document.getElementById('mode').value='api';document.getElementById('mode').dispatchEvent(new Event('change'))`);
    if (await evaluate(sessionId, `document.getElementById('translate').disabled`)) throw new Error('API mode was incorrectly blocked by GPU compatibility');
    evidence.push({ type: 'device-positive-real-gpu', ...status }, { type: 'device-negative-injected-no-webgpu', ...blocked, apiRemainsAvailable: true });
    console.log('DEVICE_CHECKS', JSON.stringify(evidence));
  }
  if (process.argv.includes('--inference')) {
    if (!status.device.includes('可用')) throw new Error('Real inference unavailable: ' + status.device);
    for (let tries = 0; tries < 180; tries++) {
      if (!await evaluate(sessionId, `document.getElementById('translate').disabled`)) break;
      await pause(1000);
    }
    await evaluate(sessionId, `document.getElementById('agree').checked=true;document.getElementById('download').click()`);
    let ready = false;
    for (let tries = 0; tries < 1800; tries++) {
      const snapshot = await evaluate(sessionId, `({busy:document.getElementById('download').disabled,phase:document.getElementById('phase').textContent,detail:document.getElementById('detail').textContent,message:document.getElementById('message').textContent})`);
      if (tries % 15 === 0) console.log('MODEL_PROGRESS', JSON.stringify(snapshot));
      if (!snapshot.busy) { if (snapshot.phase !== '已就绪') throw new Error('Model load failed: ' + JSON.stringify(snapshot)); ready = true; break; }
      await pause(1000);
    }
    if (!ready) throw new Error('Model download timed out');
    // Real generation, then release and repeat under offline CDP network emulation.
    async function translate(text) {
      await evaluate(sessionId, `document.getElementById('source').value=${JSON.stringify(text)};document.getElementById('translate').click()`);
      for (let tries = 0; tries < 180; tries++) {
        const result = await evaluate(sessionId, `({busy:document.getElementById('translate').disabled,text:document.getElementById('translation').textContent,message:document.getElementById('message').textContent})`);
        if (!result.busy) { if (result.message !== '翻译完成。' || !result.text) throw new Error('Inference failed: ' + JSON.stringify(result)); return result; }
        await pause(1000);
      }
      throw new Error('Inference timeout');
    }
    const online = await translate('Hello, world!'); evidence.push({ type: 'real-local', input: 'Hello, world!', ...online });
    console.log('REAL_TRANSLATION', JSON.stringify(online));
    await evaluate(sessionId, `document.getElementById('release').click()`); await pause(1000);
    const targets = await cdp('Target.getTargets');
    for (const worker of targets.targetInfos.filter(target => ['worker', 'page', 'other'].includes(target.type) && target.url.startsWith(origin))) {
      const attached = await cdp('Target.attachToTarget', { targetId: worker.targetId, flatten: true });
      await cdp('Network.enable', {}, attached.sessionId).catch(() => {});
      await cdp('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 }, attached.sessionId).catch(() => {});
    }
    const offline = await translate('今天天气很好。'); evidence.push({ type: 'real-offline-after-release', input: '今天天气很好。', ...offline });
    console.log('REAL_OFFLINE_TRANSLATION', JSON.stringify(offline));
    const page = await cdp('Target.createTarget', { url: `http://127.0.0.1:${server.address().port}/` });
    const attached = await cdp('Target.attachToTarget', { targetId: page.targetId, flatten: true });
    await pause(1000);
    await evaluate(attached.sessionId, `(() => {const sample=document.getElementById('sample');const range=document.createRange();range.selectNodeContents(sample);getSelection().removeAllRanges();getSelection().addRange(range);sample.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));})()`);
    await pause(300);
    const tree = await cdp('DOM.getDocument', { depth: -1, pierce: true }, attached.sessionId);
    function find(node, id) {
      const attrs = node.attributes || [];
      for (let i = 0; i < attrs.length; i += 2) if (attrs[i] === 'id' && attrs[i + 1] === id) return node;
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) { const match = find(child, id); if (match) return match; }
    }
    const trigger = find(tree.root, 'trigger');
    if (!trigger) throw new Error('Selection did not display the translation button.');
    const object = await cdp('DOM.resolveNode', { nodeId: trigger.nodeId }, attached.sessionId);
    await cdp('Runtime.callFunctionOn', { objectId: object.object.objectId, functionDeclaration: 'function(){this.click()}' }, attached.sessionId);
    let popup;
    for (let tries = 0; tries < 180; tries++) {
      const currentTree = await cdp('DOM.getDocument', { depth: -1, pierce: true }, attached.sessionId);
      const statusNode = find(currentTree.root, 'status');
      const outputNode = find(currentTree.root, 'output');
      popup = { status: statusNode?.children?.map(node => node.nodeValue).join(''), text: outputNode?.children?.map(node => node.nodeValue).join('') };
      if (popup.status?.includes('翻译完成')) break;
      if (tries === 179) throw new Error('Selection popup timed out: ' + JSON.stringify(popup));
      await pause(1000);
    }
    if (!popup.text || !popup.status.includes('文字未上传')) throw new Error('Invalid selection popup result: ' + JSON.stringify(popup));
    evidence.push({ type: 'real-selection-popup', input: 'Hello, world!', ...popup });
    console.log('REAL_SELECTION_POPUP', JSON.stringify(popup));
    if (process.argv.includes('--history')) {
      const currentTree = await cdp('DOM.getDocument', { depth: -1, pierce: true }, attached.sessionId);
      const originalNode = find(currentTree.root, 'original');
      if (originalNode?.children?.map(node => node.nodeValue).join('') !== 'Hello, world!') throw new Error('Popup original text is missing');
      const boxNode = find(currentTree.root, 'box');
      const boxObject = await cdp('DOM.resolveNode', { nodeId: boxNode.nodeId }, attached.sessionId);
      await cdp('Runtime.callFunctionOn', { objectId: boxObject.object.objectId, functionDeclaration: 'function(){Array.from(this.querySelectorAll("button")).find(button=>button.textContent==="翻译历史").click()}' }, attached.sessionId);
      let historyTarget;
      for (let tries = 0; tries < 40; tries++) {
        historyTarget = (await cdp('Target.getTargets')).targetInfos.find(target => target.url === origin + '/options.html#history');
        if (historyTarget) break; await pause(100);
      }
      if (!historyTarget) throw new Error('Popup history shortcut did not open the history page');
      const historyAttached = await cdp('Target.attachToTarget', { targetId: historyTarget.targetId, flatten: true });
      const historySession = historyAttached.sessionId;
      const cards = () => evaluate(historySession, `Array.from(document.querySelectorAll('.history-card'),card=>({text:card.textContent,source:card.querySelector('pre')?.textContent}))`);
      for (let tries = 0; tries < 40 && (await cards()).length < 2; tries++) await pause(100);
      const initial = await cards();
      if (!initial.some(item => item.text.includes('Hello, world!') && item.text.includes(online.text)) || !initial.some(item => item.text.includes('今天天气很好。') && item.text.includes(offline.text))) throw new Error('Real successful translations were not saved: ' + JSON.stringify(initial));
      const trialOriginal = await evaluate(sessionId, `document.getElementById('trial-original').textContent`);
      if (trialOriginal !== '今天天气很好。') throw new Error('Trial bilingual original mismatch: ' + trialOriginal);
      await evaluate(historySession, `document.getElementById('history-search').value='HELLO';document.getElementById('history-search').dispatchEvent(new Event('input'))`);
      await pause(500);
      const matched = await cards();
      if (matched.length !== 1 || matched[0].source !== 'Hello, world!') throw new Error('History search failed');
      await evaluate(historySession, `document.querySelector('.history-card button').click()`);
      await pause(300);
      if ((await cards()).length !== 0) throw new Error('Single-entry deletion failed');
      await evaluate(historySession, `document.getElementById('history-search').value='';document.getElementById('history-search').dispatchEvent(new Event('input'));document.getElementById('history-enabled').checked=false;document.getElementById('history-enabled').dispatchEvent(new Event('change'))`);
      await pause(500);
      const before = (await cards()).length;
      await translate('Hello, world!');
      await evaluate(historySession, `document.getElementById('history-refresh').click()`); await pause(300);
      if ((await cards()).length !== before) throw new Error('Disabled history recorded a new translation');
      await cdp('Page.enable', {}, historySession);
      await evaluate(historySession, `setTimeout(()=>document.getElementById('history-clear').click(),0)`);
      await pause(200); await cdp('Page.handleJavaScriptDialog', { accept: true }, historySession); await pause(300);
      if ((await cards()).length !== 0) throw new Error('History clear failed');
      await evaluate(historySession, `document.getElementById('refresh').click()`); await pause(500);
      const retainedCache = await evaluate(historySession, `document.getElementById('cache').textContent`);
      if (retainedCache !== '完整缓存，可离线使用') throw new Error('Clearing history affected model cache');
      evidence.push({ type: 'real-bilingual-and-history', popupOriginal: 'Hello, world!', trialOriginal, savedTranslations: initial.length, searchedAndDeleted: true, optOut: true, clear: true, retainedCache, historyShortcut: true });
      console.log('HISTORY', JSON.stringify(evidence.at(-1)));
    }
  }
  const resultFile = process.argv.includes('--page-translation') ? 'tests/page-translation-result.json' : process.argv.includes('--history-ui') ? 'tests/history-ui-result.json' : process.argv.includes('--history') ? 'tests/history-browser-result.json' : process.argv.includes('--selection-popup') ? 'tests/selection-popup-result.json' : process.argv.includes('--download-button') ? 'tests/download-button-result.json' : process.argv.includes('--device-check') ? 'tests/device-browser-result.json' : process.argv.includes('--transformers') ? (process.argv.includes('--inference') ? 'tests/transformers-browser-result.json' : 'tests/transformers-smoke-result.json') : 'tests/browser-result.json';
  await fs.writeFile(resultFile, JSON.stringify({ date: new Date().toISOString(), browser: chrome, status, first, inferenceRequested: process.argv.includes('--inference'), evidence }, null, 2));
} finally {
  server.close();
  await cdp('Browser.close').catch(() => {});
  child.kill();
}
