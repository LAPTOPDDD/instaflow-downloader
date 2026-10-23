'use strict';

const DEFAULT_SETTINGS = {
  rootFolder: 'Instagram',
  groupByPost: false,
  includeDate: true,
  showInlineButtons: true
};

const controls = {
  rootFolder: document.querySelector('#rootFolder'),
  groupByPost: document.querySelector('#groupByPost'),
  includeDate: document.querySelector('#includeDate'),
  showInlineButtons: document.querySelector('#showInlineButtons'),
  preview: document.querySelector('#pathPreview'),
  saveState: document.querySelector('#saveState'),
  reset: document.querySelector('#resetButton')
};

let saveTimer = 0;

restore();

async function restore() {
  const values = { ...DEFAULT_SETTINGS, ...(await chrome.storage.local.get(DEFAULT_SETTINGS)) };
  controls.rootFolder.value = values.rootFolder;
  controls.groupByPost.checked = values.groupByPost;
  controls.includeDate.checked = values.includeDate;
  controls.showInlineButtons.checked = values.showInlineButtons;
  updatePreview();
}

for (const control of [controls.rootFolder, controls.groupByPost, controls.includeDate, controls.showInlineButtons]) {
  control.addEventListener('input', () => {
    updatePreview();
    scheduleSave();
  });
  control.addEventListener('change', () => {
    updatePreview();
    scheduleSave(80);
  });
}

controls.rootFolder.addEventListener('blur', () => {
  controls.rootFolder.value = normalizeFolder(controls.rootFolder.value) || DEFAULT_SETTINGS.rootFolder;
  updatePreview();
  scheduleSave(0);
});

controls.reset.addEventListener('click', async () => {
  await chrome.storage.local.set(DEFAULT_SETTINGS);
  await restore();
  showSaved('Настройки восстановлены');
});

function scheduleSave(delay = 350) {
  clearTimeout(saveTimer);
  controls.saveState.classList.add('saving');
  controls.saveState.lastChild.textContent = 'Сохраняю изменения…';
  saveTimer = setTimeout(save, delay);
}

async function save() {
  const values = {
    rootFolder: normalizeFolder(controls.rootFolder.value) || DEFAULT_SETTINGS.rootFolder,
    groupByPost: controls.groupByPost.checked,
    includeDate: controls.includeDate.checked,
    showInlineButtons: controls.showInlineButtons.checked
  };

  await chrome.storage.local.set(values);
  showSaved('Все изменения сохранены');
}

function showSaved(text) {
  controls.saveState.classList.remove('saving');
  controls.saveState.lastChild.textContent = text;
}

function updatePreview() {
  const folder = normalizeFolder(controls.rootFolder.value) || DEFAULT_SETTINGS.rootFolder;
  const postFolder = controls.groupByPost.checked ? '/ABC123' : '';
  const date = controls.includeDate.checked ? '2026-10-23_' : '';
  controls.preview.textContent = `Загрузки/${folder}/nasa${postFolder}/${date}ABC123_video.mp4`;
}

function normalizeFolder(value) {
  return String(value || '')
    .split(/[\\/]+/)
    .map((part) => part
      .replace(/[<>:"|?*\x00-\x1F]/g, '_')
      .replace(/^\.+|\.+$/g, '')
      .replace(/[ .]+$/g, '')
      .trim()
      .slice(0, 80))
    .filter(Boolean)
    .join('/')
    .slice(0, 120);
}
