// WP1：產生 data/summaries/<slug>_<market>_<window>.json（各市場最新完整月）
// 與前端共用 assets/summary.js，畫面上的摘要與此 JSON 逐字一致。
import { SLUGS, DISTRICTS, MARKETS, WINDOWS, Summary, readJSON, writeJSON, summaryContext } from './lib.mjs';

const data = readJSON('beido-market-data.json');
const population = readJSON('data/population.json');
const presale = Object.fromEntries(DISTRICTS.map(d => [d, readJSON(`data/presale_projects/${SLUGS[d]}.json`)]));
const index = { version: Summary.VERSION, generated_at: data.meta.updated_at, files: [] };

for (const market of MARKETS) {
  const month = data.markets[market].meta.complete_month;
  const snapshot = readJSON(`data/snapshots/${market}/${month}.json`);
  for (const window of WINDOWS) {
    for (const district of [null, ...DISTRICTS]) {
      const ctx = summaryContext({ market, district, window, month, data, snapshot,
        presaleFile: district ? presale[district] : undefined, population: district ? population : undefined });
      const out = Summary.build(ctx);
      const slug = district ? SLUGS[district] : 'city';
      const file = `${slug}_${market}_${window}.json`;
      writeJSON(`data/summaries/${file}`, { ...out, source: { snapshot: `data/snapshots/${market}/${month}.json`, data_updated: data.meta.updated_at } }, true);
      index.files.push({ file, district: district || '桃園市', market, window, month });
    }
  }
}
writeJSON('data/summaries/index.json', index, true);
console.log(`summaries: ${index.files.length} files`);
