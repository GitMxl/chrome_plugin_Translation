import { DEFAULTS, validateSettings, validateText, isTargetLanguage } from './shared.js';
import { createHistoryStore } from './history-store.js';
const history = createHistoryStore(chrome.storage.local);
let creating;
const clients = new Map();
async function captureImage(tab) {
  if (!tab) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!Number.isInteger(tab?.id) || !/^https?:\/\//i.test(tab.url || '')) throw new Error('请在普通 HTTP(S) 网页上使用图片区域翻译。');
  const [before] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  if (before?.id !== tab.id || before.url !== tab.url) throw new Error('当前网页已切换，请重新截图。');
  const data = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const [current] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  if (current?.id !== tab.id || current.url !== tab.url) throw new Error('当前网页已切换，请重新截图。');
  const key = `image-capture-${crypto.randomUUID()}`;
  // Expire screenshots whose result tabs were never opened.
  const previous = await chrome.storage.session.get(null);
  const expired = Object.keys(previous).filter(name => name.startsWith('image-capture-') && Date.now() - previous[name].created > 300000);
  if (expired.length) await chrome.storage.session.remove(expired);
  await chrome.storage.session.set({ [key]: { data, created: Date.now() } });
  try { await chrome.tabs.create({ url: chrome.runtime.getURL(`image.html#${key}`) }); }
  catch (error) { await chrome.storage.session.remove(key); throw error; }
  return true;
}
async function controlPage(command, tabId) {
  if (!Number.isInteger(tabId)) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
  }
  if (!Number.isInteger(tabId)) throw new Error('请先打开需要翻译的网页。');
  try { return await chrome.tabs.sendMessage(tabId, { target: 'page-translator', command }, { frameId: 0 }); }
  catch { throw new Error('当前页面无法使用整页翻译。请切换到普通 HTTP(S) 网页；安装或更新扩展后请先刷新网页。'); }
}
async function controlSubtitles(command, tabId, videoURL) {
  if (!Number.isInteger(tabId)) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); tabId = tab?.id;
  }
  if (!Number.isInteger(tabId)) throw new Error('请先打开包含视频的网页。');
  try { return await chrome.tabs.sendMessage(tabId, { target: 'subtitle-translator', command, videoURL }, { frameId: 0 }); }
  catch { throw new Error('当前页面无法使用字幕翻译。请打开视频所在的普通 HTTP(S) 网页，更新扩展后先刷新网页。'); }
}
if (chrome.contextMenus) {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
      for (const [id, title] of [['page-start', '翻译整页（双语对照）'], ['page-stop', '停止整页翻译'], ['page-restore', '还原页面翻译']]) chrome.contextMenus.create({ id, title, contexts: ['page', 'selection', 'link'] });
      chrome.contextMenus.create({ id: 'image-capture', title: '图片区域翻译（截图框选）', contexts: ['page', 'image', 'selection', 'link'], documentUrlPatterns: ['http://*/*', 'https://*/*'] });
      for (const [id, title] of [['subtitle-start', '开启字幕双语翻译'], ['subtitle-stop', '停止字幕翻译']]) chrome.contextMenus.create({ id, title, contexts: ['page', 'video'], documentUrlPatterns: ['http://*/*', 'https://*/*'] });
    });
  });
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (['subtitle-start', 'subtitle-stop'].includes(info.menuItemId)) return controlSubtitles(info.menuItemId.slice(9), tab?.id, info.srcUrl).catch(() => {});
    if (info.menuItemId === 'image-capture') return captureImage(tab).catch(error =>
      chrome.tabs.create({ url: chrome.runtime.getURL(`image.html?error=${encodeURIComponent(error.message)}`) }).catch(() => {}));
    if (['page-start', 'page-stop', 'page-restore'].includes(info.menuItemId)) controlPage(info.menuItemId.slice(5), tab?.id).catch(() => {});
  });
}
async function ensureEngine() {
  if (creating) return creating;
  creating = (async () => {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [chrome.runtime.getURL('offscreen.html')] });
    if (!contexts.length) await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['WORKERS'], justification: '在专用 Worker 内复用 WebGPU 翻译模型，避免阻塞网页。' });
  })();
  try { await creating; } finally { creating = null; }
}
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'translator' || port.sender?.id !== chrome.runtime.id) return;
  const privileged = port.sender?.url?.split(/[?#]/)[0] === chrome.runtime.getURL('options.html');
  const owner = crypto.randomUUID();
  clients.set(owner, port);
  const send = message => { try { port.postMessage(message); } catch {} };
  port.onMessage.addListener(async message => {
    const id = typeof message.id === 'string' ? message.id.slice(0, 100) : '';
    try {
      if (!id) throw new Error('缺少请求编号。');
      const command = message.command;
      if (command === 'settings') {
        const { settings } = await chrome.storage.local.get('settings');
        send({ id, result: privileged ? { ...DEFAULTS, ...settings } : { mode: settings?.mode || 'local', engine: settings?.engine || 'webllm', target: settings?.target || 'auto', glossaryRevision: settings?.glossaryRevision || '' } });
        return;
      }
      if (command === 'open-settings') { await chrome.runtime.openOptionsPage(); send({ id, result: true }); return; }
      if (command === 'open-history') { await chrome.tabs.create({ url: chrome.runtime.getURL('options.html#history') }); send({ id, result: true }); return; }
      if (command === 'image-capture') {
        if (!privileged) throw new Error('请使用扩展图标启动图片区域翻译。');
        send({ id, result: await captureImage() }); return;
      }
      if (['subtitle-start', 'subtitle-stop'].includes(command)) {
        if (!privileged) throw new Error('请使用扩展图标或网页右键菜单控制字幕翻译。');
        send({ id, result: await controlSubtitles(command.slice(9)) }); return;
      }
      if (['page-start', 'page-stop', 'page-restore'].includes(command)) {
        if (!privileged) throw new Error('请使用扩展图标或网页右键菜单控制整页翻译。');
        send({ id, result: await controlPage(command.slice(5)) }); return;
      }
      if (command.startsWith('history-')) {
        if (!privileged) throw new Error('请在扩展设置页管理翻译历史。');
        let result;
        if (command === 'history-list') result = await history.list(message.query);
        else if (command === 'history-toggle') result = await history.setEnabled(message.enabled);
        else if (command === 'history-delete') result = await history.remove(message.entryId);
        else if (command === 'history-clear') result = await history.clear();
        else throw new Error('未知历史记录操作。');
        send({ id, result }); return;
      }
      if (command === 'save') {
        if (!privileged) throw new Error('请在扩展设置页更改配置。');
        const settings = validateSettings(message.settings);
        if (settings.mode === 'api') {
          const origin = new URL(settings.endpoint).origin + '/*';
          if (!await chrome.permissions.contains({ origins: [origin] })) throw new Error('尚未授权 API 站点访问权限。');
        }
        const { settings: previous } = await chrome.storage.local.get('settings');
        settings.glossaryRevision = settings.glossary !== (previous?.glossary || '') || settings.glossaryTarget !== (previous?.glossaryTarget || DEFAULTS.glossaryTarget)
          ? crypto.randomUUID() : previous?.glossaryRevision || '';
        await chrome.storage.local.set({ settings });
        await ensureEngine();
        await chrome.runtime.sendMessage({ target: 'engine', command: 'reset', owner, id });
        send({ id, result: true });
        return;
      }
      if (!['status', 'translate', 'cancel', 'download', 'clear', 'release'].includes(command)) throw new Error('未知请求。');
      if (['download', 'clear', 'release'].includes(command) && !privileged) throw new Error('请在扩展设置页管理模型。');
      const { settings = DEFAULTS } = await chrome.storage.local.get('settings');
      const config = { ...DEFAULTS, ...settings };
      if (['download', 'clear', 'release'].includes(command) && message.engine !== config.engine) throw new Error('推理引擎设置已变化，请重新打开设置页并确认后操作。');
      if (command === 'translate') validateText(message.text);
      if (command === 'translate' && (message.pageTranslation || message.imageTranslation || message.subtitleTranslation) && (message.settingsSnapshot?.glossaryRevision || '') !== (config.glossaryRevision || '')) throw new Error('术语表已变更，请重新开始整页或字幕翻译；图片翻译请重新截图。');
      if (command === 'translate' && (message.pageTranslation || message.imageTranslation || message.subtitleTranslation) && ['mode', 'engine', 'target'].some(key => message.settingsSnapshot?.[key] !== config[key])) throw new Error(message.subtitleTranslation ? '翻译设置已变更，请停止并重新开始字幕翻译，确认当前模式。' : message.imageTranslation ? '翻译设置已变更，请重新截图以确认当前模式。' : '翻译设置已变更，请停止后重新启动整页翻译，确认当前模式。');
      if (command === 'translate' && message.translationTarget !== undefined) {
        if (!isTargetLanguage(message.translationTarget)) throw new Error('无效的目标语言。');
        config.target = message.translationTarget;
      }
      await ensureEngine();
      await chrome.runtime.sendMessage({ target: 'engine', command, owner, id, text: message.text, settings: config, recordHistory: !message.pageTranslation && !message.imageTranslation && !message.subtitleTranslation,
        ...(command === 'cancel' ? { force: message.force === true, requestId: typeof message.requestId === 'string' ? message.requestId : undefined } : {}) });
    } catch (error) { send({ id, error: error.message }); }
  });
  port.onDisconnect.addListener(() => {
    clients.delete(owner);
    chrome.runtime.sendMessage({ target: 'engine', command: 'cancel', owner }).catch(() => {});
  });
});
chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('offscreen.html') || message.target !== 'clients') return;
  if (message.owner) {
    const deliver = historyError => {
      const { translationRecord, ...visible } = message;
      try { clients.get(message.owner)?.postMessage({ ...visible, ...(historyError ? { historyError } : {}) }); } catch {}
    };
    if (message.translationRecord && typeof message.result === 'string' && !message.error) {
      history.add({ ...message.translationRecord, translation: message.result })
        .then(() => deliver()).catch(() => deliver('译文已生成，但本地历史保存失败。'));
    } else deliver();
  } else {
    for (const [owner, port] of clients) { try { port.postMessage({ ...message, ownJob: message.jobOwner === owner }); } catch {} }
  }
});
// API credentials stay in extension storage and are never exposed to content scripts.
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});
