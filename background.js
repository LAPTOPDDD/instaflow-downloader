'use strict';

const API_APP_ID = '936619743392459';
const MENU_ID = 'instaflow-download-post';
const MAX_MEDIA_PER_POST = 20;

const DEFAULT_SETTINGS = Object.freeze({
  rootFolder: 'Instagram',
  groupByPost: false,
  includeDate: true,
  showInlineButtons: true
});

const jobs = new Map();
const downloadItems = new Map();
const activeKeys = new Map();

chrome.runtime.onInstalled.addListener(() => {
  ensureDefaultSettings();
  rebuildContextMenu();
});

chrome.runtime.onStartup.addListener(rebuildContextMenu);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) return;
  triggerDownloadInTab(tab.id, info.linkUrl || info.pageUrl || '').catch(() => {});
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'download-current-post') return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) triggerDownloadInTab(tab.id, tab.url || '').catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;

  if (message.type === 'IGD_DOWNLOAD_BY_SHORTCODE') {
    downloadByShortcode(message, sender.tab?.id)
      .then(sendResponse)
      .catch((error) => sendResponse(toErrorResponse(error)));
    return true;
  }

  if (message.type === 'IGD_DOWNLOAD_MEDIA') {
    downloadProvidedMedia(message, sender.tab?.id)
      .then(sendResponse)
      .catch((error) => sendResponse(toErrorResponse(error)));
    return true;
  }

  if (message.type === 'IGD_GET_SETTINGS') {
    getSettings()
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch((error) => sendResponse(toErrorResponse(error)));
    return true;
  }

  return false;
});

chrome.downloads.onChanged.addListener((delta) => {
  if (!delta?.id || !delta.state?.current) return;

  const tracked = downloadItems.get(delta.id);
  if (!tracked) return;

  if (delta.state.current === 'complete') {
    downloadItems.delete(delta.id);
    updateJob(tracked.jobId, true);
  } else if (delta.state.current === 'interrupted') {
    downloadItems.delete(delta.id);
    updateJob(tracked.jobId, false, delta.error?.current || 'Прерывание загрузки');
  }
});

async function ensureDefaultSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  const missing = {};

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (stored[key] === undefined) missing[key] = value;
  }

  if (Object.keys(missing).length) await chrome.storage.local.set(missing);
}

function rebuildContextMenu() {
  chrome.contextMenus.removeAll(() => {
    void chrome.runtime.lastError;
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Скачать фото / видео публикации',
      contexts: ['page', 'link'],
      documentUrlPatterns: ['https://www.instagram.com/*', 'https://instagram.com/*']
    }, () => void chrome.runtime.lastError);
  });
}

