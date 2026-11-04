// WP4：SEO / 結構化資料
// 由 index.html 產生 13 個行政區靜態入口頁 district/<slug>/index.html，並更新首頁 SEO 區塊：
//   <title>/description/canonical/OG + JSON-LD（Dataset + FAQPage + BreadcrumbList）
//   FAQ 答案＝data/summaries（與畫面自動摘要同一段文字），並以 <noscript> 可見呈現
// 另輸出 sitemap.xml、robots.txt。資料更新後重跑：node tools/build-all.mjs
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, SLUGS, DISTRICTS, SITE, readJSON, writeText } from './lib.mjs';

const DEFAULT_WINDOW = 24;   // 與前端預設期間一致
const data = readJSON('beido-market-data.json');
const population = readJSON('data/population.json');
const template = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const updated = String(data.meta.updated_at).slice(0, 10);
const months = [...data.markets.presale.meta.available_months, ...data.markets.resale.meta.available_months].sort();
const coverage = `${months[0]}/${months[months.length - 1]}`;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const jsonld = obj => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;
const summary = (slug, market, w = DEFAULT_WINDOW) => readJSON(`data/summaries/${slug}_${market}_${w}.json`);

const ORG = { '@type': 'Organization', name: '貝多不動產', url: SITE };
const SOURCE = {
  '@type': 'Dataset', name: '內政部不動產交易實價查詢服務網（實價登錄）', url: 'https://lvr.land.moi.gov.tw/',
  publisher: { '@type': 'GovernmentOrganization', name: '中華民國內政部' }
};

function replaceBlock(html, name, content) {
  const re = new RegExp(`<!--${name}:BEGIN-->[\\s\\S]*?<!--${name}:END-->`);
  if (!re.test(html)) throw new Error(`marker ${name} missing`);
  return html.replace(re, `<!--${name}:BEGIN-->${content}<!--${name}:END-->`);
}

function dataset({ name, description, url, place, slug }) {
  const files = ['resale', 'presale'].map(m => ({
    '@type': 'DataDownload', encodingFormat: 'application/json',
    name: `${place}${m === 'resale' ? '中古屋' : '預售屋'}近 ${DEFAULT_WINDOW} 個月行情摘要`,
    contentUrl: `${SITE}data/summaries/${slug}_${m}_${DEFAULT_WINDOW}.json`
  }));
  return {
    '@type': 'Dataset', name, description, url,
    keywords: [`${place}房價`, `${place}實價登錄`, `${place}預售屋`, `${place}中古屋`, '桃園房價', '成交行情'],
    creator: ORG, publisher: ORG, isAccessibleForFree: true, inLanguage: 'zh-Hant-TW',
    dateModified: updated, temporalCoverage: coverage,
    spatialCoverage: {
      '@type': 'Place', name: place === '桃園市' ? '臺灣桃園市' : `桃園市${place}`,
      address: { '@type': 'PostalAddress', addressCountry: 'TW', addressRegion: '桃園市', ...(place === '桃園市' ? {} : { addressLocality: place }) }
    },
    isBasedOn: SOURCE,
    measurementTechnique: '實價登錄成交樣本之中位數與 P25／P75 分位；單價已扣除車位，預售排除解約，中古排除交屋回補、特殊交易與非住宅',
    variableMeasured: ['成交件數', '成交單價中位數（萬元／坪）', '成交總價中位數（萬元）', '單價 P25／P75', '建物坪數中位數', '建物型態組成', '樓層組成', '戶籍人口與戶數'],
    distribution: files
  };
}

function breadcrumb(items) {
  return { '@type': 'BreadcrumbList', itemListElement: items.map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, item })) };
}

function faq(qas) {
  return { '@type': 'FAQPage', mainEntity: qas.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) };
}

function districtQAs(d, slug) {
  const re = summary(slug, 'resale'), pre = summary(slug, 'presale');
  const qas = [];
  for (const s of [re, pre]) if (s.figures && s.figures.p50_unit != null) qas.push([s.question, s.text]);
  const vsText = [re, pre].filter(s => s.figures && s.figures.versus_city != null)
    .map(s => `近 ${DEFAULT_WINDOW} 個月${s.market_label}中位單價 ${s.figures.p50_unit.toFixed(1)} 萬／坪，${s.figures.versus_city === 0 ? '與全市同期持平' : `${s.figures.versus_city > 0 ? '高於' : '低於'}桃園市同期 ${Math.abs(s.figures.versus_city).toFixed(1)}%`}。`).join('');
  if (vsText) qas.push([`${d}房價和桃園市比起來高還是低？`, vsText]);
  if (pre.notes.projects && pre.figures.p50_unit != null) qas.push([`${d}近 ${DEFAULT_WINDOW} 個月哪個預售建案成交最多？`, pre.notes.projects]);
  if (re.notes.population) qas.push([`${d}人口有多少？`, re.notes.population.replace(/；近.*$/, '。')]);
  return qas;
}

