// WP1 驗證：對「所有月份 × 13 區+全市 × 2 市場 × 3 期間」跑模板，
// 確認沒有 NaN / undefined / null / 待確認，並抽驗數字與 snapshot 一致。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, SLUGS, DISTRICTS, MARKETS, WINDOWS, Summary, readJSON, summaryContext } from './lib.mjs';

const data = readJSON('beido-market-data.json');
const population = readJSON('data/population.json');
const presale = Object.fromEntries(DISTRICTS.map(d => [d, readJSON(`data/presale_projects/${SLUGS[d]}.json`)]));
const BAD = /NaN|undefined|null|Infinity|待確認|\[object/;
let runs = 0, fails = 0, warns = 0;
const fail = (msg) => { fails++; if (fails < 30) console.error('FAIL', msg); };

for (const market of MARKETS) {
  for (const month of data.markets[market].meta.available_months) {
    const f = path.join(ROOT, `data/snapshots/${market}/${month}.json`);
    if (!fs.existsSync(f)) continue;
    const snapshot = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const window of WINDOWS) for (const district of [null, ...DISTRICTS]) {
      const ctx = summaryContext({ market, district, window, month, data, snapshot,
        presaleFile: district ? presale[district] : undefined, population: district ? population : undefined });
      const out = Summary.build(ctx); runs++;
      const all = out.text + Object.values(out.notes).join('');
      if (BAD.test(all)) fail(`${market} ${month} ${district} ${window}: ${all}`);
      const t = ctx.trailing;
      if (t && t.sample_count && t.p50_unit_price != null) {
        if (!out.text.includes(`每坪 ${t.p50_unit_price.toFixed(1)} 萬元`)) fail(`p50 mismatch ${market} ${month} ${district}`);
        if (!out.text.includes(`共有 ${Math.round(t.sample_count).toLocaleString('en-US')} 筆`)) fail(`n mismatch ${market} ${month} ${district}`);
        const sum = ctx.series.reduce((a, x) => a + (x.sample_count || 0), 0);
        if (sum !== t.sample_count) fail(`series sum ${sum} != trailing ${t.sample_count} ${market} ${month} ${district} ${window}`);
      }
      // 預售建案彙整筆數 = snapshot 預售期間樣本
      if (market === 'presale' && district && t && ctx.projects) {
        const s = ctx.projects.reduce((a, p) => a + p.count, 0);
        if (s !== t.sample_count) {
          // 動態回補月份（backfilling）尚未歸戶到建案檔，只允許少於、且列為警告；前端會顯示清單合計與期間成交差異
          const st = data.markets.presale.meta.month_status || {};
          const { start } = Summary.windowRange(month, window);
          const touchesBackfill = Object.entries(st).some(([m, v]) => v !== 'complete' && m >= start && m <= month && m >= '2026-01');
          if (touchesBackfill && s < t.sample_count) warns++;
          else fail(`presale projects ${s} != trailing ${t.sample_count} ${month} ${district} ${window}`);
        }
      }
    }
  }
}
// WP7：預售建案清單不可出現同案異名（字形/空白/大小寫/「建設」正規化後重複）
const GLYPH = { '悦': '悅', '鋭': '銳', '画': '畫', '双': '雙', '滙': '匯', '絵': '繪', '臺': '台' };
const normName = x => x.normalize('NFKC').replace(/[悦鋭画双滙絵臺]/g, c => GLYPH[c]).replace(/\s+/g, '').replace(/建設/g, '').toLowerCase();
let dupChecks = 0;
for (const d of DISTRICTS) for (const window of WINDOWS) for (const month of ['2024-04', '2025-04', data.markets.presale.meta.complete_month]) {
  const list = Summary.aggregateProjects(presale[d], month, window); dupChecks++;
  const seen = new Map();
  for (const p of list) { const k = normName(p.name); if (seen.has(k)) fail(`dup project name ${d} ${month} ${window}: ${seen.get(k)} / ${p.name}`); seen.set(k, p.name); }
}
// 靜態檔與即時計算一致
const idx = readJSON('data/summaries/index.json');
for (const f of idx.files) {
  const j = readJSON(`data/summaries/${f.file}`);
  const district = f.district === '桃園市' ? null : f.district;
  const snapshot = readJSON(`data/snapshots/${f.market}/${f.month}.json`);
  const out = Summary.build(summaryContext({ market: f.market, district, window: f.window, month: f.month, data, snapshot,
    presaleFile: district ? presale[district] : undefined, population: district ? population : undefined }));
  if (out.text !== j.text) fail(`static mismatch ${f.file}`);
}
console.log(`summary runs=${runs} static=${idx.files.length} dup-name-checks=${dupChecks} fails=${fails} backfill-warnings=${warns}`);
process.exit(fails ? 1 : 0);