async function triggerDownloadInTab(tabId, preferredUrl) {
  const message = { type: 'IGD_DOWNLOAD_CURRENT', preferredUrl };

  try {
    return await sendTabMessage(tabId, message);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    return sendTabMessage(tabId, message);
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

async function downloadByShortcode(message, tabId) {
  const shortcode = normalizeShortcode(message.shortcode);
  if (!shortcode) throw new AppError('INVALID_POST', 'Не удалось определить публикацию');

  const activeKey = makeActiveKey(tabId, shortcode);
  const duplicate = activeKeys.get(activeKey);
  if (duplicate) {
    return { ok: true, duplicate: true, jobId: duplicate, message: 'Публикация уже загружается' };
  }

  activeKeys.set(activeKey, 'resolving');

  try {
    const post = await resolveInstagramPost(shortcode);
    return await queuePostDownloads(post, tabId, activeKey);
  } catch (error) {
    activeKeys.delete(activeKey);
    throw error;
  }
}

async function downloadProvidedMedia(message, tabId) {
  const shortcode = normalizeShortcode(message.shortcode) || `post_${Date.now()}`;
  const activeKey = makeActiveKey(tabId, shortcode);
  const duplicate = activeKeys.get(activeKey);

  if (duplicate) {
    return { ok: true, duplicate: true, jobId: duplicate, message: 'Публикация уже загружается' };
  }

  const media = normalizeProvidedMedia(message.media);
  if (!media.length) throw new AppError('NO_MEDIA', 'Медиафайлы в публикации не найдены');

  const post = {
    shortcode,
    username: sanitizeUsername(message.username),
    timestamp: normalizeTimestamp(message.timestamp),
    media
  };

  activeKeys.set(activeKey, 'resolving');

  try {
    return await queuePostDownloads(post, tabId, activeKey);
  } catch (error) {
    activeKeys.delete(activeKey);
    throw error;
  }
}

async function resolveInstagramPost(shortcode) {
  const endpoint = `https://www.instagram.com/api/v1/media/shortcode/${encodeURIComponent(shortcode)}/info/`;
  let firstError;

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: {
        Accept: '*/*',
        'X-IG-App-ID': API_APP_ID,
        'X-Requested-With': 'XMLHttpRequest'
      }
    });

    if (!response.ok) {
      throw new AppError('API_UNAVAILABLE', `Instagram вернул код ${response.status}`);
    }

    return normalizeApiPayload(await response.json(), shortcode);
  } catch (error) {
    firstError = error;
  }

  try {
    const fallback = await fetch(`https://www.instagram.com/p/${encodeURIComponent(shortcode)}/?__a=1&__d=dis`, {
      credentials: 'include',
      cache: 'no-store',
      headers: { 'X-IG-App-ID': API_APP_ID }
    });

    if (!fallback.ok) throw new Error(`HTTP ${fallback.status}`);

    const contentType = fallback.headers.get('content-type') || '';
    if (!contentType.includes('json')) throw new Error('Ответ не является JSON');
    return normalizeApiPayload(await fallback.json(), shortcode);
  } catch {
    throw new AppError(
      'API_UNAVAILABLE',
      firstError?.message || 'Instagram не отдал данные публикации'
    );
  }
}

function normalizeApiPayload(payload, shortcode) {
  const v1Item = payload?.items?.[0] || payload?.item;
  if (v1Item) return normalizeV1Item(v1Item, shortcode);

  const graphItem =
    payload?.graphql?.shortcode_media ||
    payload?.data?.shortcode_media ||
    payload?.data?.xdt_shortcode_media;

  if (graphItem) return normalizeGraphItem(graphItem, shortcode);
  throw new AppError('NO_MEDIA', 'Instagram вернул публикацию без медиа');
}

function normalizeV1Item(item, shortcode) {
  const children = Array.isArray(item.carousel_media) && item.carousel_media.length
    ? item.carousel_media
    : [item];

  const media = children
    .slice(0, MAX_MEDIA_PER_POST)
    .map((child, index) => {
      const videoCandidates = Array.isArray(child.video_versions) ? child.video_versions : [];
      const isVideo = child.media_type === 2 || videoCandidates.length > 0;

      if (isVideo) {
        const best = pickLargest(videoCandidates);
        return best?.url ? {
          url: best.url,
          kind: 'video',
          width: numberOrZero(best.width),
          height: numberOrZero(best.height),
          index: index + 1
        } : null;
      }

      const imageCandidates = child.image_versions2?.candidates || child.image_versions?.candidates || [];
      const best = pickLargest(imageCandidates);
      return best?.url ? {
        url: best.url,
        kind: 'image',
        width: numberOrZero(best.width),
        height: numberOrZero(best.height),
        index: index + 1
      } : null;
    })
    .filter(Boolean);

  if (!media.length) throw new AppError('NO_MEDIA', 'Ссылки на медиа не найдены');

  return {
    shortcode: normalizeShortcode(item.code) || shortcode,
    username: sanitizeUsername(item.user?.username || item.owner?.username),
    timestamp: normalizeTimestamp(item.taken_at || item.taken_at_timestamp),
    media
  };
}

function normalizeGraphItem(item, shortcode) {
  const edges = item.edge_sidecar_to_children?.edges;
  const children = Array.isArray(edges) && edges.length ? edges.map((edge) => edge.node) : [item];

  const media = children
    .slice(0, MAX_MEDIA_PER_POST)
    .map((child, index) => {
      const isVideo = Boolean(child.is_video || child.video_url);
      const url = isVideo ? child.video_url : (child.display_url || child.display_src);
      if (!url) return null;

      return {
        url,
        kind: isVideo ? 'video' : 'image',
        width: numberOrZero(child.dimensions?.width),
        height: numberOrZero(child.dimensions?.height),
        index: index + 1
      };
    })
    .filter(Boolean);

  if (!media.length) throw new AppError('NO_MEDIA', 'Ссылки на медиа не найдены');

  return {
    shortcode: normalizeShortcode(item.shortcode) || shortcode,
    username: sanitizeUsername(item.owner?.username),
    timestamp: normalizeTimestamp(item.taken_at_timestamp),
    media
  };
}

