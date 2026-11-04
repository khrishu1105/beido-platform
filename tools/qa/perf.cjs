// 效能量測：每頁請求數、傳輸體積（未壓縮 body bytes）、DOMContentLoaded / 首次內容可見（#app 顯示）時間
// 用法：node tools/qa/perf.cjs [baseUrl] [out.json]
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.argv[2] || 'http://localhost:8765/';
const OUT = process.argv[3];
const pages = [['city', ''], ['zhongli', 'district/zhongli/'], ['fuxing', 'district/fuxing/'], ['zhongli·projects', 'district/zhongli/?dtab=projects'], ['zhongli·people', 'district/zhongli/?dtab=people']];
(async () => {
  const b = await chromium.launch(); const res = {};
  for (const [name, path] of pages) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const p = await ctx.newPage();
    await p.addInitScript(() => sessionStorage.setItem('beido-intro-played', '1'));
    const reqs = []; p.on('response', async r => { try { const body = await r.body(); reqs.push({ url: r.url().replace(BASE, ''), bytes: body.length }); } catch (_) {} });
    const t0 = Date.now();
    await p.goto(BASE + path, { waitUntil: 'domcontentloaded' }); const dcl = Date.now() - t0;
    await p.waitForSelector('#app:not([hidden])'); const ready = Date.now() - t0;
    await p.waitForLoadState('networkidle');
    const local = reqs.filter(r => !/^https?:/.test(r.url));
    const json = local.filter(r => /\.json/.test(r.url));
    res[name] = { requests: local.length, total_kb: +(local.reduce((a, r) => a + r.bytes, 0) / 1024).toFixed(1), json_kb: +(json.reduce((a, r) => a + r.bytes, 0) / 1024).toFixed(1), dcl_ms: dcl, ready_ms: ready, files: local.map(r => `${r.url.split('?')[0]} ${(r.bytes / 1024).toFixed(1)}KB`) };
    console.log(name, JSON.stringify({ ...res[name], files: undefined }));
    await ctx.close();
  }
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
  await b.close();
})();
