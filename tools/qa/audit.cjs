// 全面 QA：14 頁（全市＋13 區）× 390/768/1280 × 每個分頁籤
// 檢查：console/page error、請求失敗、整頁橫向溢出、元素超出視窗、文字被截斷、
//       表格/圖表需內部橫捲、摘要與四格統計數字與 data/summaries 靜態 JSON 一致、註解無空句/NaN
// 用法：node tools/qa/audit.cjs [baseUrl] [shotDir]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const BASE = process.argv[2] || 'http://localhost:8765/';
const SHOTS = process.argv[3] || '';
const SLUGS = { '中壢區':'zhongli','八德區':'bade','大園區':'dayuan','大溪區':'daxi','平鎮區':'pingzhen','復興區':'fuxing','新屋區':'xinwu','桃園區':'taoyuan','楊梅區':'yangmei','蘆竹區':'luzhu','觀音區':'guanyin','龍潭區':'longtan','龜山區':'guishan' };
const WIDTHS = [390, 768, 1280];
const DTABS = ['overview', 'trend', 'structure', 'projects', 'people'];
const CTABS = ['rank', 'grid', 'map', 'tx', 'people'];
const BAD = /NaN|undefined|\bnull\b|Infinity|待確認|\[object/;
const fmtInt = v => Math.round(v).toLocaleString('en-US');

async function inspect(page) {
  return page.evaluate(() => {
    const vw = innerWidth, out = { overflowX: document.documentElement.scrollWidth - vw, offscreen: [], truncated: [], innerScroll: [] };
    const scroller = el => { for (let a = el.parentElement; a; a = a.parentElement) { const ox = getComputedStyle(a).overflowX; if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return a; } return null; };
    const name = el => (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '') || el.tagName;
    for (const el of document.querySelectorAll('#app *, .site-header *, .hero *, .control-wrap *')) {
      if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
      if (el.closest('dialog:not([open])')) continue;
      if (el.closest('.sr-only')) continue;   // 刻意視覺隱藏的螢幕閱讀器文字
      const r = el.getBoundingClientRect(); if (!r.width) continue;
      if (r.right > vw + 1 && !scroller(el)) out.offscreen.push(name(el));
      const cs = getComputedStyle(el);
      if ((cs.textOverflow === 'ellipsis' || cs.overflowX === 'hidden') && el.scrollWidth > el.clientWidth + 1 && el.textContent.trim() && !el.matches('.hero, .content, main, .district-stage, .intro, .hero-grid, .d-tabs, .tx-scroll, .transaction-wrap, .chart-wrap')) out.truncated.push(name(el));
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1 && !el.matches('.d-tabs')) out.innerScroll.push(`${name(el)} ${el.scrollWidth}>${el.clientWidth}`);
    }
    out.offscreen = [...new Set(out.offscreen)].slice(0, 8); out.truncated = [...new Set(out.truncated)].slice(0, 8);
    return out;
  });
}

(async () => {
  const browser = await chromium.launch();
  const issues = []; let checks = 0;
  const note = (where, what) => { issues.push(`${where}: ${what}`); };
  const pages = [['city', '', null], ...Object.entries(SLUGS).map(([d, s]) => [s, `district/${s}/`, d])];
  for (const [slug, url, district] of pages) {
    const tabs = district ? DTABS : CTABS;
    const sumFile = path.join(ROOT, `data/summaries/${district ? slug : 'city'}_presale_24.json`);
    const sum = JSON.parse(fs.readFileSync(sumFile, 'utf8'));
    for (const w of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
      const page = await ctx.newPage();
      const errs = [];
      page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
      page.on('pageerror', e => errs.push('pageerror ' + e.message));
      page.on('requestfailed', r => { if (!/fonts\.(googleapis|gstatic)/.test(r.url())) errs.push('requestfailed ' + r.url()); });
      page.on('response', r => { if (r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url()}`); });
      await page.addInitScript(() => sessionStorage.setItem('beido-intro-played', '1'));
      await page.goto(BASE + url, { waitUntil: 'networkidle' });
      await page.waitForSelector('#app:not([hidden])');
      const where0 = `${slug}@${w}`;
      // 網址與數字一致性（預設：預售／近 24 月）
      if (district) {
        const p = new URL(page.url()).pathname;
        if (!p.endsWith(`/district/${slug}/`)) note(where0, `url ${p}`);
        const text = (await page.textContent('.auto-text')).trim();
        if (text !== sum.text) note(where0, 'summary != static JSON');
        const stat = await page.$$eval('.stat4 .kpi-value', els => els.map(e => e.firstChild.textContent.trim()));
        const f = sum.figures;
        if (f.p50_unit != null) {
          if (stat[0] !== fmtInt(f.sample_count)) note(where0, `stat n ${stat[0]} vs ${f.sample_count}`);
          if (stat[2] !== f.p50_unit.toFixed(1)) note(where0, `stat p50 ${stat[2]} vs ${f.p50_unit}`);
          if (stat[3] !== fmtInt(f.p50_total)) note(where0, `stat total ${stat[3]} vs ${f.p50_total}`);
        }
        if ((await page.title()).indexOf(district) !== 0) note(where0, 'title');
      } else {
        const text = (await page.textContent('.auto-text')).trim();
        if (text !== sum.text) note(where0, 'city summary != static JSON');
      }
      for (const tab of tabs) {
        const sel = district ? `[data-dtab="${tab}"]` : `[data-citytab="${tab}"]`;
        await page.click(sel); await page.waitForTimeout(250);
        await page.waitForLoadState('networkidle');
        const where = `${slug}@${w}/${tab}`;
        checks++;
        const r = await inspect(page);
        if (r.overflowX > 0) note(where, `page overflowX ${r.overflowX}`);
        if (r.offscreen.length) note(where, `offscreen ${r.offscreen.join(' ')}`);
        if (r.truncated.length) note(where, `truncated ${r.truncated.join(' ')}`);
        if (r.innerScroll.length) note(where, `inner h-scroll ${r.innerScroll.join(' ')}`);
        const body = await page.textContent(district ? '#districtView' : '#cityView');
        if (BAD.test(body)) note(where, `bad token: ${(body.match(new RegExp('.{0,30}(' + BAD.source + ').{0,30}')) || [''])[0]}`);
        if (district) {
          const tn = (await page.textContent('.tab-note').catch(() => '')).trim();
          if (!tn || tn.length < 8) note(where, 'empty tab-note');
          const active = await page.getAttribute(sel, 'aria-selected');
          if (active !== 'true') note(where, 'tab not selected');
          if (!new URL(page.url()).pathname.endsWith(`/district/${slug}/`)) note(where, 'url changed');
        }
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${slug}-${w}-${tab}.png`), fullPage: true });
      }
      if (errs.length) note(where0, 'errors: ' + [...new Set(errs)].join(' | '));
      await ctx.close();
    }
    process.stdout.write(`${slug} `);
  }
  console.log(`\nQA checks=${checks} issues=${issues.length}`);
  issues.forEach(i => console.log(' -', i));
  await browser.close();
  process.exit(issues.length ? 1 : 0);
})();
