// 自動化端到端測試（Playwright，內建極簡 runner，不需另裝 @playwright/test）
// 用法：python3 -m http.server 8765 &   然後   node tools/qa/e2e.cjs [baseUrl]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const ROOT = path.resolve(__dirname, '..', '..');
const BASE = process.argv[2] || 'http://localhost:8765/';
const SLUGS = { '中壢區':'zhongli','八德區':'bade','大園區':'dayuan','大溪區':'daxi','平鎮區':'pingzhen','復興區':'fuxing','新屋區':'xinwu','桃園區':'taoyuan','楊梅區':'yangmei','蘆竹區':'luzhu','觀音區':'guanyin','龍潭區':'longtan','龜山區':'guishan' };
const summary = (slug, market = 'presale', w = 24) => JSON.parse(fs.readFileSync(path.join(ROOT, `data/summaries/${slug}_${market}_${w}.json`), 'utf8'));
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

let browser;
async function open(url, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: opts.width || 1280, height: 900 }, reducedMotion: opts.reducedMotion || 'no-preference', javaScriptEnabled: opts.js !== false });
  const page = await ctx.newPage();
  const errors = [], requests = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => requests.push(r.url().replace(BASE, '')));
  if (!opts.intro) await page.addInitScript(() => sessionStorage.setItem('beido-intro-played', '1'));
  await page.goto(BASE + url, { waitUntil: 'networkidle' });
  if (opts.js !== false) await page.waitForSelector('#app:not([hidden])', { timeout: 45000 });
  return { page, ctx, errors, requests };
}

// 1. 每頁可開、無 console error、網址正確、關鍵數字出現
test('全市頁可開、無錯誤、摘要等於靜態 JSON', async () => {
  const { page, ctx, errors } = await open('');
  assert.equal((await page.textContent('.auto-text')).trim(), summary('city').text);
  assert.match(await page.title(), /桃園/);
  assert.deepEqual(errors, []);
  await ctx.close();
});
for (const [d, slug] of Object.entries(SLUGS)) {
  test(`${d} /district/${slug}/ 可開、數字一致`, async () => {
    const { page, ctx, errors } = await open(`district/${slug}/`);
    assert.ok(new URL(page.url()).pathname.endsWith(`/district/${slug}/`));
    assert.equal(await page.textContent('h1'), `${d}房價行情`);
    const s = summary(slug);
    assert.equal((await page.textContent('.auto-text')).trim(), s.text);
    if (s.figures.p50_unit != null) {
      const stat = await page.$$eval('.stat4 .kpi-value', els => els.map(e => e.firstChild.textContent.trim()));
      assert.equal(stat[0], Math.round(s.figures.sample_count).toLocaleString('en-US'));
      assert.equal(stat[2], s.figures.p50_unit.toFixed(1));
    }
    assert.equal(await page.$$eval('.tile', t => t.length), 13);
    assert.equal(await page.$eval('.tile.is-current b', b => b.textContent), d);
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}

// 2. 分頁切換
test('行政區五分頁切換：aria-selected、註解、網址 dtab', async () => {
  const { page, ctx, errors } = await open('district/zhongli/?market=resale');
  for (const tab of ['trend', 'structure', 'projects', 'people', 'overview']) {
    await page.click(`[data-dtab="${tab}"]`);
    await page.waitForSelector(`[data-dtab="${tab}"][aria-selected="true"]`);
    await page.waitForLoadState('networkidle');
    const note = (await page.textContent('.tab-note')).trim();
    assert.ok(note.length > 10 && !/NaN|undefined|null/.test(note), `${tab} note: ${note}`);
    const u = new URL(page.url());
    assert.equal(u.searchParams.get('dtab'), tab === 'overview' ? null : tab);
    assert.ok(u.pathname.endsWith('/district/zhongli/'));
  }
  assert.ok(await page.$('#dtab-panel .chart-svg') === null, 'overview 不渲染趨勢圖');
  assert.deepEqual(errors, []);
  await ctx.close();
});
test('切換行政區、上一頁、舊式 ?district= 連結轉址', async () => {
  const { page, ctx, errors } = await open('?district=%E5%85%AB%E5%BE%B7%E5%8D%80');
  assert.ok(new URL(page.url()).pathname.endsWith('/district/bade/'));
  await page.selectOption('#districtSelect', '龜山區');
  await page.waitForFunction(() => location.pathname.endsWith('/district/guishan/'));
  assert.equal(await page.textContent('h1'), '龜山區房價行情');
  await page.goBack(); await page.waitForFunction(() => location.pathname.endsWith('/district/bade/'));
  await page.waitForFunction(() => document.querySelector('h1').textContent === '八德區房價行情');
  assert.deepEqual(errors, []);
  await ctx.close();
});

// 3. 鍵盤與 a11y
test('分頁籤可用方向鍵、Home/End 切換，roving tabindex', async () => {
  const { page, ctx } = await open('district/zhongli/');
  await page.focus('[data-dtab="overview"]');
  await page.keyboard.press('ArrowRight');
  await page.waitForSelector('[data-dtab="trend"][aria-selected="true"]');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.dtab), 'trend');
  await page.keyboard.press('End');
  await page.waitForSelector('[data-dtab="people"][aria-selected="true"]');
  await page.keyboard.press('Home');
  await page.waitForSelector('[data-dtab="overview"][aria-selected="true"]');
  const tabindex = await page.$$eval('[role="tab"]', t => t.map(x => x.tabIndex));
  assert.deepEqual(tabindex, [0, -1, -1, -1, -1]);
  await ctx.close();
});
test('地圖彈窗：鍵盤開啟、焦點移入、Esc 關閉、焦點回到按鈕', async () => {
  const { page, ctx } = await open('district/zhongli/');
  await page.focus('#openMap'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#mapDialog').open);
  assert.ok(await page.evaluate(() => document.querySelector('#mapDialog').contains(document.activeElement)));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#mapDialog').open);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'openMap');
  await ctx.close();
});
test('圖表與 KPI 有文字替代，表格表頭有 scope', async () => {
  const { page, ctx } = await open('district/zhongli/?dtab=trend');
  const name = await page.$eval('#dtab-panel .chart-svg', svg => (svg.getAttribute('aria-labelledby') || '').split(' ').map(id => document.getElementById(id)?.textContent || '').join(' '));
  assert.ok(name.length > 30 && /萬／坪/.test(name), name);
  assert.ok(await page.$('#dtab-panel .chart-table table caption'));
  const ths = await page.$$eval('table th', t => t.filter(x => !x.getAttribute('scope')).length);
  assert.equal(ths, 0, '所有 th 需有 scope');
  const kpis = await page.$$eval('.stat4 .kpi', k => k.every(x => x.getAttribute('aria-label')));
  assert.ok(kpis);
  await ctx.close();
});
test('焦點樣式可見', async () => {
  const { page, ctx } = await open('district/zhongli/');
  await page.focus('[data-dmarket="presale"]'); await page.keyboard.press('Tab');
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  assert.notEqual(outline, 'none');
  await ctx.close();
});
test('prefers-reduced-motion：不播進場動畫、無平滑捲動', async () => {
  const { page, ctx } = await open('', { reducedMotion: 'reduce', intro: true });
  const intro = await page.evaluate(() => { const el = document.querySelector('#brandIntro'); return el.classList.contains('is-skipped') || getComputedStyle(el).display === 'none'; });
  assert.ok(intro, 'reduce 時不顯示 intro');
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), 'auto');
  await ctx.close();
});

