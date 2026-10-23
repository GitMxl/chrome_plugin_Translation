import { populateTargets } from './shared.js';

// Load before options.js so the same translation/history UI can serve both surfaces.
const $ = id => document.getElementById(id);
const isPanel = new URL(location.href).searchParams.get('view') === 'sidepanel';
document.body.classList.toggle('sidepanel', isPanel);
document.body.dataset.view = isPanel ? 'sidepanel' : 'settings';
populateTargets($('sidepanel-target'), true);
if (isPanel) {
  document.title = '侧边栏翻译';
  $('sidepanel-controls').hidden = false;
  if (new URL(location.href).searchParams.get('fallback') === '1') $('input-status').textContent = '侧边栏未能打开，已在独立标签页提供翻译。';
  $('sidepanel-settings').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html#preferences') }).catch(error => {
      $('input-status').textContent = `打开设置失败：${error.message}`;
    });
  });
} else {
  let windowId;
  const button = $('input-sidepanel');
  if (!chrome.sidePanel?.open) {
    button.disabled = false;
    button.addEventListener('click', () => { $('input-status').textContent = '当前浏览器不支持侧边栏，请使用独立标签页翻译。'; });
  } else {
    // Resolve the window ahead of the click so open() retains the user gesture.
    chrome.windows.getCurrent().then(window => { windowId = window.id; button.disabled = false; }).catch(() => {
      button.disabled = false;
    });
    button.addEventListener('click', () => {
      if (!Number.isInteger(windowId)) { $('input-status').textContent = '无法确定当前浏览器窗口，请重新打开扩展后重试。'; return; }
      chrome.sidePanel.open({ windowId }).catch(error => {
        $('input-status').textContent = `打开侧边栏失败：${error.message}。可使用「在标签页中打开」。`;
      });
    });
  }
}