function pickLargest(candidates) {
  return candidates
    .filter((item) => item && typeof item.url === 'string' && item.url.startsWith('http'))
    .sort((a, b) => mediaScore(b) - mediaScore(a))[0];
}

function mediaScore(candidate) {
  return numberOrZero(candidate.width) * numberOrZero(candidate.height) + numberOrZero(candidate.bitrate);
}

function normalizeProvidedMedia(input) {
  if (!Array.isArray(input)) return [];

  const seen = new Set();
  const result = [];

  for (const item of input.slice(0, MAX_MEDIA_PER_POST)) {
    if (!item || !isAllowedMediaUrl(item.url)) continue;

    const kind = item.kind === 'video' ? 'video' : 'image';
    const key = canonicalMediaKey(item.url, kind);
    if (seen.has(key)) continue;
    seen.add(key);

    result.push({
      url: item.url,
      kind,
      width: numberOrZero(item.width),
      height: numberOrZero(item.height),
      index: result.length + 1
    });
  }

  return result;
}

async function queuePostDownloads(post, tabId, activeKey) {
  const settings = await getSettings();
  const media = post.media.filter((item) => isAllowedMediaUrl(item.url)).slice(0, MAX_MEDIA_PER_POST);

  if (!media.length) throw new AppError('NO_MEDIA', 'Нет доступных ссылок для скачивания');

  const jobId = createJobId();
  const job = {
    id: jobId,
    tabId,
    activeKey,
    total: media.length,
    queued: 0,
    completed: 0,
    failed: 0,
    errors: []
  };

  jobs.set(jobId, job);
  activeKeys.set(activeKey, jobId);
  setBadge(tabId, '…');
  notifyTab(tabId, {
    type: 'IGD_DOWNLOAD_PROGRESS',
    phase: 'starting',
    jobId,
    total: job.total,
    shortcode: post.shortcode
  });

  for (let offset = 0; offset < media.length; offset += 1) {
    const item = media[offset];
    const filename = buildDownloadPath(post, item, offset, media.length, settings);

    try {
      const downloadId = await startDownload({
        url: item.url,
        filename,
        conflictAction: 'uniquify',
        saveAs: false
      });

      job.queued += 1;
      downloadItems.set(downloadId, { jobId });
    } catch (error) {
      job.failed += 1;
      job.errors.push(error.message || 'Ошибка очереди загрузки');
    }
  }

  if (!job.queued) {
    finishJob(job);
    throw new AppError('DOWNLOAD_FAILED', job.errors[0] || 'Chrome не смог начать загрузку');
  }

  setBadge(tabId, String(job.queued));
  notifyTab(tabId, {
    type: 'IGD_DOWNLOAD_PROGRESS',
    phase: 'queued',
    jobId,
    total: job.total,
    queued: job.queued,
    failed: job.failed
  });

  return {
    ok: true,
    jobId,
    count: job.queued,
    failed: job.failed,
    username: post.username,
    folder: buildFolder(post, settings),
    message: job.queued === 1 ? 'Файл добавлен в загрузки' : `Файлов добавлено: ${job.queued}`
  };
}

function startDownload(options) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(options, (downloadId) => {
      const error = chrome.runtime.lastError;
      if (error || !Number.isInteger(downloadId)) {
        reject(new Error(error?.message || 'Не удалось начать загрузку'));
      } else {
        resolve(downloadId);
      }
    });
  });
}

function updateJob(jobId, succeeded, errorMessage = '') {
  const job = jobs.get(jobId);
  if (!job) return;

  if (succeeded) job.completed += 1;
  else {
    job.failed += 1;
    if (errorMessage) job.errors.push(errorMessage);
  }

  const done = job.completed + job.failed;
  notifyTab(job.tabId, {
    type: 'IGD_DOWNLOAD_PROGRESS',
    phase: 'downloading',
    jobId,
    total: job.total,
    completed: job.completed,
    failed: job.failed,
    done
  });

  if (done >= job.total) finishJob(job);
}

