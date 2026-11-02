// ==UserScript==
// @name         豆瓣影视收藏 · 自适应海报网格 + 自动加载全部 + 三态与资源搜索
// @namespace    https://github.com/anaconda110/douban-wish-grid
// @homepageURL  https://github.com/anaconda110/douban-wish-grid
// @supportURL   https://github.com/anaconda110/douban-wish-grid/issues
// @downloadURL  https://github.com/anaconda110/douban-wish-grid/releases/latest/download/douban-wish-grid.user.js
// @updateURL    https://github.com/anaconda110/douban-wish-grid/releases/latest/download/douban-wish-grid.user.js
// @version      1.8.0
// @description  将豆瓣影视“想看 / 在看 / 看过”收藏列表改为自适应海报网格、自动加载全部分页，并提供三态切换及云易搜/狗盘快捷搜索；影视详情页也可直接搜索资源。
// @match        https://movie.douban.com/subject/*
// @match        https://movie.douban.com/people/*/wish*
// @match        https://movie.douban.com/people/*/do*
// @match        https://movie.douban.com/people/*/collect*
// @match        https://movie.douban.com/mine*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;

  const STATUS_LABELS = Object.freeze({
    wish: '想看',
    do: '在看',
    collect: '看过'
  });
  const STATUS_ORDER = Object.freeze(['wish', 'do', 'collect']);

  function detectListStatus() {
    const pathMatch = /^\/people\/[^/]+\/(wish|do|collect)\/?$/.exec(location.pathname);
    if (pathMatch) return pathMatch[1];

    if (/^\/mine\/?$/.test(location.pathname)) {
      const status = new URLSearchParams(location.search).get('status');
      return STATUS_ORDER.includes(status) ? status : null;
    }

    return null;
  }

  const listStatus = detectListStatus();
  const isSubjectPage = /^\/subject\/\d+\/?$/.test(location.pathname);
  if (!listStatus && !isSubjectPage) return;

  const PAGE_CONCURRENCY = 4;
  const REQUEST_STAGGER_MS = 80;
  const MAX_PAGES = 500;
  const STYLE_ID = 'dw-wish-grid-style';
  const TOOLBAR_ID = 'dw-wish-grid-toolbar';
  const SUBJECT_RESOURCES_ID = 'dw-subject-resources';
  const SEARCH_SITES = Object.freeze([
    Object.freeze({
      id: 'yuneu',
      label: '云易搜',
      searchUrl: (keyword) => `https://so.yuneu.com/s/${encodeURIComponent(keyword)}.html`
    }),
    Object.freeze({
      id: 'goupan',
      label: '狗盘',
      searchUrl: (keyword) => `https://goupan.top/s/${encodeURIComponent(keyword)}.html`
    })
  ]);

  let grid = null;
  let statusText = null;
  let reloadButton = null;
  let loading = false;
  let runToken = 0;
  let loadedItems = 0;
  const seen = new Set();
  const pendingStatusItems = new WeakSet();

  injectStyles();

  if (isSubjectPage) {
    installSubjectResources();
  } else {
    startListPage();
  }

  function startListPage() {
    const readyTimer = window.setInterval(() => {
      const candidate = document.querySelector('.grid-view');
      if (!candidate) return;

      window.clearInterval(readyTimer);
      grid = candidate;
      grid.addEventListener('click', handleStatusActionClick);
      observeAddedItems(grid);
      document.body.classList.add('dw-wish-grid-mode');
      installToolbar();
      window.setTimeout(() => loadAllPages(), 250);
    }, 200);

    window.setTimeout(() => window.clearInterval(readyTimer), 15000);
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      body.dw-wish-grid-mode #wrapper {
        width: 100% !important;
        max-width: none !important;
      }

      body.dw-wish-grid-mode #content {
        box-sizing: border-box;
        width: calc(100vw - 32px) !important;
        max-width: none !important;
        margin-left: auto !important;
        margin-right: auto !important;
      }

      body.dw-wish-grid-mode .grid-16-8 {
        display: block !important;
      }

      body.dw-wish-grid-mode .article {
        width: 100% !important;
        float: none !important;
      }

      body.dw-wish-grid-mode .aside {
        display: none !important;
      }

      #${TOOLBAR_ID} {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        box-sizing: border-box;
        margin: 18px 0 22px;
        padding: 10px 14px;
        border: 1px solid #e5e5e5;
        border-radius: 8px;
        background: #fafafa;
        color: #666;
        font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
      }

      #${TOOLBAR_ID} strong {
        color: #333;
        font-weight: 600;
      }

      #${TOOLBAR_ID} button {
        flex: 0 0 auto;
        padding: 5px 12px;
        border: 1px solid #d5d5d5;
        border-radius: 6px;
        background: #fff;
        color: #426f9b;
        font: inherit;
        cursor: pointer;
      }

      #${TOOLBAR_ID} button:hover:not(:disabled) {
        border-color: #8aa8c4;
        background: #f4f8fb;
      }

      #${TOOLBAR_ID} button:disabled {
        cursor: default;
        opacity: 0.6;
      }

      #${TOOLBAR_ID} .dw-toolbar-status[data-state="error"] {
        color: #c33;
      }

      body.dw-wish-grid-mode .grid-view {
        display: grid !important;
        grid-template-columns: repeat(auto-fill, minmax(136px, 1fr));
        gap: 28px clamp(16px, 1.1vw, 22px);
        width: 100% !important;
        margin: 0 !important;
      }

      body.dw-wish-grid-mode .grid-view .item {
        display: flex !important;
        flex-direction: column;
        box-sizing: border-box;
        width: auto !important;
        min-width: 0;
        margin: 0 !important;
        padding: 0 !important;
        float: none !important;
        text-align: center;
      }

      body.dw-wish-grid-mode .grid-view .item .pic {
        position: relative;
        width: 100% !important;
        margin: 0 0 10px !important;
        aspect-ratio: 2 / 3;
        overflow: hidden;
        background: #f2f2f2;
      }

      body.dw-wish-grid-mode .grid-view .item .pic a {
        display: block !important;
        position: relative;
        width: 100%;
        height: 100%;
      }

      body.dw-wish-grid-mode .grid-view .item .pic img {
        display: block !important;
        width: 100% !important;
        height: 100% !important;
        object-fit: cover;
        margin: 0 !important;
        transition: transform 180ms ease;
      }

      body.dw-wish-grid-mode .grid-view .item:hover .pic img {
        transform: scale(1.025);
      }

      body.dw-wish-grid-mode .grid-view .dw-status-badge {
        position: absolute;
        top: 8px;
        left: 8px;
        z-index: 3;
        padding: 2px 7px;
        border-radius: 3px;
        background: #4a84bd;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
        color: #fff;
        font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
        letter-spacing: 0.04em;
        pointer-events: none;
      }

      body.dw-wish-grid-mode .grid-view .dw-status-badge[data-status="do"] {
        background: #4e8a5c;
      }

      body.dw-wish-grid-mode .grid-view .dw-status-badge[data-status="collect"] {
        background: #c77934;
      }

      body.dw-wish-grid-mode .grid-view .item .info {
        display: none !important;
      }

      body.dw-wish-grid-mode .grid-view .dw-caption {
        display: flex;
        align-items: baseline;
        justify-content: center;
        gap: 6px;
        min-height: 24px;
        padding: 0 2px;
        font: 15px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
        white-space: nowrap;
      }

      body.dw-wish-grid-mode .grid-view .dw-caption a {
        overflow: hidden;
        color: #3f74a5 !important;
        text-decoration: none !important;
        text-overflow: ellipsis;
      }

      body.dw-wish-grid-mode .grid-view .dw-caption a:hover {
        color: #245d92 !important;
        text-decoration: underline !important;
      }

      body.dw-wish-grid-mode .grid-view .dw-caption .dw-rating {
        flex: 0 0 auto;
        color: #e67e22;
        font-size: 14px;
      }

      body.dw-wish-grid-mode .grid-view .dw-status-actions {
        position: relative;
        z-index: 2;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 4px;
        box-sizing: border-box;
        width: 100%;
        margin-top: 5px;
      }

      body.dw-wish-grid-mode .grid-view .dw-status-action {
        box-sizing: border-box;
        min-width: 0;
        padding: 3px 2px;
        border: 1px solid #d7d7d7;
        border-radius: 4px;
        background: #fff;
        color: #666;
        font: 11px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
        white-space: nowrap;
        cursor: pointer;
        transition: border-color 120ms ease, background 120ms ease, color 120ms ease;
      }

      body.dw-wish-grid-mode .grid-view .dw-status-action:hover:not(:disabled):not([aria-pressed="true"]) {
        border-color: #9a9a9a;
        background: #f7f7f7;
        color: #333;
      }

      body.dw-wish-grid-mode .grid-view .dw-status-action[data-status="wish"][aria-pressed="true"] {
        border-color: #4a84bd;
        background: #4a84bd;
        color: #fff;
      }

      body.dw-wish-grid-mode .grid-view .dw-status-action[data-status="do"][aria-pressed="true"] {
        border-color: #4e8a5c;
        background: #4e8a5c;
        color: #fff;
      }

      body.dw-wish-grid-mode .grid-view .dw-status-action[data-status="collect"][aria-pressed="true"] {
        border-color: #c77934;
        background: #c77934;
        color: #fff;
      }

      body.dw-wish-grid-mode .grid-view .dw-status-action:focus-visible {
        outline: 2px solid #356f9f;
        outline-offset: 1px;
      }

      body.dw-wish-grid-mode .grid-view .dw-status-action:disabled {
        cursor: default;
        opacity: 0.52;
      }

      body.dw-wish-grid-mode .grid-view .dw-resource-actions {
        grid-column: 1 / -1;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 4px;
        margin-top: 1px;
      }

      body.dw-wish-grid-mode .grid-view .dw-resource-link {
        box-sizing: border-box;
        min-width: 0;
        overflow: hidden;
        padding: 2px 4px;
        border: 1px dashed #d4dde5;
        border-radius: 4px;
        background: #f8fafc;
        color: #54718d !important;
        font: 10px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
        text-align: center;
        text-decoration: none !important;
        text-overflow: ellipsis;
        white-space: nowrap;
        transition: border-color 120ms ease, background 120ms ease, color 120ms ease;
      }

      body.dw-wish-grid-mode .grid-view .dw-resource-link:hover {
        border-color: #91a9bd;
        background: #eef4f8;
        color: #315a7d !important;
      }

      body.dw-wish-grid-mode .grid-view .dw-resource-link:focus-visible {
        outline: 2px solid #356f9f;
        outline-offset: 1px;
      }

      body.dw-wish-grid-mode .grid-view .dw-status-message {
        grid-column: 1 / -1;
        overflow-wrap: anywhere;
        color: #888;
        font: 10px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
        text-align: left;
      }

      body.dw-wish-grid-mode .grid-view .dw-status-message:empty {
        display: none;
      }

      body.dw-wish-grid-mode .grid-view .dw-status-message[data-state="success"] {
        color: #3f7f4c;
      }

      body.dw-wish-grid-mode .grid-view .dw-status-message[data-state="error"] {
        color: #c33;
      }

      body.dw-wish-grid-mode .paginator {
        display: none !important;
      }

      #${SUBJECT_RESOURCES_ID} {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        box-sizing: border-box;
        margin: 12px 0 18px;
        padding: 10px 12px;
        border: 1px solid #e3e3e3;
        border-radius: 7px;
        background: #fafafa;
        color: #666;
        font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
      }

      #${SUBJECT_RESOURCES_ID} .dw-subject-resources-label {
        color: #555;
        font-weight: 600;
      }

      #${SUBJECT_RESOURCES_ID} .dw-resource-link {
        display: inline-flex;
        align-items: center;
        box-sizing: border-box;
        padding: 4px 12px;
        border: 1px dashed #c8d4df;
        border-radius: 5px;
        background: #fff;
        color: #426f9b !important;
        text-decoration: none !important;
        transition: border-color 120ms ease, background 120ms ease, color 120ms ease;
      }

      #${SUBJECT_RESOURCES_ID} .dw-resource-link:hover {
        border-color: #8aa8c4;
        background: #eef4f8;
        color: #245d92 !important;
      }

      #${SUBJECT_RESOURCES_ID} .dw-resource-link:focus-visible {
        outline: 2px solid #356f9f;
        outline-offset: 2px;
      }

      @media (max-width: 340px) {
        body.dw-wish-grid-mode #content {
          width: calc(100vw - 20px) !important;
        }

        body.dw-wish-grid-mode .grid-view {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 22px 12px;
        }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function installToolbar() {
    if (document.getElementById(TOOLBAR_ID) || !grid) return;

    const toolbar = document.createElement('div');
    toolbar.id = TOOLBAR_ID;

    const left = document.createElement('div');
    left.innerHTML = '<strong>豆瓣影视收藏 · 自适应网格</strong> <span class="dw-toolbar-status">准备加载全部…</span>';
    statusText = left.querySelector('.dw-toolbar-status');

    reloadButton = document.createElement('button');
    reloadButton.type = 'button';
    reloadButton.textContent = '重新加载全部';
    reloadButton.addEventListener('click', loadAllPages);

    toolbar.append(left, reloadButton);
    grid.parentNode.insertBefore(toolbar, grid);
  }

  async function loadAllPages() {
    if (!grid || loading) return;

    loading = true;
    loadedItems = 0;
    seen.clear();
    const token = ++runToken;

    reloadButton.disabled = true;
    reloadButton.textContent = '加载中…';
    setStatus('正在读取第 1 页…');

    try {
      const firstUrl = pageUrl(0, 15);
      const firstDoc = await fetchPage(firstUrl);
      const firstItems = extractPageItems(firstDoc);
      if (firstItems.length === 0) {
        throw new Error('没有读取到条目，请确认已经登录豆瓣');
      }

      const pageSize = inferPageSize(firstDoc, firstItems);
      const results = [firstItems];
      const failures = [];
      let renderIndex = 0;
      let completedPages = 1;
      let endReached = pageSize === 0 || firstItems.length < pageSize;

      const renderReadyPages = () => {
        while (renderIndex < results.length && results[renderIndex] !== undefined) {
          if (renderIndex === 0) grid.textContent = '';
          appendItems(results[renderIndex]);
          renderIndex += 1;
        }
      };

      renderReadyPages();
      setStatus(`第 1 页已显示，正在四路并发加载其余页面… 已加载 ${loadedItems} 部`);

      for (let batchStart = 1; !endReached && batchStart < MAX_PAGES; batchStart += PAGE_CONCURRENCY) {
        if (token !== runToken) return;

        const batchSize = Math.min(PAGE_CONCURRENCY, MAX_PAGES - batchStart);
        const indexes = Array.from({ length: batchSize }, (_, offset) => batchStart + offset);

        const outcomes = await Promise.all(indexes.map(async (pageIndex, offset) => {
          await delay(offset * REQUEST_STAGGER_MS);
          try {
            const doc = await fetchPage(pageUrl(pageIndex, pageSize));
            return { pageIndex, items: extractPageItems(doc) };
          } catch (error) {
            return { pageIndex, error };
          }
        }));

        if (token !== runToken) return;

        for (const outcome of outcomes) {
          completedPages += 1;
          if (outcome.error) {
            failures.push(outcome);
            results[outcome.pageIndex] = [];
            continue;
          }

          results[outcome.pageIndex] = outcome.items;
          if (outcome.items.length === 0) endReached = true;
        }

        renderReadyPages();

        if (failures.length > 0) {
          throw failures[0].error;
        }

        setStatus(`正在加载… 已完成 ${completedPages} 页，已显示 ${loadedItems} 部`);
      }

      renderReadyPages();
      if (token !== runToken) return;

      if (results[0]?.length === 0) {
        throw new Error('没有读取到条目');
      }

      const reachedLimit = completedPages >= MAX_PAGES;
      const limitNote = reachedLimit ? `（已达到 ${MAX_PAGES} 页上限）` : '';
      setStatus(`全部加载完成，共 ${loadedItems} 部${limitNote}`);
      reloadButton.textContent = '刷新全部';
    } catch (error) {
      if (token !== runToken) return;

      console.error('[豆瓣影视收藏网格] 加载失败：', error);
      setStatus(`加载中断：${error.message || '未知错误'}。已显示 ${loadedItems} 部`, 'error');
      reloadButton.textContent = '重新尝试';
    } finally {
      if (token === runToken) {
        loading = false;
        reloadButton.disabled = false;
      }
    }
  }

  function pageUrl(pageIndex, pageSize) {
    const url = new URL(location.href);
    url.searchParams.set('start', String(pageIndex * pageSize));
    url.searchParams.set('mode', 'grid');
    return url.href;
  }

  function inferPageSize(doc, firstItems) {
    const nextLink = doc.querySelector('.paginator .next a[href]');
    if (nextLink) {
      try {
        const nextUrl = new URL(nextLink.getAttribute('href'), location.origin);
        const nextStart = Number(nextUrl.searchParams.get('start'));
        if (Number.isInteger(nextStart) && nextStart > 0) return nextStart;
      } catch (_) {
        // Fall back to the number of items on the first page.
      }
    }
    return firstItems.length;
  }

  function extractPageItems(doc) {
    const items = Array.from(doc.querySelectorAll('.grid-view .item, #grid-view .item'));
    const normalized = [];
    for (const sourceItem of items) {
      const item = document.importNode(sourceItem, true);
      normalizeItem(item);
      normalized.push(item);
    }
    return normalized;
  }

  function appendItems(items) {
    const fragment = document.createDocumentFragment();
    for (const item of items) {
      const key = itemKey(item);
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      fragment.appendChild(item);
      loadedItems += 1;
    }
    grid.appendChild(fragment);
  }

  async function fetchPage(url, attempt = 0) {
    let response;
    try {
      response = await fetch(url, {
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'text/html,application/xhtml+xml' }
      });
    } catch (error) {
      if (attempt < 1) {
        await delay(500);
        return fetchPage(url, attempt + 1);
      }
      throw error;
    }

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < 1) {
        await delay(700);
        return fetchPage(url, attempt + 1);
      }
      throw new Error(`豆瓣返回 HTTP ${response.status}`);
    }

    const html = await response.text();
    if (/登录跳转|异常请求/.test(html) && !/grid-view/.test(html)) {
      throw new Error('豆瓣要求重新登录，请先登录后再刷新');
    }

    return new DOMParser().parseFromString(html, 'text/html');
  }

  function normalizeItem(item) {
    item.classList.add('dw-wish-item');

    const picLink = item.querySelector('.pic a[href*="/subject/"]');
    const titleLink = item.querySelector(
      '.dw-caption a[href*="/subject/"], .info .title a, .info a[href*="/subject/"], .title a'
    );
    const ratingNode = item.querySelector('.rating_nums');
    const poster = item.querySelector('.pic img, img');
    const pic = item.querySelector('.pic');

    if (poster) {
      const src = poster.getAttribute('data-original') || poster.getAttribute('src');
      if (src) poster.setAttribute('src', src);
      poster.setAttribute('loading', 'lazy');
      poster.setAttribute('decoding', 'async');
    }

    const href = titleLink?.getAttribute('href') || picLink?.getAttribute('href') || '';
    const title = cleanText(titleLink?.textContent || poster?.getAttribute('alt') || '');
    const rating = cleanText(ratingNode?.textContent || '');

    if (!title) return;

    const movieId = extractMovieId(href) || itemKey(item);
    if (movieId) item.dataset.movieId = movieId;

    let caption = item.querySelector('.dw-caption');
    if (!caption) {
      caption = document.createElement('div');
      caption.className = 'dw-caption';
    } else {
      caption.replaceChildren();
    }

    const titleAnchor = document.createElement('a');
    titleAnchor.href = absoluteUrl(href);
    titleAnchor.textContent = title;
    titleAnchor.title = title;
    caption.appendChild(titleAnchor);

    if (rating) {
      const ratingText = document.createElement('span');
      ratingText.className = 'dw-rating';
      ratingText.textContent = rating;
      caption.appendChild(ratingText);
    }

    let badge = pic?.querySelector('.dw-status-badge');
    if (pic && !badge) {
      badge = document.createElement('span');
      badge.className = 'dw-status-badge';
      pic.appendChild(badge);
    }

    const actions = item.querySelector('.dw-status-actions') || createStatusActions();
    ensureSearchActions(actions, title);

    const info = item.querySelector('.info');
    if (info) {
      info.replaceWith(caption, actions);
    } else {
      if (!caption.isConnected) item.appendChild(caption);
      if (!actions.isConnected) item.appendChild(actions);
    }

    setItemStatus(item, listStatus);
  }

  function observeAddedItems(root) {
    const observer = new MutationObserver((mutations) => {
      const items = new Set();

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches('.item:not(.dw-wish-item)')) items.add(node);
          for (const item of node.querySelectorAll('.item:not(.dw-wish-item)')) items.add(item);
        }
      }

      for (const item of items) normalizeItem(item);
    });

    observer.observe(root, { childList: true, subtree: true });
    window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  }

  function ensureSearchActions(actions, title) {
    const keyword = primaryTitle(title);
    if (!actions || !keyword) return;

    let row = actions.querySelector('.dw-resource-actions');
    if (!row) {
      row = document.createElement('div');
      row.className = 'dw-resource-actions';
      const message = actions.querySelector('.dw-status-message');
      actions.insertBefore(row, message || null);
    }

    row.textContent = '';
    for (const site of SEARCH_SITES) {
      row.appendChild(createResourceLink(site, keyword));
    }
  }

  function createResourceLink(site, keyword) {
    const link = document.createElement('a');
    link.className = 'dw-resource-link';
    link.dataset.site = site.id;
    link.href = site.searchUrl(keyword);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = site.label;
    link.title = `在${site.label}搜索《${keyword}》`;
    link.setAttribute('aria-label', link.title);
    return link;
  }

  function installSubjectResources() {
    const content = document.getElementById('content') || document.body;
    if (renderSubjectResources()) {
      observeSubjectResources(content);
      return;
    }

    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (renderSubjectResources()) {
        window.clearInterval(timer);
        observeSubjectResources(content);
      } else if (attempts >= 75) {
        window.clearInterval(timer);
      }
    }, 200);

    window.addEventListener('pagehide', () => window.clearInterval(timer), { once: true });
  }

  function renderSubjectResources() {
    const heading = document.querySelector('#content h1');
    const title = primaryTitle(heading?.querySelector('[property="v:itemreviewed"]')?.textContent || '');
    if (!heading || !title) return false;

    const existing = document.getElementById(SUBJECT_RESOURCES_ID);
    if (existing?.dataset.keyword === title) {
      if (existing.previousElementSibling !== heading) {
        heading.insertAdjacentElement('afterend', existing);
      }
      return true;
    }

    existing?.remove();

    const panel = document.createElement('div');
    panel.id = SUBJECT_RESOURCES_ID;
    panel.dataset.keyword = title;
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', '资源搜索');

    const label = document.createElement('span');
    label.className = 'dw-subject-resources-label';
    label.textContent = '资源搜索：';
    panel.appendChild(label);

    for (const site of SEARCH_SITES) {
      panel.appendChild(createResourceLink(site, title));
    }

    heading.insertAdjacentElement('afterend', panel);
    return true;
  }

  function observeSubjectResources(content) {
    let scheduled = false;
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        renderSubjectResources();
      });
    });

    observer.observe(content, { childList: true, subtree: true });
    window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  }

  function primaryTitle(value) {
    const title = cleanText(value);
    return title.split(/\s+\/\s+/)[0].trim() || title;
  }

  function itemKey(item) {
    const link = item.querySelector('.pic a[href*="/subject/"], .info a[href*="/subject/"], a[href*="/subject/"]');
    return extractMovieId(link?.getAttribute('href') || '');
  }

  function extractMovieId(href) {
    const match = /\/subject\/(\d+)/.exec(String(href || ''));
    return match ? match[1] : '';
  }

  function absoluteUrl(href) {
    try {
      return new URL(href, location.origin).href;
    } catch (_) {
      return location.href;
    }
  }

  function createStatusActions() {
    const actions = document.createElement('div');
    actions.className = 'dw-status-actions';

    for (const status of STATUS_ORDER) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'dw-status-action';
      button.dataset.status = status;
      button.textContent = STATUS_LABELS[status];
      button.setAttribute('aria-label', `标记为${STATUS_LABELS[status]}`);
      button.setAttribute('aria-pressed', 'false');
      actions.appendChild(button);
    }

    const message = document.createElement('div');
    message.className = 'dw-status-message';
    message.setAttribute('aria-live', 'polite');
    message.setAttribute('role', 'status');
    actions.appendChild(message);

    return actions;
  }

  function setItemStatus(item, status) {
    if (!STATUS_LABELS[status]) return;

    item.dataset.dwStatus = status;

    const badge = item.querySelector('.dw-status-badge');
    if (badge) {
      badge.dataset.status = status;
      badge.textContent = STATUS_LABELS[status];
    }

    for (const button of item.querySelectorAll('.dw-status-action[data-status]')) {
      button.setAttribute('aria-pressed', button.dataset.status === status ? 'true' : 'false');
    }
  }

  function setStatusMessage(item, text, state = '') {
    const message = item.querySelector('.dw-status-message');
    if (!message) return;

    message.textContent = text;
    if (state) {
      message.dataset.state = state;
    } else {
      delete message.dataset.state;
    }
  }

  function setStatusButtonsBusy(item, busy) {
    for (const button of item.querySelectorAll('.dw-status-action')) {
      button.disabled = busy;
    }
    if (busy) {
      item.dataset.dwStatusPending = 'true';
    } else {
      delete item.dataset.dwStatusPending;
    }
  }

  function handleStatusActionClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const button = target.closest('.dw-status-action');
    if (!button || !grid?.contains(button)) return;

    event.preventDefault();
    event.stopPropagation();

    const item = button.closest('.grid-view .item');
    const targetStatus = button.dataset.status;
    if (!item || !STATUS_LABELS[targetStatus] || pendingStatusItems.has(item)) return;

    const currentStatus = item.dataset.dwStatus || listStatus;
    if (currentStatus === targetStatus) return;

    void updateDoubanStatus(item, targetStatus);
  }

  async function updateDoubanStatus(item, targetStatus) {
    const movieId = item.dataset.movieId || itemKey(item);
    if (!movieId) {
      setStatusMessage(item, '无法识别影片 ID，请刷新页面后重试。', 'error');
      return;
    }

    pendingStatusItems.add(item);
    setStatusButtonsBusy(item, true);
    setStatusMessage(item, `正在标记为「${STATUS_LABELS[targetStatus]}」…`, 'pending');

    try {
      const infoUrl = new URL(`/j/subject/${movieId}/interest`, location.origin);
      infoUrl.searchParams.set('interest', targetStatus);

      const infoResponse = await fetch(infoUrl.href, {
        method: 'GET',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest'
        }
      });
      assertDoubanResponse(infoResponse, '读取状态表单');

      let info;
      try {
        info = await infoResponse.json();
      } catch (_) {
        throw new Error('豆瓣返回了无法识别的状态表单，可能是登录已过期');
      }

      if (!info || typeof info.html !== 'string' || !info.html.trim()) {
        throw new Error('豆瓣没有返回可用的状态表单');
      }

      const formDoc = new DOMParser().parseFromString(info.html, 'text/html');
      const form = formDoc.querySelector('form');
      if (!form) throw new Error('状态表单缺少提交地址，请稍后重试');

      const formData = new FormData(form);
      formData.set('interest', targetStatus);
      formData.delete('share-shuo');
      if (targetStatus === 'wish') formData.set('rating', '');

      let ck = readFormCk(form) || extractCkFromHtml(info.html) || readCookie('ck');
      if (!ck) ck = await fetchCkFromSubjectPage(movieId);
      if (!ck) throw new Error('状态表单缺少 ck 校验值，请刷新页面后重试');
      formData.set('ck', ck);

      const body = formDataToSearchParams(formData);

      const action = form.getAttribute('action') || `/j/subject/${movieId}/interest`;
      const submitUrl = new URL(action, location.origin);
      if (submitUrl.origin !== location.origin) {
        throw new Error('状态表单提交地址异常，已取消操作');
      }

      let submitResponse = await postInterestForm(movieId, submitUrl, body);
      if (submitResponse.status === 403) {
        const refreshedCk = await fetchCkFromSubjectPage(movieId).catch(() => '');
        if (refreshedCk && refreshedCk !== ck) {
          body.set('ck', refreshedCk);
          submitResponse = await postInterestForm(movieId, submitUrl, body);
        }
      }
      assertDoubanResponse(submitResponse, '提交状态');
      assertSubmitPayload(await submitResponse.text(), targetStatus);

      const verifiedStatus = await verifyCurrentStatus(movieId);
      if (verifiedStatus && verifiedStatus !== targetStatus) {
        throw new Error(`提交后复核仍显示「${STATUS_LABELS[verifiedStatus]}」，请刷新页面重试`);
      }

      setItemStatus(item, targetStatus);
      setStatusMessage(
        item,
        verifiedStatus === targetStatus ? '状态已更新并确认。' : '状态已提交，请刷新页面确认。',
        'success'
      );
    } catch (error) {
      console.error('[豆瓣影视收藏网格] 状态更新失败：', error);
      const message = cleanText(error?.message || '未知错误').slice(0, 160);
      setStatusMessage(item, `更新失败：${message}`, 'error');
    } finally {
      pendingStatusItems.delete(item);
      setStatusButtonsBusy(item, false);
    }
  }

  function readFormCk(form) {
    const input = form?.querySelector('input[name="ck"]');
    return cleanText(input?.value || '');
  }

  function extractCkFromHtml(html) {
    if (!html) return '';

    const doc = new DOMParser().parseFromString(String(html), 'text/html');
    for (const node of doc.querySelectorAll('[data-ck]')) {
      const value = cleanText(node.getAttribute('data-ck') || '');
      if (value) return value;
    }
    for (const node of doc.querySelectorAll('input[name="ck"], meta[name="ck"]')) {
      const value = cleanText(node.getAttribute('value') || node.getAttribute('content') || '');
      if (value) return value;
    }

    const fromUrl = String(html).match(/[?&]ck=([A-Za-z0-9_-]+)/i);
    return fromUrl?.[1] || '';
  }

  function readCookie(name) {
    const prefix = `${name}=`;
    for (const part of document.cookie.split(';')) {
      const value = part.trim();
      if (!value.startsWith(prefix)) continue;
      return decodeURIComponent(value.slice(prefix.length).replace(/^"|"$/g, ''));
    }
    return '';
  }

  async function fetchCkFromSubjectPage(movieId) {
    const subjectUrl = new URL(`/subject/${movieId}/`, location.origin);
    const response = await fetch(subjectUrl.href, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'text/html,application/xhtml+xml' }
    });
    assertDoubanResponse(response, '读取影片页面');
    return extractCkFromHtml(await response.text());
  }

  function formDataToSearchParams(formData) {
    const body = new URLSearchParams();
    for (const [name, value] of formData) {
      if (name === 'share-shuo') continue;
      body.append(name, typeof value === 'string' ? value : value.name);
    }
    return body;
  }

  function postInterestForm(movieId, submitUrl, body) {
    const subjectUrl = new URL(`/subject/${movieId}/`, location.origin);
    return fetch(submitUrl.href, {
      method: 'POST',
      credentials: 'same-origin',
      mode: 'same-origin',
      cache: 'no-store',
      referrer: subjectUrl.href,
      headers: {
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: body.toString()
    });
  }

  async function verifyCurrentStatus(movieId) {
    try {
      const infoUrl = new URL(`/j/subject/${movieId}/interest`, location.origin);
      infoUrl.searchParams.set('_', Date.now().toString());
      const response = await fetch(infoUrl.href, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest'
        }
      });
      assertDoubanResponse(response, '复核状态');
      return readInterestStatus(await response.json());
    } catch (error) {
      console.warn('[豆瓣影视收藏网格] 状态已提交，但暂时无法复核：', error);
      return null;
    }
  }

  function readInterestStatus(payload) {
    if (!payload || typeof payload !== 'object') return null;
    if (STATUS_LABELS[payload.interest_status]) return payload.interest_status;
    if (typeof payload.html !== 'string') return null;

    const doc = new DOMParser().parseFromString(payload.html, 'text/html');
    const checked = doc.querySelector('input[name="interest"]:checked');
    return STATUS_LABELS[checked?.value] ? checked.value : null;
  }

  function assertDoubanResponse(response, stage) {
    if (response.type === 'opaque' || response.type === 'opaqueredirect') {
      throw new Error(`${stage}被安全验证拦截，请刷新页面并确认已登录`);
    }
    if (!response.ok) {
      throw new Error(`${stage}失败（HTTP ${response.status}）`);
    }

    let responseUrl;
    try {
      responseUrl = new URL(response.url || location.href);
    } catch (_) {
      return;
    }

    if (
      responseUrl.hostname === 'sec.douban.com' ||
      responseUrl.hostname === 'accounts.douban.com' ||
      /登录|signin|passport/i.test(responseUrl.pathname)
    ) {
      throw new Error('豆瓣要求重新登录或安全验证，请刷新页面后重试');
    }
  }

  function assertSubmitPayload(text, targetStatus) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return;

    let payload = null;
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        payload = JSON.parse(trimmed);
      } catch (_) {
        throw new Error('豆瓣返回了无法识别的提交结果');
      }
    }

    if (payload && !Array.isArray(payload)) {
      const apiError = cleanText(payload.error || payload.err || payload.message || '');
      if (apiError && /失败|错误|异常|登录|验证|invalid|error/i.test(apiError)) {
        throw new Error(apiError);
      }
      if (payload.r !== undefined && ![0, '0', true, 'true'].includes(payload.r)) {
        throw new Error(cleanText(payload.msg || payload.message || '豆瓣未接受状态修改'));
      }
      if (payload.ok === false || payload.success === false) {
        throw new Error(cleanText(payload.msg || payload.message || '豆瓣未接受状态修改'));
      }
      if (payload.interest_status && payload.interest_status !== targetStatus) {
        throw new Error('豆瓣返回的状态与目标不一致');
      }
    }

    if (
      /<html|<body|<!doctype/i.test(trimmed) &&
      /登录跳转|异常请求|安全验证|sec\.douban\.com|验证码/.test(trimmed)
    ) {
      throw new Error('豆瓣要求重新登录或安全验证，请刷新页面后重试');
    }
  }

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function setStatus(text, state = '') {
    if (!statusText) return;
    statusText.textContent = text;
    statusText.dataset.state = state;
  }

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }
})();