// 4. 效能：延遲載入
test('延遲載入：預售建案、建案索引、轉址表只在需要時才抓', async () => {
  const { page, ctx, requests } = await open('district/zhongli/');
  const got = re => requests.some(u => re.test(u));
  assert.ok(!got(/presale_projects\//), '概覽不應載入預售建案檔');
  assert.ok(!got(/projects\/redirect\.json/), '無 project 參數不應載入 redirect');
  assert.ok(!got(/snapshots\/presale\/2025-04/), '非人口分頁不應載入去年快照');
  await page.click('[data-dtab="projects"]');
  await page.waitForSelector('.presale-table');
  assert.ok(got(/presale_projects\/zhongli\.json/));
  await page.click('[data-dtab="people"]'); await page.waitForSelector('.cross-table');
  await ctx.close();
});
test('預售建案清單分批顯示與排序', async () => {
  const { page, ctx } = await open('district/zhongli/?dtab=projects');
  const rows = await page.$$eval('.presale-table tbody tr', r => r.length);
  assert.ok(rows <= 30, `首屏 ${rows} 列`);
  await page.click('#morePresale'); await page.waitForTimeout(200);
  assert.ok(await page.$$eval('.presale-table tbody tr', r => r.length) > rows);
  await page.click('[data-psort="latest"]'); await page.waitForTimeout(200);
  const dates = await page.$$eval('.presale-table tbody tr td:nth-child(4)', t => t.map(x => x.textContent));
  assert.deepEqual(dates, [...dates].sort().reverse());
  await ctx.close();
});

// 5. 內容完整度：磁磚三態
test('磁磚牆三態：本區反白、本月無成交、樣本不足', async () => {
  const { page, ctx } = await open('district/fuxing/?market=resale&month=2026-04');
  const cur = await page.$eval('.tile.is-current', t => ({ name: t.querySelector('b').textContent, tags: t.textContent }));
  assert.equal(cur.name, '復興區'); assert.match(cur.tags, /本區/);
  const tags = await page.$$eval('.tile', ts => Object.fromEntries(ts.map(t => [t.querySelector('b').textContent, [...t.querySelectorAll('.tag')].map(x => x.textContent)])));
  const snap = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/snapshots/resale/2026-04.json'), 'utf8'));
  for (const [d, z] of Object.entries(snap.districts)) {
    if (!z.sample_count) assert.ok(tags[d].includes('本月無成交'), `${d} ${tags[d]}`);
    else if (z.sample_count < 5) assert.ok(tags[d].includes('樣本不足'), `${d} ${tags[d]}`);
    else assert.ok(!tags[d].includes('樣本不足') && !tags[d].includes('本月無成交'), `${d} ${tags[d]}`);
  }
  await ctx.close();
});

// 6. 無 JS 也有內容（SEO）
test('無 JavaScript：h1 與 FAQ 文字可見、JSON-LD 存在', async () => {
  const { page, ctx } = await open('district/taoyuan/', { js: false });
  assert.equal(await page.textContent('h1'), '桃園區房價行情');
  const html = await page.content();
  assert.ok(html.includes('application/ld+json') && html.includes('桃園區中古屋房價多少？'));
  await ctx.close();
});

(async () => {
  browser = await chromium.launch();
  let pass = 0, fail = 0;
  for (const [name, fn] of tests) {
    try { await fn(); pass++; console.log(`✓ ${name}`); }
    catch (e) { fail++; console.log(`✗ ${name}\n    ${String(e.message).replace(/\r/g, '').split('\n').slice(0, 4).join('\n    ')}`); }
  }
  await browser.close();
  console.log(`\ne2e: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
