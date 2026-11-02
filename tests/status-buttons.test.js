const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const userScript = fs.readFileSync(
  path.resolve(__dirname, '..', 'dist', 'douban-wish-grid.user.js'),
  'utf8'
);
const primaryTitle = '赘婿·龙蛇篇';
const encodedTitle = encodeURIComponent(primaryTitle);
const expectedResources = [
  {
    site: 'yuneu',
    label: '云易搜',
    href: `https://so.yuneu.com/s/${encodedTitle}.html`
  },
  {
    site: 'goupan',
    label: '狗盘',
    href: `https://goupan.top/s/${encodedTitle}.html`
  }
];

function parseUrlEncoded(body) {
  return Object.fromEntries(new URLSearchParams(body));
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const apiGets = [];
  const posts = [];
  const statuses = new Map([
    ['1292052', 'wish'],
    ['1292053', 'wish']
  ]);
  const postAttempts = new Map();
  let refreshCkGets = 0;

  const basePage = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>豆瓣想看</title></head>
<body><div id="content"><div class="grid-view"></div><div class="paginator"></div></div></body></html>`;

  const itemPage = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>豆瓣想看</title></head>
<body><div id="content"><div class="grid-view">
  <div class="item">
    <div class="pic"><a href="https://movie.douban.com/subject/1292052/"><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" alt="测试影片"></a></div>
    <div class="info"><div class="title"><a href="https://movie.douban.com/subject/1292052/">赘婿·龙蛇篇 / 赘婿 第二季 / 赘婿 动画版第二季</a></div><span class="rating_nums">9.0</span></div>
  </div>
</div><div class="paginator"></div></div></body></html>`;

  const subjectPage = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>赘婿·龙蛇篇 (豆瓣)</title></head>
<body><div id="content"><h1><span property="v:itemreviewed">赘婿·龙蛇篇</span> <span class="year">(2025)</span></h1>
<div class="article">剧情简介</div></div></body></html>`;

  await page.route('https://movie.douban.com/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    const isListPage =
      /^\/mine\/?$/.test(url.pathname) ||
      /^\/people\/[^/]+\/(?:wish|do|collect)\/?$/.test(url.pathname);
    if (isListPage && request.method() === 'GET') {
      const wantsGrid = url.searchParams.get('mode') === 'grid';
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: wantsGrid ? itemPage : basePage
      });
      return;
    }

    const interestMatch = /^\/j\/subject\/(\d+)\/interest$/.exec(url.pathname);
    if (interestMatch && request.method() === 'GET') {
      const movieId = interestMatch[1];
      const currentStatus = statuses.get(movieId) || 'wish';
      apiGets.push({ movieId, url: request.url() });
      await new Promise((resolve) => setTimeout(resolve, 180));
      const html = `<form action="/j/subject/${movieId}/interest" method="post">
        <input type="hidden" name="ck" value="abc">
        <input name="interest" value="wish">
        <input name="rating" value="8">
        <input name="comment" value="保留评论">
        <input name="tags" value="test">
        <input type="hidden" name="share-shuo" value="douban">
      </form>`;
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ interest_status: currentStatus, tags: [], html })
      });
      return;
    }

    const subjectMatch = /^\/subject\/(\d+)\/$/.exec(url.pathname);
    if (subjectMatch && request.method() === 'GET') {
      if (subjectMatch[1] === '37191789') {
        await route.fulfill({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: subjectPage
        });
        return;
      }

      refreshCkGets += 1;
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: `<html><head><meta name="ck" content="refreshed-${subjectMatch[1]}"></head><body></body></html>`
      });
      return;
    }

    if (interestMatch && request.method() === 'POST') {
      const movieId = interestMatch[1];
      const bodyText = request.postDataBuffer()?.toString('utf8') || '';
      const fields = parseUrlEncoded(bodyText);
      const attempt = (postAttempts.get(movieId) || 0) + 1;
      postAttempts.set(movieId, attempt);
      posts.push({
        movieId,
        url: request.url(),
        body: bodyText,
        contentType: request.headers()['content-type'] || '',
        fields
      });
      await new Promise((resolve) => setTimeout(resolve, 180));
      if (movieId === '1292052' && fields.interest === 'do') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({ error: '模拟失败 <img src=x onerror=alert(1)>' })
        });
      } else if (movieId === '1292053' && attempt === 1) {
        await route.fulfill({
          status: 403,
          contentType: 'text/plain; charset=utf-8',
          body: 'forbidden'
        });
      } else {
        statuses.set(movieId, fields.interest);
        await route.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({ r: 0, interest_status: fields.interest })
        });
      }
      return;
    }

    await route.fulfill({ status: 404, body: 'not found' });
  });

  page.on('pageerror', (error) => {
    throw new Error(`页面脚本异常: ${error.message}`);
  });

  const listCases = [
    ['https://movie.douban.com/mine?status=wish', 'wish'],
    ['https://movie.douban.com/mine?status=do', 'do'],
    ['https://movie.douban.com/mine?status=collect', 'collect'],
    ['https://movie.douban.com/people/test/wish', 'wish'],
    ['https://movie.douban.com/people/test/do', 'do'],
    ['https://movie.douban.com/people/test/collect', 'collect']
  ];
  const statusLabels = { wish: '想看', do: '在看', collect: '看过' };
  const matrixResults = [];

  for (const [url, status] of listCases) {
    await page.goto(url);
    await page.addScriptTag({ content: userScript });
    await page.waitForSelector('.item .dw-status-actions');

    const card = await page.evaluate(() => {
      const item = document.querySelector('.item');
      return {
        toolbarTitle: document.querySelector('#dw-wish-grid-toolbar strong')?.textContent,
        status: item.dataset.dwStatus,
        badge: item.querySelector('.dw-status-badge')?.textContent,
        pressed: [...item.querySelectorAll('.dw-status-action[aria-pressed="true"]')].map((button) => button.dataset.status),
        resources: [...item.querySelectorAll('.dw-resource-link')].map((link) => ({
          site: link.dataset.site,
          label: link.textContent,
          href: link.href,
          target: link.target,
          rel: link.rel
        }))
      };
    });

    assert.equal(card.toolbarTitle, '豆瓣影视收藏 · 自适应网格', `${url} 应显示通用工具栏`);
    assert.equal(card.status, status, `${url} 应识别页面状态`);
    assert.equal(card.badge, statusLabels[status], `${url} 应显示正确状态徽标`);
    assert.deepEqual(card.pressed, [status], `${url} 应只高亮当前状态`);
    assert.deepEqual(card.resources, expectedResources.map((resource) => ({
      ...resource,
      target: '_blank',
      rel: 'noopener noreferrer'
    })), `${url} 应保留两个资源搜索入口`);
    matrixResults.push({ url, status });
  }

  await page.goto('https://movie.douban.com/subject/37191789/');
  await page.addScriptTag({ content: userScript });
  await page.waitForSelector('#dw-subject-resources .dw-resource-link');
  const subjectResources = await page.evaluate(() => ({
    panelLabel: document.querySelector('#dw-subject-resources .dw-subject-resources-label')?.textContent,
    followingHeading: document.getElementById('dw-subject-resources')?.previousElementSibling?.tagName,
    resources: [...document.querySelectorAll('#dw-subject-resources .dw-resource-link')].map((link) => ({
      site: link.dataset.site,
      label: link.textContent,
      href: link.href,
      target: link.target,
      rel: link.rel
    })),
    gridMode: document.body.classList.contains('dw-wish-grid-mode'),
    toolbar: document.getElementById('dw-wish-grid-toolbar'),
    statusActions: document.querySelectorAll('.dw-status-action').length
  }));
  assert.equal(subjectResources.panelLabel, '资源搜索：');
  assert.equal(subjectResources.followingHeading, 'H1', '详情页资源入口应紧跟在标题后');
  assert.deepEqual(subjectResources.resources, expectedResources.map((resource) => ({
    ...resource,
    target: '_blank',
    rel: 'noopener noreferrer'
  })), '详情页应使用主片名提供两个资源搜索入口');
  assert.equal(subjectResources.gridMode, false, '详情页不应启用收藏网格模式');
  assert.equal(subjectResources.toolbar, null, '详情页不应显示收藏列表工具栏');
  assert.equal(subjectResources.statusActions, 0, '详情页不应显示三态按钮');

  await page.goto('https://movie.douban.com/mine?status=wish');
  await page.addScriptTag({ content: userScript });
  await page.waitForSelector('.item .dw-status-actions');

  const initial = await page.evaluate(() => {
    const item = document.querySelector('.item');
    return {
      movieId: item.dataset.movieId,
      status: item.dataset.dwStatus,
      labels: [...item.querySelectorAll('.dw-status-action')].map((button) => button.textContent),
      pressed: [...item.querySelectorAll('.dw-status-action[aria-pressed="true"]')].map((button) => button.dataset.status),
      badge: item.querySelector('.dw-status-badge')?.textContent
    };
  });
  assert.deepEqual(initial, {
    movieId: '1292052',
    status: 'wish',
    labels: ['想看', '在看', '看过'],
    pressed: ['wish'],
    badge: '想看'
  });

  const initialResources = await page.evaluate(() =>
    [...document.querySelectorAll('.item:first-child .dw-resource-link')].map((link) => ({
      site: link.dataset.site,
      label: link.textContent,
      href: link.href,
      target: link.target,
      rel: link.rel
    }))
  );
  assert.deepEqual(initialResources, expectedResources.map((resource) => ({
    ...resource,
    target: '_blank',
    rel: 'noopener noreferrer'
  })), '每张卡片应有两个资源入口，并使用主片名搜索');

  await page.evaluate(() => {
    document
      .querySelector('.item:first-child .dw-resource-link[data-site="yuneu"]')
      .addEventListener('click', (event) => event.preventDefault(), { once: true });
  });
  const apiGetsBeforeResourceClick = apiGets.length;
  await page.click('.item:first-child .dw-resource-link[data-site="yuneu"]');
  await page.waitForTimeout(120);
  assert.equal(apiGets.length, apiGetsBeforeResourceClick, '点击资源搜索不应触发现有状态提交');

  await page.click('.item .dw-status-action[data-status="wish"]');
  await page.waitForTimeout(150);
  assert.equal(apiGets.length, 0, '点击当前状态不应发起请求');

  await page.click('.item .dw-status-action[data-status="collect"]');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.item .dw-status-action')].every((button) => button.disabled)
  );
  assert.equal(apiGets.length, 1, '应发起一次状态表单 GET');
  assert.match(apiGets[0].url, /\/j\/subject\/1292052\/interest\?interest=collect$/);

  await page.waitForFunction(() => document.querySelector('.item')?.dataset.dwStatus === 'collect');
  const success = await page.evaluate(() => {
    const item = document.querySelector('.item');
    return {
      badge: item.querySelector('.dw-status-badge')?.textContent,
      pressed: [...item.querySelectorAll('.dw-status-action[aria-pressed="true"]')].map((button) => button.dataset.status),
      message: item.querySelector('.dw-status-message')?.textContent,
      disabled: [...item.querySelectorAll('.dw-status-action')].some((button) => button.disabled)
    };
  });
  assert.deepEqual(success, {
    badge: '看过',
    pressed: ['collect'],
    message: '状态已更新并确认。',
    disabled: false
  });

  assert.equal(posts.length, 1);
  assert.equal(posts[0].movieId, '1292052');
  assert.match(posts[0].url, /\/j\/subject\/1292052\/interest$/);
  assert.deepEqual(posts[0].fields, {
    ck: 'abc',
    interest: 'collect',
    rating: '8',
    comment: '保留评论',
    tags: 'test'
  });
  assert.match(posts[0].contentType, /application\/x-www-form-urlencoded/i);
  assert.match(posts[0].body, /(?:^|&)interest=collect(?:&|$)/);
  assert.doesNotMatch(posts[0].body, /share-shuo/);

  await page.click('.item .dw-status-action[data-status="do"]');
  await page.waitForFunction(() =>
    document.querySelector('.item .dw-status-message')?.dataset.state === 'error'
  );
  const failed = await page.evaluate(() => {
    const item = document.querySelector('.item');
    const message = item.querySelector('.dw-status-message');
    return {
      status: item.dataset.dwStatus,
      badge: item.querySelector('.dw-status-badge')?.textContent,
      pressed: [...item.querySelectorAll('.dw-status-action[aria-pressed="true"]')].map((button) => button.dataset.status),
      message: message?.textContent,
      injectedImages: message?.querySelectorAll('img').length,
      disabled: [...item.querySelectorAll('.dw-status-action')].some((button) => button.disabled)
    };
  });
  assert.equal(failed.status, 'collect', '失败后应保留原状态');
  assert.equal(failed.badge, '看过');
  assert.deepEqual(failed.pressed, ['collect']);
  assert.match(failed.message, /更新失败：模拟失败 <img src=x onerror=alert\(1\)>/);
  assert.equal(failed.injectedImages, 0, '错误文本必须按纯文本展示');
  assert.equal(failed.disabled, false);

  await page.click('.item .dw-status-action[data-status="wish"]');
  await page.waitForFunction(() => document.querySelector('.item')?.dataset.dwStatus === 'wish');
  assert.deepEqual(posts[2].fields, {
    ck: 'abc',
    interest: 'wish',
    rating: '',
    comment: '保留评论',
    tags: 'test'
  });
  assert.match(posts[2].contentType, /application\/x-www-form-urlencoded/i);

  await page.evaluate(() => {
    const item = document.createElement('div');
    item.className = 'item';
    item.dataset.movieId = '1292053';
    item.innerHTML = `
      <div class="pic"><a href="https://movie.douban.com/subject/1292053/"><span class="dw-status-badge">想看</span></a></div>
      <div class="dw-caption"><a href="https://movie.douban.com/subject/1292053/">赘婿·龙蛇篇 / 赘婿 第二季 / 赘婿 动画版第二季</a></div>
      <div class="dw-status-actions">
        <button type="button" class="dw-status-action" data-status="wish" aria-pressed="false">想看</button>
        <button type="button" class="dw-status-action" data-status="do" aria-pressed="false">在看</button>
        <button type="button" class="dw-status-action" data-status="collect" aria-pressed="false">看过</button>
        <div class="dw-status-message" role="status" aria-live="polite"></div>
      </div>`;
    document.querySelector('.grid-view').appendChild(item);
  });
  await page.waitForSelector('.item[data-movie-id="1292053"] .dw-resource-link');
  const dynamicResources = await page.evaluate(() => {
    const item = document.querySelector('.item[data-movie-id="1292053"]');
    return {
      captions: item.querySelectorAll('.dw-caption').length,
      title: item.querySelector('.dw-caption a')?.textContent,
      resources: [...item.querySelectorAll('.dw-resource-link')].map((link) => ({
        site: link.dataset.site,
        label: link.textContent,
        href: link.href,
        target: link.target,
        rel: link.rel
      }))
    };
  });
  assert.equal(dynamicResources.captions, 1, '动态卡片不应产生重复标题');
  assert.equal(dynamicResources.title, '赘婿·龙蛇篇 / 赘婿 第二季 / 赘婿 动画版第二季');
  assert.deepEqual(dynamicResources.resources, expectedResources.map((resource) => ({
    ...resource,
    target: '_blank',
    rel: 'noopener noreferrer'
  })), '动态新增卡片也应自动补上两个资源入口');
  await page.click('.item[data-movie-id="1292053"] .dw-status-action[data-status="do"]');
  await page.waitForFunction(() =>
    document.querySelector('.item[data-movie-id="1292053"]')?.dataset.dwStatus === 'do'
  );
  const dynamic = await page.evaluate(() => {
    const item = document.querySelector('.item[data-movie-id="1292053"]');
    return {
      badge: item.querySelector('.dw-status-badge')?.textContent,
      pressed: item.querySelector('.dw-status-action[data-status="do"]')?.getAttribute('aria-pressed')
    };
  });
  assert.deepEqual(dynamic, { badge: '在看', pressed: 'true' });
  assert.equal(apiGets.at(-1).movieId, '1292053');
  assert.equal(refreshCkGets, 1, 'HTTP 403 后应刷新一次 ck');
  assert.equal(posts.length, 5, '403 后应只重试一次');
  assert.equal(posts[3].movieId, '1292053');
  assert.deepEqual(posts[3].fields, {
    ck: 'abc',
    interest: 'do',
    rating: '8',
    comment: '保留评论',
    tags: 'test'
  });
  assert.deepEqual(posts[4].fields, {
    ck: 'refreshed-1292053',
    interest: 'do',
    rating: '8',
    comment: '保留评论',
    tags: 'test'
  });
  for (const post of posts) {
    assert.match(post.contentType, /application\/x-www-form-urlencoded/i);
    assert.doesNotMatch(post.body, /share-shuo/);
  }

  await browser.close();
  console.log(JSON.stringify({
    ok: true,
    apiGets: apiGets.length,
    posts: posts.length,
    refreshCkGets,
    dynamicCard: dynamic,
    subjectResources,
    pages: matrixResults
  }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
