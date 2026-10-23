'use strict';

const DEFAULT_SETTINGS = {
  rootFolder: 'Instagram',
  groupByPost: false,
  includeDate: true,
  showInlineButtons: true
};

const ui = {
  card: document.querySelector('#contextCard'),
  eyebrow: document.querySelector('#contextEyebrow'),
  title: document.querySelector('#contextTitle'),
  detail: document.querySelector('#contextDetail'),
  download: document.querySelector('#downloadButton'),
  label: document.querySelector('#downloadLabel'),
  folder: document.querySelector('#folderPath'),
  toggle: document.querySelector('#inlineToggle'),
  settings: document.querySelector('#settingsButton')
};

let activeTab = null;
let context = null;
let settings = { ...DEFAULT_SETTINGS };
let isInstagram = false;

init();

async function init() {
  settings = { ...DEFAULT_SETTINGS, ...(await chrome.storage.local.get(DEFAULT_SETTINGS)) };
  ui.toggle.checked = settings.showInlineButtons !== false;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab || null;
  isInstagram = isInstagramUrl(tab?.url);

  if (!isInstagram) {
    renderUnavailable('Откройте Instagram', 'Затем выберите публикацию или Reel');
    ui.download.disabled = false;
    ui.label.textContent = 'Открыть Instagram';
    updateFolderPath();
    return;
  }

  try {
    context = await sendToContent({ type: 'IGD_GET_CONTEXT' });
    if (context?.ok) renderReady(context);
    else renderUnavailable('Публикация не выбрана', 'Откройте пост или прокрутите ленту до него');
  } catch {
    renderUnavailable('Обновите страницу', 'Это нужно один раз после установки');
  }

  updateFolderPath();
}

ui.download.addEventListener('click', async () => {
  if (!isInstagram) {
    await chrome.tabs.create({ url: 'https://www.instagram.com/' });
    window.close();
    return;
  }

  setLoading(true);
  try {
    const result = await sendToContent({ type: 'IGD_DOWNLOAD_CURRENT' });
    if (!result?.ok) throw new Error(result?.message || 'Не удалось начать загрузку');

    ui.card.className = 'context-card ready';
    ui.eyebrow.textContent = 'ДОБАВЛЕНО В ЗАГРУЗКИ';
    ui.title.textContent = result.count > 1 ? `Файлов: ${result.count}` : 'Файл загружается';
    ui.detail.textContent = `Загрузки/${result.folder || settings.rootFolder}`;
    ui.label.textContent = 'Готово';
    setTimeout(() => window.close(), 900);
  } catch (error) {
    ui.card.className = 'context-card error';
    ui.eyebrow.textContent = 'НЕ УДАЛОСЬ СКАЧАТЬ';
    ui.title.textContent = 'Попробуйте ещё раз';
    ui.detail.textContent = friendlyError(error);
    setLoading(false);
  }
});

ui.toggle.addEventListener('change', async () => {
  settings.showInlineButtons = ui.toggle.checked;
  await chrome.storage.local.set({ showInlineButtons: ui.toggle.checked });
});

ui.settings.addEventListener('click', () => chrome.runtime.openOptionsPage());

function renderReady(data) {
  ui.card.className = 'context-card ready';
  ui.eyebrow.textContent = 'ПУБЛИКАЦИЯ НАЙДЕНА';
  ui.title.textContent = data.username && data.username !== 'instagram' ? `@${data.username}` : 'Готово к скачиванию';

  const type = data.kind === 'video' ? 'Видео' : 'Фото';
  const count = data.mediaCount > 1 ? ` · элементов: ${data.mediaCount}` : '';
  ui.detail.textContent = `${type}${count}`;
  ui.download.disabled = false;
  ui.label.textContent = 'Скачать публикацию';
}

function renderUnavailable(title, detail) {
  ui.card.className = 'context-card error';
  ui.eyebrow.textContent = 'НУЖНА ПУБЛИКАЦИЯ';
  ui.title.textContent = title;
  ui.detail.textContent = detail;
  ui.download.disabled = true;
}

function updateFolderPath() {
  const root = String(settings.rootFolder || '').replace(/[\\/]+/g, '/').replace(/^\/+|\/+$/g, '') || 'Instagram';
  const username = context?.username && context.username !== 'instagram' ? context.username : 'имя_аккаунта';
  ui.folder.textContent = `Загрузки/${root}/${username}`;
}

function setLoading(value) {
  ui.download.classList.toggle('loading', value);
  ui.download.disabled = value;
  ui.label.textContent = value ? 'Собираю медиа…' : 'Скачать публикацию';
}

async function sendToContent(message) {
  if (!activeTab?.id) throw new Error('Активная вкладка не найдена');

  try {
    return await sendTabMessage(activeTab.id, message);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: ['content.js'] });
    return sendTabMessage(activeTab.id, message);
  }
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(response);
    });
  });
}

function isInstagramUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'instagram.com' || url.hostname.endsWith('.instagram.com'));
  } catch {
    return false;
  }
}

function friendlyError(error) {
  const message = error?.message || String(error || '');
  if (/Receiving end does not exist|message port closed/i.test(message)) return 'Обновите вкладку Instagram';
  return message || 'Обновите страницу и повторите';
}
