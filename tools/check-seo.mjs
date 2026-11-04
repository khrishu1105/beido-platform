// WP4 驗證：解析每頁 JSON-LD，依 Google 結構化資料文件檢查必填／建議欄位，
// 並確認 FAQ 答案文字在頁面 <noscript> 中可見（Google 要求 FAQ 內容須呈現在頁面上）。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, SLUGS, DISTRICTS, SITE } from './lib.mjs';

const pages = [['index.html', SITE], ...DISTRICTS.map(d => [`district/${SLUGS[d]}/index.html`, `${SITE}district/${SLUGS[d]}/`])];
let fails = 0;
const fail = (p, m) => { fails++; console.error(`FAIL ${p}: ${m}`); };
const decode = s => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

for (const [file, url] of pages) {
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  if (blocks.length !== 1) { fail(file, `expected 1 JSON-LD block, got ${blocks.length}`); continue; }
  let doc; try { doc = JSON.parse(blocks[0][1]); } catch (e) { fail(file, 'invalid JSON ' + e.message); continue; }
  const g = doc['@graph'] || [];
  const byType = t => g.find(x => x['@type'] === t);
  if (doc['@context'] !== 'https://schema.org') fail(file, '@context');
  if (!html.includes(`<link rel="canonical" href="${url}">`)) fail(file, 'canonical');

  const ds = byType('Dataset');
  if (!ds) fail(file, 'Dataset missing');
  else {
    if (!ds.name || !ds.description) fail(file, 'Dataset name/description');
    if (ds.description.length < 50 || ds.description.length > 5000) fail(file, `Dataset description length ${ds.description.length}`);
    if (!/^\d{4}-\d{2}\/\d{4}-\d{2}$/.test(ds.temporalCoverage || '')) fail(file, 'temporalCoverage');
    if (!ds.spatialCoverage || ds.spatialCoverage['@type'] !== 'Place' || !ds.spatialCoverage.name) fail(file, 'spatialCoverage');
    if (!ds.isBasedOn || !/lvr\.land\.moi\.gov\.tw/.test(ds.isBasedOn.url || '') || !/內政部/.test(JSON.stringify(ds.isBasedOn))) fail(file, 'isBasedOn 內政部實價登錄');
    if (!ds.creator || !ds.creator.name) fail(file, 'creator');
    for (const dl of ds.distribution || []) {
      const local = dl.contentUrl.replace(SITE, '');
      if (!fs.existsSync(path.join(ROOT, local))) fail(file, `distribution missing ${local}`);
    }
  }
  const bc = byType('BreadcrumbList');
  if (!bc || !(bc.itemListElement || []).length) fail(file, 'BreadcrumbList');
  else bc.itemListElement.forEach((it, i) => {
    if (it.position !== i + 1 || !it.name || !/^https:\/\//.test(it.item || '')) fail(file, `breadcrumb item ${i}`);
  });
  if (bc && bc.itemListElement[bc.itemListElement.length - 1].item !== url) fail(file, 'breadcrumb last item != canonical');

  const fq = byType('FAQPage');
  if (!fq || !(fq.mainEntity || []).length) fail(file, 'FAQPage');
  else {
    const visible = decode((html.match(/<noscript><section class="ssr">[\s\S]*?<\/noscript>/) || [''])[0]);
    for (const q of fq.mainEntity) {
      if (q['@type'] !== 'Question' || !q.name || !q.acceptedAnswer || q.acceptedAnswer['@type'] !== 'Answer' || !q.acceptedAnswer.text) fail(file, 'FAQ shape');
      if (/NaN|undefined|null|待確認/.test(q.acceptedAnswer.text)) fail(file, `bad FAQ text: ${q.name}`);
      if (!visible.includes(q.name) || !visible.includes(q.acceptedAnswer.text)) fail(file, `FAQ not visible on page: ${q.name}`);
    }
  }
  console.log(`${file}: Dataset ✓ BreadcrumbList(${bc ? bc.itemListElement.length : 0}) FAQ(${fq ? fq.mainEntity.length : 0})`);
}
const sm = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
for (const [, url] of pages) if (!sm.includes(`<loc>${url}</loc>`)) fail('sitemap.xml', url);
console.log(`seo pages=${pages.length} fails=${fails}`);
process.exit(fails ? 1 : 0);
