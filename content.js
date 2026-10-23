(() => {
  'use strict';

  if (globalThis.__INSTAFLOW_CONTENT_LOADED__) return;
  globalThis.__INSTAFLOW_CONTENT_LOADED__ = true;

  const API_APP_ID = '936619743392459';
  const MAX_MEDIA_PER_POST = 20;
  const DEFAULT_SETTINGS = {
    rootFolder: 'Instagram',
    groupByPost: false,
    includeDate: true,
    showInlineButtons: true
  };

  const buttonEntries = new WeakMap();
  const mountedEntries = new Set();
  const jobRoots = new Map();
  let settings = { ...DEFAULT_SETTINGS };
  let scanTimer = 0;
  let lastUrl = location.href;
  let toastUi = null;
  let floatingEntry = null;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false;

    if (message.type === 'IGD_PING') {
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === 'IGD_GET_CONTEXT') {
      sendResponse(publicContext(getCurrentContext()));
      return false;
    }

    if (message.type === 'IGD_DOWNLOAD_CURRENT') {
      startDownload(message.preferredUrl || '')
        .then(sendResponse)
        .catch((error) => sendResponse(errorResponse(error)));
      return true;
    }

    if (message.type === 'IGD_DOWNLOAD_PROGRESS') {
      handleDownloadProgress(message);
      return false;
    }

    return false;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (changes[key]) settings[key] = changes[key].newValue;
    }

    if (settings.showInlineButtons === false) removeAllButtons();
    else scheduleScan(50);
  });

  loadSettings().then(() => {
    scheduleScan(0);
    observePage();
  });

  async function loadSettings() {
    try {
      settings = { ...DEFAULT_SETTINGS, ...(await chrome.storage.local.get(DEFAULT_SETTINGS)) };
    } catch {
      settings = { ...DEFAULT_SETTINGS };
    }
  }

  function observePage() {
    const observer = new MutationObserver(() => scheduleScan(350));
    observer.observe(document.documentElement, { childList: true, subtree: true });

    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        scheduleScan(100);
      }
      cleanupDetachedButtons();
    }, 1200);

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) scheduleScan(100);
    });
  }

  function scheduleScan(delay = 250) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanForPosts, delay);
  }

  function scanForPosts() {
    cleanupDetachedButtons();
    if (settings.showInlineButtons === false) return;

    const articles = [...document.querySelectorAll('article')];
    const directShortcode = extractShortcode(location.href);
    let hasDirectArticle = false;

    for (const article of articles) {
      let shortcode = extractShortcodeFromRoot(article);
      if (!shortcode && directShortcode && articles.length === 1) shortcode = directShortcode;
      if (shortcode) {
        ensureInlineButton(article, shortcode);
        if (shortcode === directShortcode) hasDirectArticle = true;
      }
    }

    if (directShortcode && !hasDirectArticle) ensureFloatingButton(directShortcode);
    else removeFloatingButton();
  }

  function ensureInlineButton(root, shortcode, floating = false) {
    const existing = buttonEntries.get(root);
    if (existing?.host?.isConnected) {
      existing.shortcode = shortcode;
      if (floating) floatingEntry = existing;
      return;
    }

    const host = document.createElement('div');
    host.dataset.instaflow = 'download-button';
    host.style.cssText = [
      floating ? 'position:fixed' : 'position:absolute',
      floating ? 'bottom:24px' : 'top:62px',
      floating ? 'right:22px' : 'right:10px',
      'width:142px',
      'height:46px',
      'display:flex',
      'justify-content:flex-end',
      'align-items:flex-start',
      'z-index:2147483000',
      'pointer-events:none'
    ].join(';');

    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        button {
          all: unset;
          box-sizing: border-box;
          height: 42px;
          min-width: 42px;
          max-width: 132px;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 0;
          padding: 0 11px;
          color: #fff;
          background: linear-gradient(135deg, rgba(17,24,39,.90), rgba(49,46,129,.90));
          border: 1px solid rgba(255,255,255,.28);
          border-radius: 14px;
          box-shadow: 0 10px 30px rgba(2,6,23,.30), inset 0 1px 0 rgba(255,255,255,.14);
          backdrop-filter: blur(14px) saturate(1.3);
          -webkit-backdrop-filter: blur(14px) saturate(1.3);
          cursor: pointer;
          pointer-events: auto;
          font: 600 13px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          transition: transform .18s ease, background .18s ease, box-shadow .18s ease;
        }
        button:hover {
          transform: translateY(-2px);
          background: linear-gradient(135deg, rgba(124,58,237,.96), rgba(219,39,119,.94));
          box-shadow: 0 14px 34px rgba(91,33,182,.36), inset 0 1px 0 rgba(255,255,255,.20);
        }
        button:active { transform: translateY(0) scale(.97); }
        button:focus-visible { outline: 3px solid rgba(167,139,250,.55); outline-offset: 2px; }
        svg { width: 20px; height: 20px; flex: 0 0 auto; }
        .label {
          display: block;
          width: 0;
          opacity: 0;
          overflow: hidden;
          white-space: nowrap;
          transform: translateX(5px);
          transition: width .2s ease, opacity .16s ease, transform .2s ease, margin .2s ease;
        }
        button:hover .label, button:focus-visible .label, button[data-state="loading"] .label,
        button[data-state="queued"] .label, button[data-state="success"] .label {
          width: 78px;
          opacity: 1;
          margin-right: 8px;
          transform: translateX(0);
        }
        button[data-state="loading"] svg { animation: pulse 1s ease-in-out infinite; }
        button[data-state="success"] { background: linear-gradient(135deg, #059669, #0d9488); }
        button[data-state="error"] { background: linear-gradient(135deg, #dc2626, #e11d48); }
        @keyframes pulse { 50% { opacity: .45; transform: translateY(2px); } }
        @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
      </style>
      <button type="button" aria-label="Скачать публикацию" title="Скачать фото / видео">
        <span class="label">Скачать</span>
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 15v3.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>`;

    const button = shadow.querySelector('button');
    const label = shadow.querySelector('.label');
    const computedPosition = getComputedStyle(root).position;
    const changedPosition = !floating && computedPosition === 'static';
    if (changedPosition) root.style.position = 'relative';

    const entry = { root, host, button, label, shortcode, changedPosition, floating, state: 'idle' };
    buttonEntries.set(root, entry);
    mountedEntries.add(entry);
    root.append(host);
    if (floating) floatingEntry = entry;

    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      startDownload(entry.shortcode).catch(() => {});
    });
  }

  function ensureFloatingButton(shortcode) {
    ensureInlineButton(document.documentElement, shortcode, true);
  }

  function removeFloatingButton() {
    if (!floatingEntry) return;
    removeButtonEntry(floatingEntry);
    mountedEntries.delete(floatingEntry);
    floatingEntry = null;
  }

  function setButtonState(root, state) {
    if (!root) return;
    const entry = buttonEntries.get(root);
    if (!entry) return;

    const labels = {
      idle: 'Скачать',
      loading: 'Собираю…',
      queued: 'Загрузка…',
      success: 'Готово',
      error: 'Ошибка'
    };

    entry.state = state;
    entry.button.dataset.state = state;
    entry.label.textContent = labels[state] || labels.idle;
    entry.button.disabled = state === 'loading' || state === 'queued';
  }

  function removeAllButtons() {
    for (const entry of mountedEntries) removeButtonEntry(entry);
    mountedEntries.clear();
    floatingEntry = null;
  }

  function cleanupDetachedButtons() {
    for (const entry of mountedEntries) {
      if (!entry.root.isConnected || !entry.host.isConnected) {
        removeButtonEntry(entry);
        mountedEntries.delete(entry);
      }
    }
  }

  function removeButtonEntry(entry) {
    entry.host.remove();
    if (floatingEntry === entry) floatingEntry = null;
    if (entry.changedPosition && entry.root.style.position === 'relative') {
      entry.root.style.removeProperty('position');
    }
  }

  async function startDownload(preferredUrl = '') {
    const preferredShortcode = extractShortcode(preferredUrl) || normalizeShortcode(preferredUrl);
    const context = getCurrentContext(preferredShortcode);

    if (!context.shortcode) {
      const error = new Error('Откройте публикацию, Reel или выберите пост в ленте');
      showToast('error', 'Публикация не найдена', error.message);
      throw error;
    }

    if (context.buttonRoot) setButtonState(context.buttonRoot, 'loading');
    showToast('loading', 'Собираю медиа', 'Обычно это занимает пару секунд', true);

    let result;
    try {
      const pagePost = await resolvePostFromPage(context.shortcode);
      if (pagePost?.media?.length) {
        result = await sendRuntime({
          type: 'IGD_DOWNLOAD_MEDIA',
          shortcode: context.shortcode,
          username: pagePost.username || context.username,
          timestamp: pagePost.timestamp,
          media: pagePost.media
        });
      }

      if (!result?.ok) {
        result = await sendRuntime({
          type: 'IGD_DOWNLOAD_BY_SHORTCODE',
          shortcode: context.shortcode
        });
      }

      if (!result?.ok) {
        if (!context.root) throw new Error('Откройте публикацию полностью и повторите');

        const media = await collectCarouselFromDom(context.root);
        if (!media.length) {
          throw new Error('Не удалось найти доступные фото или видео');
        }

        result = await sendRuntime({
          type: 'IGD_DOWNLOAD_MEDIA',
          shortcode: context.shortcode,
          username: context.username,
          media
        });
      }

      if (!result?.ok) throw new Error(result?.message || 'Не удалось начать загрузку');

      if (result.jobId && context.buttonRoot) jobRoots.set(result.jobId, context.buttonRoot);
      if (context.buttonRoot) setButtonState(context.buttonRoot, 'queued');

      showToast(
        'success',
        result.count > 1 ? `Добавлено файлов: ${result.count}` : 'Файл добавлен',
        `Папка: Загрузки/${result.folder || context.username}`
      );

      return result;
    } catch (error) {
      if (context.buttonRoot) {
        setButtonState(context.buttonRoot, 'error');
        setTimeout(() => setButtonState(context.buttonRoot, 'idle'), 1800);
      }
      showToast('error', 'Не удалось скачать', friendlyError(error));
      throw error;
    }
  }

  async function resolvePostFromPage(shortcode) {
    const embedded = resolvePostFromEmbeddedData(shortcode);
    if (embedded?.media?.length) return embedded;

    try {
      const response = await fetch(`/api/v1/media/shortcode/${encodeURIComponent(shortcode)}/info/`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          Accept: '*/*',
          'X-IG-App-ID': API_APP_ID,
          'X-Requested-With': 'XMLHttpRequest'
        }
      });

      if (!response.ok) return null;
      const payload = await response.json();
      const item = payload?.items?.[0] || payload?.item;
      if (!item) return null;

      const children = Array.isArray(item.carousel_media) && item.carousel_media.length
        ? item.carousel_media
        : [item];

      const media = children.slice(0, MAX_MEDIA_PER_POST).map((child, index) => {
        const videos = Array.isArray(child.video_versions) ? child.video_versions : [];
        if (child.media_type === 2 || videos.length) {
          const best = pickLargest(videos);
          return best?.url ? {
            url: best.url,
            kind: 'video',
            width: numberOrZero(best.width),
            height: numberOrZero(best.height),
            index: index + 1
          } : null;
        }

        const images = child.image_versions2?.candidates || child.image_versions?.candidates || [];
        const best = pickLargest(images);
        return best?.url ? {
          url: best.url,
          kind: 'image',
          width: numberOrZero(best.width),
          height: numberOrZero(best.height),
          index: index + 1
        } : null;
      }).filter(Boolean);

      return {
        username: sanitizeUsername(item.user?.username || item.owner?.username),
        timestamp: normalizeTimestamp(item.taken_at || item.taken_at_timestamp),
        media
      };
    } catch {
      return null;
    }
  }

  function resolvePostFromEmbeddedData(shortcode) {
    const matches = [];
    const scripts = document.querySelectorAll('script[type="application/json"]');

    for (const script of scripts) {
      const text = script.textContent || '';
      if (!text.includes(shortcode) || text.length > 8_000_000) continue;

      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        continue;
      }

      const stack = [payload];
      const seen = new WeakSet();
      let visited = 0;

      while (stack.length && visited < 250_000) {
        const value = stack.pop();
        visited += 1;
        if (!value || typeof value !== 'object' || seen.has(value)) continue;
        seen.add(value);

        const code = value.code || value.shortcode;
        if (code === shortcode && looksLikeMediaObject(value)) {
          matches.push(value);
        }

        for (const child of Object.values(value)) {
          if (child && typeof child === 'object') stack.push(child);
        }
      }
    }

    const normalized = matches
      .map((item) => normalizeEmbeddedMedia(item, shortcode))
      .filter((item) => item?.media?.length)
      .sort((a, b) => b.media.length - a.media.length);

    return normalized[0] || null;
  }

  function looksLikeMediaObject(value) {
    return Boolean(
      value.carousel_media?.length ||
      value.video_versions?.length ||
      value.image_versions2?.candidates?.length ||
      value.edge_sidecar_to_children?.edges?.length ||
      value.video_url ||
      value.display_url
    );
  }

  function normalizeEmbeddedMedia(item, shortcode) {
    if (item.edge_sidecar_to_children?.edges?.length || item.video_url || item.display_url) {
      const nodes = item.edge_sidecar_to_children?.edges?.map((edge) => edge.node) || [item];
      const media = nodes.slice(0, MAX_MEDIA_PER_POST).map((node, index) => {
        const isVideo = Boolean(node.is_video || node.video_url);
        const url = isVideo ? node.video_url : (node.display_url || node.display_src);
        if (!url) return null;
        return {
          url,
          kind: isVideo ? 'video' : 'image',
          width: numberOrZero(node.dimensions?.width),
          height: numberOrZero(node.dimensions?.height),
          index: index + 1
        };
      }).filter(Boolean);

      return {
        username: sanitizeUsername(item.owner?.username || item.user?.username),
        timestamp: normalizeTimestamp(item.taken_at_timestamp || item.taken_at),
        media
      };
    }

    const children = Array.isArray(item.carousel_media) && item.carousel_media.length
      ? item.carousel_media
      : [item];

    const media = children.slice(0, MAX_MEDIA_PER_POST).map((child, index) => {
      const videos = Array.isArray(child.video_versions) ? child.video_versions : [];
      if (child.media_type === 2 || videos.length) {
        const best = pickLargest(videos);
        return best?.url ? {
          url: best.url,
          kind: 'video',
          width: numberOrZero(best.width || child.original_width),
          height: numberOrZero(best.height || child.original_height),
          index: index + 1
        } : null;
      }

      const images = child.image_versions2?.candidates || child.image_versions?.candidates || [];
      const best = pickLargest(images);
      return best?.url ? {
        url: best.url,
        kind: 'image',
        width: numberOrZero(best.width || child.original_width),
        height: numberOrZero(best.height || child.original_height),
        index: index + 1
      } : null;
    }).filter(Boolean);

    return {
      shortcode,
      username: sanitizeUsername(item.user?.username || item.owner?.username),
      timestamp: normalizeTimestamp(item.taken_at || item.taken_at_timestamp),
      media
    };
  }

  async function collectCarouselFromDom(root) {
    const collected = new Map();
    collectDomMedia(root, collected);

    let clickCount = 0;
    let staleRounds = 0;

    for (let round = 0; round < MAX_MEDIA_PER_POST - 1; round += 1) {
      const nextButton = findCarouselControl(root, 'next');
      if (!nextButton || isDisabled(nextButton)) break;

      const before = collected.size;
      nextButton.click();
      clickCount += 1;
      await waitForDomChange(root, 650);
      collectDomMedia(root, collected);

      staleRounds = collected.size === before ? staleRounds + 1 : 0;
      if (staleRounds >= 2) break;
    }

    for (let step = 0; step < clickCount; step += 1) {
      const previousButton = findCarouselControl(root, 'previous');
      if (!previousButton || isDisabled(previousButton)) break;
      previousButton.click();
      await delay(70);
    }

    return [...collected.values()].slice(0, MAX_MEDIA_PER_POST).map((item, index) => ({
      ...item,
      index: index + 1
    }));
  }

  function collectDomMedia(root, output) {
    for (const video of root.querySelectorAll('video')) {
      const candidates = [video.currentSrc, video.src, ...[...video.querySelectorAll('source')].map((source) => source.src)];
      const url = candidates.find((candidate) => isAllowedMediaUrl(candidate));
      if (!url) continue;

      const item = {
        url,
        kind: 'video',
        width: numberOrZero(video.videoWidth || video.getAttribute('width')),
        height: numberOrZero(video.videoHeight || video.getAttribute('height'))
      };
      output.set(canonicalMediaKey(url, 'video'), item);
    }

    for (const image of root.querySelectorAll('img')) {
      if (!isLikelyPostImage(image)) continue;
      const url = getBestImageUrl(image);
      if (!isAllowedMediaUrl(url)) continue;

      const slide = image.closest('li');
      if (slide?.querySelector('video')) continue;

      const item = {
        url,
        kind: 'image',
        width: numberOrZero(image.naturalWidth || image.getAttribute('width')),
        height: numberOrZero(image.naturalHeight || image.getAttribute('height'))
      };
      output.set(canonicalMediaKey(url, 'image'), item);
    }
  }

  function isLikelyPostImage(image) {
    if (image.closest('header')) return false;

    const alt = String(image.alt || '').toLowerCase();
    if (alt.includes('profile picture') || alt.includes('фото профиля') || alt.includes('avatar')) return false;

    const source = image.currentSrc || image.src || '';
    if (source.includes('t51.2885-19')) return false;

    const width = numberOrZero(image.naturalWidth || image.getAttribute('width') || image.getBoundingClientRect().width);
    const height = numberOrZero(image.naturalHeight || image.getAttribute('height') || image.getBoundingClientRect().height);
    const knownPostPath = /t51\.(?:29350|2885)-15/.test(source);
    return knownPostPath || (width >= 240 && height >= 240);
  }

  function getBestImageUrl(image) {
    const srcset = image.getAttribute('srcset') || '';
    const candidates = srcset.split(',').map((part) => {
      const match = part.trim().match(/^(\S+)\s+(\d+)(?:w|x)$/);
      return match ? { url: match[1], score: Number(match[2]) } : null;
    }).filter(Boolean).sort((a, b) => b.score - a.score);

    return candidates[0]?.url || image.currentSrc || image.src || '';
  }

  function findCarouselControl(root, direction) {
    const terms = direction === 'next'
      ? ['next', 'далее', 'следующ', 'siguiente', 'suivant', 'avanti', 'weiter', 'próxim', 'proxim', '次へ', '다음', '下一']
      : ['previous', 'back', 'назад', 'предыдущ', 'anterior', 'précéd', 'preced', 'zurück', '次へ戻', '이전', '上一'];

    const controls = root.querySelectorAll('button, [role="button"]');
    for (const control of controls) {
      const child = control.querySelector('[aria-label], title');
      const label = [
        control.getAttribute('aria-label'),
        control.getAttribute('title'),
        child?.getAttribute?.('aria-label'),
        child?.textContent
      ].filter(Boolean).join(' ').toLowerCase();

      if (terms.some((term) => label.includes(term)) && isVisible(control)) return control;
    }

    return null;
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 4 && rect.height > 4 && style.display !== 'none' && style.visibility !== 'hidden';
  }

  function isDisabled(element) {
    return Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true');
  }

  function waitForDomChange(root, timeout) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearTimeout(timer);
        setTimeout(resolve, 110);
      };
      const observer = new MutationObserver(finish);
      observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset'] });
      const timer = setTimeout(finish, timeout);
    });
  }

  function getCurrentContext(preferredShortcode = '') {
    const directShortcode = normalizeShortcode(preferredShortcode) || extractShortcode(location.href);
    let root = directShortcode ? findRootForShortcode(directShortcode) : null;
    if (!root) root = findMostVisibleArticle();

    const shortcode = directShortcode || extractShortcodeFromRoot(root);
    const username = extractUsername(root);
    const hasVideo = Boolean(root?.querySelector('video'));
    const mediaCount = root ? Math.max(1, countLikelyMedia(root)) : 0;

    return {
      ok: Boolean(shortcode),
      shortcode,
      username,
      kind: hasVideo ? 'video' : 'image',
      mediaCount,
      root,
      buttonRoot: root || (floatingEntry?.shortcode === shortcode ? floatingEntry.root : null)
    };
  }

  function publicContext(context) {
    return {
      ok: context.ok,
      shortcode: context.shortcode || '',
      username: context.username || '',
      kind: context.kind || '',
      mediaCount: context.mediaCount || 0,
      url: location.href
    };
  }

  function findRootForShortcode(shortcode) {
    const dialogArticle = document.querySelector('[role="dialog"] article');
    if (dialogArticle && (extractShortcodeFromRoot(dialogArticle) === shortcode || extractShortcode(location.href) === shortcode)) {
      return dialogArticle;
    }

    for (const article of document.querySelectorAll('article')) {
      if (extractShortcodeFromRoot(article) === shortcode) return article;
    }

    if (extractShortcode(location.href) === shortcode) {
      return document.querySelector('main article, article');
    }

    return null;
  }

  function findMostVisibleArticle() {
    let best = null;
    let bestScore = 0;

    for (const article of document.querySelectorAll('article')) {
      const rect = article.getBoundingClientRect();
      const visibleWidth = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
      const visibleHeight = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
      const area = visibleWidth * visibleHeight;
      const centerDistance = Math.abs((rect.top + rect.bottom) / 2 - innerHeight / 2);
      const score = area / (1 + centerDistance * 0.25);

      if (score > bestScore) {
        best = article;
        bestScore = score;
      }
    }

    return best;
  }

  function extractShortcodeFromRoot(root) {
    if (!root) return '';
    for (const link of root.querySelectorAll('a[href*="/p/"], a[href*="/reel/"], a[href*="/tv/"]')) {
      const shortcode = extractShortcode(link.href);
      if (shortcode) return shortcode;
    }
    return '';
  }

  function extractShortcode(value) {
    try {
      const url = new URL(value, location.origin);
      const match = url.pathname.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,30})(?:\/|$)/);
      return match?.[1] || '';
    } catch {
      return '';
    }
  }

  function extractUsername(root) {
    if (root) {
      const headerLinks = root.querySelectorAll('header a[href], a[href]');
      for (const link of headerLinks) {
        try {
          const path = new URL(link.href, location.origin).pathname;
          const match = path.match(/^\/([A-Za-z0-9._]{1,40})\/?$/);
          if (match && !['explore', 'accounts', 'direct', 'reels', 'stories'].includes(match[1])) return match[1];
        } catch {
          // Ignore malformed links from page markup.
        }
      }
    }

    const title = document.querySelector('meta[property="og:title"]')?.content || '';
    const titleMatch = title.match(/\(@([A-Za-z0-9._]+)\)/);
    return sanitizeUsername(titleMatch?.[1]) || 'instagram';
  }

  function countLikelyMedia(root) {
    const keys = new Set();
    for (const video of root.querySelectorAll('video')) {
      const url = video.currentSrc || video.src;
      if (url) keys.add(canonicalMediaKey(url, 'video'));
    }
    for (const image of root.querySelectorAll('img')) {
      if (!isLikelyPostImage(image)) continue;
      const url = getBestImageUrl(image);
      if (url) keys.add(canonicalMediaKey(url, 'image'));
    }
    return keys.size;
  }

  function handleDownloadProgress(message) {
    const root = jobRoots.get(message.jobId);

    if (message.phase === 'downloading') {
      const done = numberOrZero(message.done);
      showToast('loading', 'Скачивание', `${done} из ${message.total}`, true);
      return;
    }

    if (message.phase === 'finished') {
      const hasSuccess = numberOrZero(message.completed) > 0;
      if (root) {
        setButtonState(root, hasSuccess ? 'success' : 'error');
        setTimeout(() => setButtonState(root, 'idle'), 2200);
      }
      jobRoots.delete(message.jobId);

      if (message.failed > 0) {
        showToast(
          hasSuccess ? 'warning' : 'error',
          hasSuccess ? 'Загрузка завершена частично' : 'Ошибка загрузки',
          hasSuccess ? `Готово: ${message.completed}, ошибок: ${message.failed}` : friendlyError(message.error)
        );
      } else {
        showToast('success', 'Загрузка завершена', `Файлов сохранено: ${message.completed}`);
      }
    }
  }

  function showToast(kind, title, detail = '', sticky = false) {
    const ui = ensureToast();
    clearTimeout(ui.timer);
    ui.toast.dataset.kind = kind;
    ui.title.textContent = title;
    ui.detail.textContent = detail;
    ui.detail.hidden = !detail;
    ui.toast.classList.add('visible');

    if (!sticky) {
      ui.timer = setTimeout(() => ui.toast.classList.remove('visible'), kind === 'error' ? 5200 : 3400);
    }
  }

  function ensureToast() {
    if (toastUi?.host?.isConnected) return toastUi;

    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:50%;bottom:24px;z-index:2147483647;pointer-events:none;';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .toast {
          box-sizing: border-box;
          width: min(390px, calc(100vw - 28px));
          min-height: 64px;
          display: grid;
          grid-template-columns: 38px minmax(0, 1fr);
          align-items: center;
          gap: 12px;
          padding: 12px 16px 12px 12px;
          color: #f8fafc;
          background: rgba(15,23,42,.94);
          border: 1px solid rgba(148,163,184,.24);
          border-radius: 18px;
          box-shadow: 0 22px 60px rgba(2,6,23,.38), inset 0 1px 0 rgba(255,255,255,.06);
          backdrop-filter: blur(18px) saturate(1.3);
          -webkit-backdrop-filter: blur(18px) saturate(1.3);
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          opacity: 0;
          transform: translate(-50%, 18px) scale(.96);
          transition: opacity .22s ease, transform .22s cubic-bezier(.2,.8,.2,1);
        }
        .toast.visible { opacity: 1; transform: translate(-50%, 0) scale(1); }
        .icon {
          width: 38px;
          height: 38px;
          display: grid;
          place-items: center;
          border-radius: 12px;
          background: linear-gradient(135deg, #7c3aed, #db2777);
          box-shadow: 0 8px 20px rgba(124,58,237,.28);
        }
        .icon svg { width: 20px; height: 20px; }
        [data-kind="success"] .icon { background: linear-gradient(135deg, #059669, #0d9488); }
        [data-kind="error"] .icon { background: linear-gradient(135deg, #dc2626, #e11d48); }
        [data-kind="warning"] .icon { background: linear-gradient(135deg, #d97706, #ea580c); }
        [data-kind="loading"] .icon svg { animation: bounce 1s ease-in-out infinite; }
        .title { font-size: 14px; line-height: 1.25; font-weight: 700; letter-spacing: -.01em; }
        .detail { margin-top: 4px; color: #cbd5e1; font-size: 12px; line-height: 1.35; overflow-wrap: anywhere; }
        @keyframes bounce { 50% { transform: translateY(3px); opacity: .55; } }
        @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
      </style>
      <div class="toast" role="status" aria-live="polite">
        <div class="icon">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 15v3.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V15" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div><div class="title"></div><div class="detail"></div></div>
      </div>`;

    document.documentElement.append(host);
    toastUi = {
      host,
      toast: shadow.querySelector('.toast'),
      title: shadow.querySelector('.title'),
      detail: shadow.querySelector('.detail'),
      timer: 0
    };
    return toastUi;
  }

  function sendRuntime(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(response);
      });
    });
  }

  function pickLargest(candidates) {
    return candidates
      .filter((item) => item && typeof item.url === 'string' && item.url.startsWith('http'))
      .sort((a, b) => {
        const scoreA = numberOrZero(a.width) * numberOrZero(a.height) + numberOrZero(a.bitrate);
        const scoreB = numberOrZero(b.width) * numberOrZero(b.height) + numberOrZero(b.bitrate);
        return scoreB - scoreA;
      })[0];
  }

  function isAllowedMediaUrl(rawUrl) {
    try {
      const url = new URL(rawUrl);
      const host = url.hostname.toLowerCase();
      return url.protocol === 'https:' && (
        host === 'instagram.com' ||
        host.endsWith('.instagram.com') ||
        host.endsWith('.cdninstagram.com') ||
        host.endsWith('.fbcdn.net')
      );
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

  function normalizeShortcode(value) {
    const shortcode = String(value || '').trim();
    return /^[A-Za-z0-9_-]{5,30}$/.test(shortcode) ? shortcode : '';
  }

  function sanitizeUsername(value) {
    return String(value || '').replace(/^@/, '').replace(/[^A-Za-z0-9._]/g, '').slice(0, 40) || 'instagram';
  }

  function normalizeTimestamp(value) {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return Math.floor(Date.now() / 1000);
    return timestamp > 1e12 ? Math.floor(timestamp / 1000) : Math.floor(timestamp);
  }

  function numberOrZero(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function friendlyError(error) {
    const message = typeof error === 'string' ? error : error?.message;
    if (!message) return 'Повторите попытку после обновления страницы';
    if (/Receiving end does not exist|message port closed/i.test(message)) return 'Обновите вкладку Instagram и повторите';
    return message;
  }

  function errorResponse(error) {
    return { ok: false, message: friendlyError(error) };
  }
})();