function finishJob(job) {
  jobs.delete(job.id);
  if (activeKeys.get(job.activeKey) === job.id) activeKeys.delete(job.activeKey);

  notifyTab(job.tabId, {
    type: 'IGD_DOWNLOAD_PROGRESS',
    phase: 'finished',
    jobId: job.id,
    total: job.total,
    completed: job.completed,
    failed: job.failed,
    error: job.errors[0] || ''
  });

  setTimeout(() => setBadge(job.tabId, ''), 1800);
}

function notifyTab(tabId, message) {
  if (!Number.isInteger(tabId)) return;
  chrome.tabs.sendMessage(tabId, message, () => void chrome.runtime.lastError);
}

function setBadge(tabId, text) {
  if (!Number.isInteger(tabId)) return;
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#7C3AED' }).catch(() => {});
  chrome.action.setBadgeText({ tabId, text: String(text).slice(0, 4) }).catch(() => {});
}

async function getSettings() {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return {
    rootFolder: typeof stored.rootFolder === 'string' ? stored.rootFolder : DEFAULT_SETTINGS.rootFolder,
    groupByPost: Boolean(stored.groupByPost),
    includeDate: stored.includeDate !== false,
    showInlineButtons: stored.showInlineButtons !== false
  };
}

function buildFolder(post, settings) {
  const rootSegments = String(settings.rootFolder || '')
    .split(/[\\/]+/)
    .map(sanitizePathSegment)
    .filter(Boolean);

  const username = sanitizePathSegment(post.username || 'instagram');
  const segments = [...rootSegments, username];
  if (settings.groupByPost) segments.push(sanitizePathSegment(post.shortcode));
  return segments.join('/');
}

function buildDownloadPath(post, item, offset, total, settings) {
  const folder = buildFolder(post, settings);
  const date = settings.includeDate ? `${formatDate(post.timestamp)}_` : '';
  const index = total > 1 ? `_${String(offset + 1).padStart(2, '0')}` : '';
  const kind = item.kind === 'video' ? 'video' : 'photo';
  const extension = item.kind === 'video' ? 'mp4' : 'jpg';
  const base = sanitizePathSegment(`${date}${post.shortcode}${index}_${kind}`);
  return `${folder}/${base}.${extension}`;
}

function formatDate(timestamp) {
  const date = timestamp ? new Date(timestamp * 1000) : new Date();
  const valid = Number.isNaN(date.getTime()) ? new Date() : date;
  const year = valid.getFullYear();
  const month = String(valid.getMonth() + 1).padStart(2, '0');
  const day = String(valid.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function sanitizePathSegment(value) {
  return String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/^\.+|\.+$/g, '')
    .replace(/[ .]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function sanitizeUsername(value) {
  const username = String(value || '')
    .replace(/^@/, '')
    .replace(/[^A-Za-z0-9._]/g, '')
    .slice(0, 40);
  return username || 'instagram';
}

function normalizeShortcode(value) {
  const shortcode = String(value || '').trim();
  return /^[A-Za-z0-9_-]{5,30}$/.test(shortcode) ? shortcode : '';
}

function normalizeTimestamp(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return Math.floor(Date.now() / 1000);
  return timestamp > 1e12 ? Math.floor(timestamp / 1000) : Math.floor(timestamp);
}

function isAllowedMediaUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return host === 'instagram.com' ||
      host.endsWith('.instagram.com') ||
      host.endsWith('.cdninstagram.com') ||
      host.endsWith('.fbcdn.net');
  } catch {
    return false;
  }
}

function canonicalMediaKey(rawUrl, kind) {
  try {
    const url = new URL(rawUrl);
    return `${kind}:${url.hostname}${url.pathname}`;
  } catch {
    return `${kind}:${rawUrl}`;
  }
}

function makeActiveKey(tabId, shortcode) {
  return `${Number.isInteger(tabId) ? tabId : 'extension'}:${shortcode}`;
}

function createJobId() {
  return globalThis.crypto?.randomUUID?.() || `job_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function toErrorResponse(error) {
  return {
    ok: false,
    code: error?.code || 'UNKNOWN',
    message: error?.message || 'Неизвестная ошибка'
  };
}

class AppError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}