function noscript(title, qas) {
  return `\n    <noscript><section class="ssr"><h2>${esc(title)}</h2>${qas.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join('')}<p>資料來源：內政部實價登錄公開資料，貝多不動產整理；資料更新 ${updated}。</p></section></noscript>\n    `;
}

function seoHead({ title, description, url, graph }) {
  return `
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${url}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="貝多不動產">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${url}">
  <meta property="og:locale" content="zh_TW">
  ${jsonld({ '@context': 'https://schema.org', '@graph': graph })}
  `;
}

// ---- 首頁（全市）----
{
  const url = SITE;
  const re = summary('city', 'resale'), pre = summary('city', 'presale');
  const qas = [[re.question, re.text], [pre.question, pre.text]];
  const description = '以內政部實價登錄資料查看桃園市及 13 行政區的預售屋與中古屋成交行情：中位單價、成交量、主力價位、建案與人口。';
  const graph = [
    dataset({ name: '桃園市預售屋與中古屋實價登錄成交行情', description: `${description}${re.text}`, url, place: '桃園市', slug: 'city' }),
    breadcrumb([['桃園市房價行情', url]]),
    faq(qas)
  ];
  let html = replaceBlock(template, 'SEO', seoHead({ title: '桃園房價行情｜預售屋・中古屋實價登錄｜貝多不動產', description, url, graph }));
  html = replaceBlock(html, 'SSR', noscript('桃園市房價行情摘要', qas));
  html = replaceBlock(html, 'BOOT', '');
  fs.writeFileSync(path.join(ROOT, 'index.html'), html);
}

// ---- 13 個行政區 ----
const base = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
for (const d of DISTRICTS) {
  const slug = SLUGS[d];
  const url = `${SITE}district/${slug}/`;
  const qas = districtQAs(d, slug);
  const re = summary(slug, 'resale');
  const pop = population.districts[d];
  const lead = re.figures && re.figures.p50_unit != null
    ? `近 ${DEFAULT_WINDOW} 個月中古屋中位單價 ${re.figures.p50_unit.toFixed(1)} 萬／坪。` : '';
  const description = `${d}房價行情：以內政部實價登錄整理${d}預售屋與中古屋的中位單價、成交量、主力價位 P25–P75、預售建案與人口。${lead}`;
  const graph = [
    dataset({ name: `桃園市${d}預售屋與中古屋實價登錄成交行情`, description: `${description}${qas.length ? qas[0][1] : ''}`, url, place: d, slug }),
    breadcrumb([['桃園市房價行情', SITE], [`${d}房價行情`, url]]),
    ...(qas.length ? [faq(qas)] : [])
  ];
  let html = replaceBlock(base, 'SEO', seoHead({ title: `${d}房價行情｜預售屋・中古屋實價登錄｜貝多不動產`, description, url, graph }));
  html = replaceBlock(html, 'SSR', noscript(`${d}房價行情摘要${pop ? `（人口 ${pop.pop.toLocaleString('en-US')} 人）` : ''}`, qas));
  html = replaceBlock(html, 'BOOT', `<script>window.BEIDO_BASE = '../../';</script>`);
  html = html.replace(/(href|src)="assets\//g, '$1="../../assets/');
  html = html.replace(/<p class="eyebrow" id="heroEyebrow">[^<]*<\/p>/, `<p class="eyebrow" id="heroEyebrow">Taoyuan · ${slug.toUpperCase()} District</p>`);
  html = html.replace(/<h1 id="heroTitle">[\s\S]*?<\/h1>/, `<h1 id="heroTitle">${d}<em>房價行情</em></h1>`);
  html = html.replace(/<p class="hero-lede" id="heroLede">[^<]*<\/p>/, `<p class="hero-lede" id="heroLede">${d}預售屋與中古屋的實價登錄行情：均價、成交量、主力價位、建案與人口，一頁看懂。</p>`);
  html = html.replace('<body>', '<body data-view="district">');
  writeText(`district/${slug}/index.html`, html);
}

// ---- sitemap / robots ----
const urls = [SITE, ...DISTRICTS.map(d => `${SITE}district/${SLUGS[d]}/`)];
writeText('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${u}</loc><lastmod>${updated}</lastmod><changefreq>weekly</changefreq></url>`).join('\n')}\n</urlset>\n`);
writeText('robots.txt', `User-agent: *\nAllow: /\nDisallow: /tools/\n\nSitemap: ${SITE}sitemap.xml\n`);
console.log(`pages: index + ${DISTRICTS.length} districts, sitemap ${urls.length} urls`);
