'use strict';
/* 貝多不動產・桃園成交行情（純靜態：SQLite → JSON → GitHub Pages）
 * 行政區頁模組順序（對標行政區儀表板）：
 *   Hero + 雙市場 KPI → 篩選（行政區／市場／期間／單價·總價）→ 自動市場總結 → 四格統計
 *   → 逐筆成交 → 五分頁（行情總覽／成交趨勢／產品結構／預售建案／人口與所得）
 *   → 本區建案索引 → 全區磁磚牆＋地圖 → JSON-LD（靜態頁由 tools/build-pages.mjs 產生）
 */

// 站台根目錄：行政區靜態頁（/district/<slug>/）會先設定 window.BEIDO_BASE='../../'
const ROOT_URL = new URL(window.BEIDO_BASE || './', location.href).href;
const asset = rel => new URL(rel, ROOT_URL).href;
const DATA_URL = 'beido-market-data.json';

const SLUGS = {
  '中壢區':'zhongli', '八德區':'bade', '大園區':'dayuan', '大溪區':'daxi', '平鎮區':'pingzhen',
  '復興區':'fuxing', '新屋區':'xinwu', '桃園區':'taoyuan', '楊梅區':'yangmei', '蘆竹區':'luzhu',
  '觀音區':'guanyin', '龍潭區':'longtan', '龜山區':'guishan'
};
const SLUG_TO_DISTRICT = Object.fromEntries(Object.entries(SLUGS).map(([k, v]) => [v, k]));
const districtPositions = {
  '大園區':[30,17], '蘆竹區':[54,15], '龜山區':[77,22], '觀音區':[14,35],
  '中壢區':[39,35], '桃園區':[66,39], '新屋區':[13,57], '平鎮區':[39,54],
  '八德區':[66,58], '楊梅區':[25,74], '大溪區':[56,75], '龍潭區':[40,88], '復興區':[82,80]
};
const SAMPLE_MIN = BeidoSummary.SAMPLE_MIN;
const DTABS = [
  {k:'overview', t:'行情總覽'}, {k:'trend', t:'成交趨勢'}, {k:'structure', t:'產品結構'},
  {k:'projects', t:'預售建案'}, {k:'people', t:'人口與所得'}
];

let DATA = null, PROJECTS = null, POPULATION = null;
const PROJECT_CACHE = {};
let REDIRECT = {};
const SNAP = {};
const PRESALE = {};
const state = { market: 'presale', month: '', district: '', project: null, range: 24, rankBy: 'price', cityTab: 'rank', projectView: '', projectChip: 'all', projectRows: 50, metric: 'unit', dtab: 'overview', projSort: 'count' };

const fmt = new Intl.NumberFormat('zh-TW');
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const n = value => value == null ? '—' : fmt.format(Math.round(value));
const one = value => value == null ? '—' : Number(value).toFixed(1);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const monthLabel = value => value ? `${value.slice(0,4)} 年 ${Number(value.slice(5))} 月` : '—';
const MARKET_SHORT = { presale: '預售', resale: '中古' };
const PENDING_NAME = name => esc(String(name).replace(/\?/g, '□'));

function changeMarkup(value, label = '較上月') {
  if (value == null) return `<span class="change flat">樣本不足，暫不比較</span>`;
  const cls = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
  const arrow = value > 0 ? '↑' : value < 0 ? '↓' : '→';
  return `<span class="change ${cls}">${arrow} ${Math.abs(value).toFixed(1)}% ${label}</span>`;
}

function kpi(label, value, unit, meta) {
  return `<article class="kpi"><div class="kpi-label">${label}</div><div class="kpi-value">${value}<small>${unit}</small></div><div class="kpi-meta">${meta}</div></article>`;
}
// 非完整月份不顯示可能誤導的月增/年增，改中性說明
function changeOrHold(value, label, market = state.market, month = state.month) {
  return isIncomplete(month, market) ? `<span class="change flat">資料未完整，暫不比較</span>` : changeMarkup(value, label);
}
function preparing(title, body) {
  return `<div class="preparing"><span class="preparing-tag">資料準備中</span><b>${title}</b><p>${body}</p></div>`;
}

// ---------- 資料載入 ----------
function snapKey(market = state.market, month = state.month) { return market + '|' + month; }
function emptyCity() { return {city:{sample_count:0, median_unit_price:null, median_total_price:null, district_ranking:[], trailing_12:null, trailing_24:null, trailing_36:null}, districts:{}}; }
function getSnapshot(market = state.market, month = state.month) { return SNAP[snapKey(market, month)] || emptyCity(); }
function hasSnapshot(market, month) { return Boolean(SNAP[snapKey(market, month)]); }
async function ensureSnap(market = state.market, month = state.month) {
  const key = snapKey(market, month);
  if (SNAP[key]) return SNAP[key];
  if (!DATA.markets[market].meta.available_months.includes(month)) { SNAP[key] = emptyCity(); return SNAP[key]; }
  try {
    const response = await fetch(asset(`data/snapshots/${market}/${month}.json`), {cache:'no-store'});
    SNAP[key] = response.ok ? await response.json() : emptyCity();
  } catch (_) { SNAP[key] = emptyCity(); }
  return SNAP[key];
}
const ensureSnapshot = () => ensureSnap();
async function ensurePresale(district) {
  if (!district || PRESALE[district]) return;
  try {
    const response = await fetch(asset(`data/presale_projects/${SLUGS[district]}.json`), {cache:'no-store'});
    PRESALE[district] = response.ok ? await response.json() : {district, projects:[]};
  } catch (_) { PRESALE[district] = {district, projects:[]}; }
}
const otherMarket = () => state.market === 'presale' ? 'resale' : 'presale';
function marketMonth(market) {
  if (market === state.market) return state.month;
  const meta = DATA.markets[market].meta;
  return meta.available_months.includes(state.month) ? state.month : meta.complete_month;
}
const yearAgo = month => BeidoSummary.addMonths(month, -12);
async function ensureViewData() {
  const tasks = [ensureSnap()];
  if (state.district) {
    tasks.push(ensureSnap(otherMarket(), marketMonth(otherMarket())), ensurePresale(state.district));
    if (state.dtab === 'people') tasks.push(ensureSnap(state.market, yearAgo(state.month)));
  } else if (state.cityTab === 'people') tasks.push(ensureSnap(state.market, yearAgo(state.month)));
  await Promise.all(tasks);
}

function marketLabel(market = state.market) { return DATA.markets[market].label; }
function marketMeta(market = state.market) { return DATA.markets[market].meta || DATA.meta; }
// 月份狀態改用 coverage 六種 enum：complete / local_source_gap / official_pending / mixed / backfilling / unpublished
function monthStatus(value = state.month, market = state.market) {
  const ms = marketMeta(market).month_status;
  if (ms && ms[value]) return ms[value];
  const meta = marketMeta(market);   // 後備(舊資料格式)
  if ((meta.coverage_gap_months || meta.incomplete_months || []).includes(value)) return 'local_source_gap';
  if ((meta.not_published_months || []).includes(value)) return 'official_pending';
  return 'complete';
}
function isIncomplete(value = state.month, market = state.market) { return monthStatus(value, market) !== 'complete'; }
function isUnavailable(value = state.month, market = state.market) { return ['official_pending','unpublished'].includes(monthStatus(value, market)); }
function sampleDisplay(value) { return (isUnavailable() || !value) ? '—' : n(value); }
function statusLabel(value = state.month, market = state.market) {
  return ({complete:'資料已覆蓋', local_source_gap:'本站來源缺口', official_pending:'官方陸續登錄中', mixed:'部分缺口·部分待發布', backfilling:'動態回補·待對帳', unpublished:'尚未發布'})[monthStatus(value, market)] || '資料已覆蓋';
}
function statusSentence() {
  const status = monthStatus();
  if (status === 'local_source_gap') return '<span class="status-gap">本月官方已可查，但本站尚未回補這段來源，數字不完整、暫不與完整月份比較</span>';
  if (status === 'official_pending') return '<span class="status-gap">官方依每旬時程陸續登錄中，本月尚未完整發布，0 筆不代表沒有成交</span>';
  if (status === 'mixed') return '<span class="status-gap">本月部分窗口本站缺口、部分官方尚未發布，數字不完整</span>';
  if (status === 'backfilling') return '<span class="status-live">本月以官方動態查詢回補，數字接近完整；待官方季度封存發布後再權威對帳</span>';
  return '本月為完整登錄觀察期';
}

// 依「日曆月」取期間（序列可能缺月，不可用索引切片）
function selectedSeries(district = '') {
  const source = district
    ? DATA.markets[state.market].series.districts[district] || []
    : DATA.markets[state.market].series.city;
  const { start } = BeidoSummary.windowRange(state.month, state.range);
  return source.filter(item => item.month >= start && item.month <= state.month);
}

// ---------- 圖表 ----------
function niceStep(span, ticks = 4) {
  const raw = Math.max(span, 1e-6) / ticks, p = Math.pow(10, Math.floor(Math.log10(raw))), r = raw / p;
  return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * p;
}
function lineChart(series, label, metric = state.metric) {
  if (!series.length) return `<div class="empty-state"><strong>尚無趨勢資料</strong>請改選其他月份。</div>`;
  const key = metric === 'total' ? 'median_total_price' : 'median_unit_price';
  const unit = metric === 'total' ? '萬元' : '萬／坪';
  const valFmt = metric === 'total' ? n : one;
  const width = 920, height = 340, left = 58, right = 64, top = 28, bottom = 56;
  const innerW = width - left - right, innerH = height - top - bottom;
  const prices = series.map(item => item[key]).filter(value => value != null);
  const volumes = series.map(item => item.sample_count || 0);
  if (!prices.length) return `<div class="empty-state"><strong>這段期間沒有足夠的樣本</strong>仍可切換其他月份或返回全市。</div>`;
  const lo = Math.min(...prices), hi = Math.max(...prices);
  const step = niceStep((hi - lo) || hi * 0.1 || 1);
  const minPrice = Math.max(0, Math.floor((lo - step * 0.5) / step) * step);
  const maxPrice = Math.ceil((hi + step * 0.5) / step) * step;
  const priceH = innerH * 0.58;
  const volBottom = top + innerH, volTop = top + innerH * 0.70, volH = volBottom - volTop;
  const niceCeil = x => { if (x <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(x))); const r = x / p; const s = r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10; return s * p; };
  const volMax = niceCeil(Math.max(...volumes, 1));
  const xstep = series.length > 1 ? innerW / (series.length - 1) : innerW;
  const x = index => left + (series.length > 1 ? index * xstep : innerW / 2);
  const yPrice = value => top + (maxPrice - value) / Math.max(1e-6, maxPrice - minPrice) * priceH;
  const yVolume = value => volBottom - value / volMax * volH;
  const barWidth = Math.max(5, Math.min(24, innerW / Math.max(series.length, 1) * .55));
  const points = series.map((item, index) => item[key] == null ? null : [x(index), yPrice(item[key]), item]).filter(Boolean);
  const line = points.map((point, index) => `${index ? 'L' : 'M'}${point[0].toFixed(1)},${point[1].toFixed(1)}`).join(' ');
  const grid = [0, .25, .5, .75, 1].map(fraction => {
    const y = top + fraction * priceH;
    const price = maxPrice - fraction * (maxPrice - minPrice);
    return `<line class="chart-grid-line" x1="${left}" x2="${width-right}" y1="${y}" y2="${y}"/><text class="chart-axis-label" x="${left-10}" y="${y+3}" text-anchor="end">${metric==='total'?n(price):price.toFixed(step % 1 ? 1 : 0)}</text>`;
  }).join('');
  const volGrid = [0, .5, 1].map(fraction => {
    const vol = volMax * fraction;
    const y = yVolume(vol);
    return `<line class="chart-grid-line" x1="${left}" x2="${width-right}" y1="${y}" y2="${y}"/><text class="chart-axis-label" x="${width-right+9}" y="${y+3}" text-anchor="start">${n(vol)}</text>`;
  }).join('');
  const bars = series.map((item, index) => {
    const y = yVolume(item.sample_count || 0);
    const incomplete = monthStatus(item.month) !== 'complete' ? ' incomplete' : '';
    return `<rect class="chart-volume${incomplete}" x="${x(index)-barWidth/2}" y="${y}" width="${barWidth}" height="${volBottom-y}"><title>${item.month}｜${item.sample_count} 件</title></rect>`;
  }).join('');
  const dots = points.map(point => `<circle class="chart-point${point[2].month===state.month?' selected':''}" cx="${point[0]}" cy="${point[1]}" r="${point[2].month===state.month?5:3}"><title>${point[2].month}｜${valFmt(point[2][key])} ${unit}</title></circle>`).join('');
  const labelEvery = series.length <= 12 ? 1 : series.length <= 24 ? 3 : 4;
  const labels = series.map((item, index) => index % labelEvery === 0 || index === series.length - 1
    ? `<text class="chart-axis-label" x="${x(index)}" y="${height-24}" text-anchor="middle">${item.month.slice(2).replace('-', '/')}</text>` : '').join('');
  const selectedX = x(series.length - 1);
  const rows = series.map(item => `<tr><td>${item.month}</td><td>${n(item.sample_count)}</td><td>${one(item.median_unit_price)}</td><td>${n(item.median_total_price)}</td></tr>`).join('');
  return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}的成交量與${metric==='total'?'總價':'單價'}趨勢圖">
    ${grid}${volGrid}<text class="chart-axis-label" x="18" y="${top+priceH/2}" transform="rotate(-90 18 ${top+priceH/2})">${unit}</text><text class="chart-axis-label" x="${width-13}" y="${(volTop+volBottom)/2}" transform="rotate(-90 ${width-13} ${(volTop+volBottom)/2})">件數</text>
    ${bars}<line class="chart-selected-line" x1="${selectedX}" x2="${selectedX}" y1="${top}" y2="${volBottom}"/>
    <path class="chart-line" d="${line}"/>${dots}${labels}
  </svg><div class="chart-legend"><span class="legend-key">${metric==='total'?'總價':'單價'}中位數（左軸）</span><span class="legend-key volume">成交件數（右軸）</span><span>虛線柱＝資料回補中</span></div>
  <details class="chart-table"><summary>查看圖表數據表</summary><table><thead><tr><th>月份</th><th>成交件數</th><th>中位單價</th><th>中位總價</th></tr></thead><tbody>${rows}</tbody></table></details>`;
}

function chartPanel(title, subtitle, district = '') {
  const ranges = [12,24,36].map(value => `<button type="button" data-range="${value}" class="${state.range===value?'is-active':''}">${value}M</button>`).join('');
  return `<div class="data-panel"><div class="panel-head"><div><h3>${title}</h3><p>${subtitle}</p></div><div class="range-switch" aria-label="趨勢期間">${ranges}</div></div><div class="chart-wrap">${lineChart(selectedSeries(district), title)}</div></div>`;
}

// ---------- 全市 ----------
function cityInsight(city) {
  if (monthStatus() === 'local_source_gap') return `${monthLabel(state.month)}官方已可查詢，但本站尚未回補這段來源批次；畫面保留月份位置，但不把不完整資料當成完整量能。`;
  if (monthStatus() === 'official_pending' || monthStatus() === 'unpublished') return `${marketLabel()}官方依每旬時程陸續登錄；${monthLabel(state.month)}尚未完整發布，0 筆不可解讀為沒有成交。`;
  if (monthStatus() === 'mixed') return `${monthLabel(state.month)}部分窗口本站缺口、部分官方尚未發布，本月數字僅供參考、不與完整月份比較。`;
  const ranking = city.district_ranking || [];
  if (!ranking.length) return '這個月份尚無足夠的行政區成交樣本。';
  const top = ranking[0];
  const active = ranking.filter(item => item.sample_count >= SAMPLE_MIN);
  const hot = [...active].sort((a,b) => b.sample_count-a.sample_count)[0] || top;
  const movement = city.year_over_year == null ? '目前樣本仍不足以做年比較' : `較去年同期${city.year_over_year>=0?'增加':'減少'} ${Math.abs(city.year_over_year).toFixed(1)}%`;
  return `${monthLabel(state.month)}，${marketLabel()}單價中位數為 <strong>${one(city.median_unit_price)} 萬／坪</strong>，${movement}；${hot.district}以 ${n(hot.sample_count)} 件成為本月交易最集中的行政區。`;
}

function rankingPanel(city) {
  const items = [...(city.district_ranking || [])];
  items.sort(state.rankBy === 'volume'
    ? (a,b) => b.sample_count-a.sample_count
    : (a,b) => (b.median_unit_price||0)-(a.median_unit_price||0));
  const maximum = Math.max(...items.map(item => state.rankBy === 'volume' ? item.sample_count : item.median_unit_price || 0), 1);
  const rows = items.map((item,index) => {
    const value = state.rankBy === 'volume' ? item.sample_count : item.median_unit_price;
    return `<button class="rank-row linked-district" data-district="${item.district}" type="button"><span class="rank-no">${String(index+1).padStart(2,'0')}</span><span class="rank-main"><span class="rank-name">${item.district}</span><span class="rank-track"><span class="rank-fill" style="display:block;width:${Math.max(2,value/maximum*100)}%"></span></span></span><span class="rank-value">${state.rankBy==='volume'?n(value):one(value)}<small>${state.rankBy==='volume'?'件':'萬／坪'}</small></span></button>`;
  }).join('');
  return `<div class="data-panel"><div class="panel-head"><div><h3>行政區排行</h3><p>${monthLabel(state.month)}・點擊進入區域分析</p></div><div class="rank-switch"><button type="button" data-rank="price" class="${state.rankBy==='price'?'is-active':''}">單價</button><button type="button" data-rank="volume" class="${state.rankBy==='volume'?'is-active':''}">量能</button></div></div><div class="ranking">${rows || '<div class="empty-state">本月尚無排行資料</div>'}</div></div>`;
}

function districtMap(city) {
  const lookup = Object.fromEntries((city.district_ranking || []).map(item => [item.district,item]));
  const maxCount = Math.max(...Object.values(lookup).map(item => item.sample_count), 1);
  const nodes = DATA.meta.districts.filter(d=>d).map(district => {
    const item = lookup[district] || {sample_count:0,median_unit_price:null};
    const pos = districtPositions[district] || [50,50];
    const size = 62 + Math.sqrt(item.sample_count/maxCount)*46;
    const current = district === state.district ? ' is-current' : '';
    return `<button type="button" class="district-node linked-district${current}" data-district="${district}" style="--x:${pos[0]}%;--y:${pos[1]}%;--size:${size}px" aria-label="查看${district}行情"><b>${district.replace('區','')}</b><small>${item.sample_count?n(item.sample_count)+' 件':'無成交'}</small></button>`;
  }).join('');
  return `<div class="district-stage" aria-label="桃園行政區相對位置索引">${nodes}</div><div class="map-disclaimer">圓點大小代表本月成交量・相對位置索引，非行政界線地圖・點圓點進入該區分析</div>`;
}

function districtGrid(city) {
  const lookup = Object.fromEntries((city.district_ranking || []).map(item => [item.district,item]));
  const ordered = [...DATA.meta.districts].filter(d=>d).sort((a,b)=>(lookup[b]?.sample_count||0)-(lookup[a]?.sample_count||0));
  const list = ordered.map(district => {
    const item = lookup[district] || {sample_count:0,median_unit_price:null};
    return `<button type="button" class="linked-district" data-district="${district}"><b>${district}</b><span>${one(item.median_unit_price)} 萬</span><small>${n(item.sample_count)} 件</small></button>`;
  }).join('');
  return `<div class="district-list wide">${list}</div>`;
}

function cityTransactions() {
  const snap = getSnapshot().districts || {};
  let rows = [];
  DATA.meta.districts.filter(d=>d).forEach(d => (snap[d]?.recent_transactions || []).forEach(t => rows.push({...t, district:d})));
  rows.sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  rows = rows.slice(0, 50);
  const body = rows.map(t => `<tr><td>${t.date||''}</td><td><button type="button" class="tx-dist linked-district" data-district="${t.district}">${t.district}</button></td><td>${esc(t.project||'—')}</td><td>${esc(t.type||'')}</td><td class="num">${one(t.unit_price)}</td><td class="num">${n(t.total_price)}</td><td class="num">${one(t.ping)}</td></tr>`).join('');
  return `<div class="data-panel"><div class="panel-head"><div><h3>全市最新成交</h3><p>${marketLabel()}・${monthLabel(state.month)}・彙整各區最新登錄，取最近 50 筆</p></div></div><div class="tx-scroll"><table class="tx-table"><thead><tr><th>登錄日</th><th>行政區</th><th>建案／社區</th><th>型態</th><th>單價</th><th>總價</th><th>坪數</th></tr></thead><tbody>${body || '<tr><td colspan="7">本月尚無成交資料</td></tr>'}</tbody></table></div><p class="tx-note">點行政區可看該區完整逐筆與各建案生命週期。</p></div>`;
}

function summaryFor(district, market = state.market, month = marketMonth(market)) {
  return BeidoSummary.build(BeidoSummary.context({
    market, district: district || null, window: state.range, month, data: DATA,
    snapshot: getSnapshot(market, month),
    presaleFile: district ? PRESALE[district] : undefined,
    population: district ? POPULATION : undefined
  }));
}
function summaryBlock(s, kicker) {
  return `<section class="auto-summary" aria-label="自動市場總結"><p class="section-kicker">${kicker}</p><h2 class="auto-q">${esc(s.question)}</h2><p class="auto-text">${esc(s.text)}</p><p class="auto-foot">依實價登錄期間統計以固定規則產生・數字與下方圖表同源・非個別物件估價</p></section>`;
}

function renderCity() {
  const city = getSnapshot().city;
  const incompleteText = statusSentence();
  const s = summaryFor(null);
  $('#cityView').innerHTML = `
    <section class="section" aria-labelledby="cityTitle">
      <div class="section-heading-row"><div><p class="section-kicker">Market Snapshot / ${state.month}</p><h2 id="cityTitle">桃園市成交快照</h2></div><p class="section-deck">${incompleteText}。單價採去車位後的中位數，避免少數極端交易扭曲市場中心。</p></div>
      <div class="kpi-grid">
        ${kpi('成交單價中位數', one(city.median_unit_price), '萬／坪', changeOrHold(city.year_over_year,'較去年同期'))}
        ${kpi(isIncomplete()?'目前資料筆數':'本月成交件數', sampleDisplay(city.sample_count), isUnavailable()?'':'件', isUnavailable()?'不可解讀為零成交':changeOrHold(city.month_over_month,'單價較上月'))}
        ${kpi('成交總價中位數', n(city.median_total_price), '萬元', `樣本 ${n(city.sample_count)} 件`)}
        ${kpi('近 12 月樣本', n((city.trailing_12||{}).sample_count), '件', `全市行情基礎`)}
      </div>
      <p class="editorial-read">${cityInsight(city)}</p>
    </section>
    <div class="section">${summaryBlock(s, `Auto Summary / 近 ${state.range} 月`)}</div>
    <section class="section city-nav-section" aria-label="成交行情入口">
      <div class="city-tabs">${cityTabMenu()}</div>
    </section>
    <section class="section" id="cityTabZone">${cityTabContent(city)}</section>`;
}

function cityTabMenu() {
  const tabs = [
    {k:'rank', n:'01', t:'房價排行', d:'各區單價高低與本月熱區'},
    {k:'grid', n:'02', t:'桃園13區房市', d:'逐區點入看價格、人口、建案'},
    {k:'map',  n:'03', t:'地圖看數據', d:'相對位置與成交熱度'},
    {k:'tx',   n:'04', t:'逐筆成交', d:'查詢最新完整實登'},
    {k:'people', n:'05', t:'人口×房價', d:'各區人口與房價年增交叉'}
  ];
  return tabs.map(x => `<button type="button" class="city-tab ${state.cityTab===x.k?'is-active':''}" data-citytab="${x.k}"><span class="ct-no">${x.n}</span><span class="ct-body"><b>${x.t}</b><small>${x.d}</small></span></button>`).join('');
}

function cityTabContent(city) {
  if (state.cityTab === 'grid')
    return `<div class="section-heading-row"><div><p class="section-kicker">Districts / 13</p><h2>桃園十三區，不是一個市場</h2></div><p class="section-deck">各區產品組成與熱度差異很大。點任一區，價格趨勢、分位、人口與成交明細會沿用目前市場與月份。</p></div>${districtGrid(city)}`;
  if (state.cityTab === 'map')
    return `<div class="section-heading-row"><div><p class="section-kicker">Map / 地圖看數據</p><h2>地圖上的成交熱度</h2></div><p class="section-deck">圓點大小代表本月成交量，點下去看該區完整分析。</p></div><div class="district-layout single">${districtMap(city)}</div>`;
  if (state.cityTab === 'tx')
    return `<div class="section-heading-row"><div><p class="section-kicker">Transactions / 逐筆成交</p><h2>全市最新逐筆成交</h2></div><p class="section-deck">彙整各區最新登錄，切換月份後停在你選定的觀察點。</p></div>${cityTransactions()}`;
  if (state.cityTab === 'people')
    return `<div class="section-heading-row"><div><p class="section-kicker">Population × Price</p><h2>人口規模與房價年增</h2></div><p class="section-deck">把居住需求的底盤（人口、戶數）與房價變化放在同一張表；房價年增以近 12 月中位單價對比前一年同期 12 月計算。</p></div>${crossPanel('')}`;
  return `<div class="section-heading-row"><div><p class="section-kicker">Ranking / 房價排行</p><h2>價格與量能，不分開看</h2></div><p class="section-deck">柱狀看成交量、折線看單價中位數；右側依單價或量能排出各區順位。</p></div><div class="analysis-grid">${chartPanel('桃園市月度走勢', `${marketLabel()}・截至 ${monthLabel(state.month)}`)}${rankingPanel(city)}</div>`;
}

// ---------- 人口 × 房價交叉（WP2） ----------
function crossRows() {
  const now = getSnapshot(), prev = getSnapshot(state.market, yearAgo(state.month));
  const havePrev = hasSnapshot(state.market, yearAgo(state.month));
  const pops = (POPULATION && POPULATION.districts) || {};
  return DATA.meta.districts.filter(d => d).map(d => {
    const t = (now.districts[d] || {}).trailing_12, tp = (prev.districts[d] || {}).trailing_12;
    const p = pops[d] || {};
    const yoy = havePrev && t && tp && isNum(t.p50_unit_price) && isNum(tp.p50_unit_price) && t.sample_count >= SAMPLE_MIN && tp.sample_count >= SAMPLE_MIN
      ? (t.p50_unit_price / tp.p50_unit_price - 1) * 100 : null;
    // 產品組成位移：任一型態占比變動 >15 個百分點，年增可能來自產品差異而非同質漲跌
    const share = (x, label) => ((x && x.type_mix || []).find(m => m.label === label) || {}).percentage || 0;
    const labels = new Set([...((t && t.type_mix) || []), ...((tp && tp.type_mix) || [])].map(m => m.label));
    const shift = yoy != null && [...labels].some(l => Math.abs(share(t, l) - share(tp, l)) > 15);
    return { d, pop: p.pop, hh: p.households, n12: t ? t.sample_count : 0, perK: t && p.pop ? t.sample_count / p.pop * 1000 : null, p50: t ? t.p50_unit_price : null, yoy, shift, ready: havePrev };
  });
}
function crossPanel(current) {
  const rows = crossRows();
  if (!rows.some(r => r.ready)) return `<div class="data-panel"><div class="empty-state"><strong>載入對照資料中…</strong></div></div>`;
  const maxYoy = Math.max(...rows.map(r => Math.abs(r.yoy || 0)), 1);
  const body = rows.sort((a, b) => (b.yoy ?? -999) - (a.yoy ?? -999)).map(r => {
    const bar = r.yoy == null ? '<span class="muted">樣本不足</span>'
      : `<span class="yoy-wrap"><span class="diverge"><span class="diverge-fill ${r.yoy >= 0 ? 'up' : 'down'}" style="width:${Math.abs(r.yoy)/maxYoy*50}%"></span></span><b class="change ${r.yoy>0?'up':r.yoy<0?'down':'flat'}">${r.yoy>0?'+':''}${r.yoy.toFixed(1)}%</b></span>${r.shift ? '<i class="tag warn" title="產品型態占比較去年變動超過 15 個百分點">組成變動大</i>' : ''}`;
    return `<tr class="${r.d===current?'is-current':''}"><td><button type="button" class="tx-dist linked-district" data-district="${r.d}">${r.d}</button></td><td class="num">${n(r.pop)}</td><td class="num">${n(r.hh)}</td><td class="num">${n(r.n12)}</td><td class="num">${r.perK==null?'—':r.perK.toFixed(1)}</td><td class="num">${one(r.p50)}</td><td class="yoy-cell">${bar}</td><td class="num muted">準備中</td></tr>`;
  }).join('');
  const period = (POPULATION && POPULATION.meta && POPULATION.meta.period) || '';
  return `<div class="data-panel"><div class="panel-head"><div><h3>人口年增 vs 房價年增</h3><p>${marketLabel()}・近 12 月（截至 ${monthLabel(state.month)}）vs 前一年同期・人口截至 ${period}</p></div></div>
    <div class="transaction-wrap"><table class="tx-table cross-table"><thead><tr><th>行政區</th><th>現住人口</th><th>戶數</th><th>近12月成交</th><th>每千人成交</th><th>中位單價</th><th>房價年增</th><th>人口年增</th></tr></thead><tbody>${body}</tbody></table></div>
    <p class="tx-note">「組成變動大」表示該區成交的建物型態占比較去年同期位移超過 15 個百分點，年增數字可能主要反映產品差異。人口年增需要逐月戶籍人口序列，目前站內只有單期（${period}）資料，欄位標示「準備中」，補齊後即可直接對照。</p></div>`;
}

// ---------- 行政區：共用面板 ----------
function comparisonBars(rows) {
  const maximum = Math.max(...rows.map(r => r.value || 0), 1);
  return rows.map(r => `<div><div class="compare-line-head"><span>${r.label}</span><b>${r.fmt(r.value)} ${r.unit}</b></div><div class="compare-track"><div class="compare-fill ${r.gold?'gold':''}" style="width:${(r.value||0)/maximum*100}%"></div></div></div>`).join('');
}
function comparisonPanel(snapshot, district) {
  const t = snapshot['trailing_' + state.range];
  const cityT = getSnapshot().city['trailing_' + state.range];
  const total = state.metric === 'total';
  const unit = total ? '萬元' : '萬／坪', f = total ? n : one;
  const pv = t ? (total ? t.p50_total_price : t.p50_unit_price) : null;
  const pc = total ? (cityT && cityT.p50_total_price) : (t && t.city_median_unit_price);
  const mv = total ? snapshot.median_total_price : snapshot.median_unit_price;
  const mc = total ? getSnapshot().city.median_total_price : snapshot.city_median_unit_price;
  const rel = (a, b) => (isNum(a) && isNum(b) && b > 0) ? (a / b - 1) * 100 : null;
  const pr = rel(pv, pc), mr = rel(mv, mc);
  const say = (r, what) => r == null ? `${what}樣本不足，暫不比較。` : `${what}${district}${total?'總價':'單價'}中位數${Math.abs(r) < 0.05 ? '與全市持平' : `${r>0?'高於':'低於'}全市 ${Math.abs(r).toFixed(1)}%`}。`;
  return `<div class="data-panel compare-panel"><div class="compare-copy"><p class="section-kicker">City Benchmark</p><h3>與桃園市同期比較</h3><p>${say(pr, `近 ${state.range} 個月，`)}${say(isIncomplete() ? null : mr, '單月看，')}這是市場樣本比較，不等同於個別住宅估價。</p></div>
    <div class="compare-bars"><p class="compare-cap">近 ${state.range} 個月中位${total?'總價':'單價'}</p>${comparisonBars([{label:district, value:pv, unit, fmt:f, gold:true},{label:'桃園市', value:pc, unit, fmt:f}])}
    <p class="compare-cap">${monthLabel(state.month)}單月</p>${comparisonBars([{label:district, value:mv, unit, fmt:f, gold:true},{label:'桃園市', value:mc, unit, fmt:f}])}</div></div>`;
}

function percentilePanel(snapshot) {
  const t = snapshot['trailing_' + state.range];
  if (!t || t.p50_unit_price == null) return `<div class="data-panel"><div class="empty-state"><strong>分位樣本不足</strong>近 ${state.range} 月至少需要 4 筆有效單價。</div></div>`;
  const min = Math.max(0, t.p25_unit_price - (t.p75_unit_price-t.p25_unit_price)*.5);
  const max = t.p75_unit_price + (t.p75_unit_price-t.p25_unit_price)*.5 || t.p75_unit_price+1;
  const pos = value => 6 + (value-min)/Math.max(1e-6, max-min)*88;
  return `<div class="data-panel distribution"><h3>主力價位帶</h3><p>近 ${state.range} 個月中間一半的成交落在 P25 至 P75，P50 是典型成交位置。</p><div class="percentile-scale"><div class="percentile-line"></div><div class="percentile-point" style="left:${pos(t.p25_unit_price)}%"><span><b>${one(t.p25_unit_price)}</b><small>P25 萬／坪</small></span></div><div class="percentile-point median" style="left:${pos(t.p50_unit_price)}%"><span><b>${one(t.p50_unit_price)}</b><small>P50 萬／坪</small></span></div><div class="percentile-point" style="left:${pos(t.p75_unit_price)}%"><span><b>${one(t.p75_unit_price)}</b><small>P75 萬／坪</small></span></div></div><table class="triplet-table"><thead><tr><th>統計項目</th><th>P25</th><th>P50</th><th>P75</th></tr></thead><tbody><tr><td>成交單價（萬／坪）</td><td>${one(t.p25_unit_price)}</td><td class="median-cell">${one(t.p50_unit_price)}</td><td>${one(t.p75_unit_price)}</td></tr><tr><td>成交總價（萬）</td><td>${n(t.p25_total_price)}</td><td class="median-cell">${n(t.p50_total_price)}</td><td>${n(t.p75_total_price)}</td></tr><tr><td>建物坪數（坪）</td><td>${one(t.p25_ping)}</td><td class="median-cell">${one(t.p50_ping)}</td><td>${one(t.p75_ping)}</td></tr></tbody></table></div>`;
}

function mixBars(rows, cap = 8) {
  const max = Math.max(...rows.map(r => r.percentage || 0), 1);
  return rows.slice(0, cap).map((item, i) => `<div class="mix-row"><div class="mix-row-head"><span>${esc(item.label)}</span><span>${n(item.count)} 件・${one(item.percentage)}%</span></div><div class="mix-track"><div class="mix-fill${i===0?' lead':''}" style="width:${(item.percentage||0)/max*100}%"></div></div></div>`).join('');
}
function mixPanel(snapshot, which = 'type') {
  const t = snapshot['trailing_' + state.range] || {};
  const rows = [...((which === 'type' ? t.type_mix : t.floor_mix) || [])].sort((a, b) => b.count - a.count);
  const title = which === 'floor' ? '樓層分布' : state.market === 'presale' ? '格局（房數）分布' : '建物型態';
  const deck = which === 'floor' ? '依成交樓層分低／中／高層；「其他」為透天或樓層欄位無法判讀者。' : '近期成交組成，協助辨認價格變化是否來自產品差異。';
  return `<div class="data-panel mix-panel"><h3>${title}</h3><p>近 ${state.range} 個月・${deck}</p>${mixBars(rows) || '<div class="empty-state">尚無產品組成資料</div>'}</div>`;
}

// P25–P75 價位帶（單價／總價／坪數）
function rangeBand(label, p25, p50, p75, scaleMax, f, unit) {
  if (!isNum(p50)) return `<div class="band-row"><div class="band-head"><span>${label}</span><span>樣本不足</span></div></div>`;
  const pos = v => Math.max(0, Math.min(100, v / scaleMax * 100));
  return `<div class="band-row"><div class="band-head"><span>${label}</span><span><b>${f(p50)}</b> ${unit}・P25 ${f(p25)}／P75 ${f(p75)}</span></div><div class="band-track"><span class="band-iqr" style="left:${pos(p25)}%;width:${pos(p75)-pos(p25)}%"></span><span class="band-mid" style="left:${pos(p50)}%"></span></div></div>`;
}
function bandsPanel(snapshot) {
  const t = snapshot['trailing_' + state.range];
  const cityT = getSnapshot().city['trailing_' + state.range];
  if (!t || !isNum(t.p50_unit_price)) return `<div class="data-panel mix-panel"><h3>價位帶分布</h3><div class="empty-state">近 ${state.range} 個月樣本不足</div></div>`;
  const sc = (a, b) => Math.max(a || 0, b || 0) * 1.15;
  return `<div class="data-panel mix-panel"><h3>價位帶分布</h3><p>近 ${state.range} 個月・粗線為中間一半成交（P25–P75），刻線為中位數；下列為全市同期對照。</p>
    ${rangeBand('單價・本區', t.p25_unit_price, t.p50_unit_price, t.p75_unit_price, sc(t.p75_unit_price, cityT && cityT.p75_unit_price), one, '萬／坪')}
    ${cityT ? rangeBand('單價・全市', cityT.p25_unit_price, cityT.p50_unit_price, cityT.p75_unit_price, sc(t.p75_unit_price, cityT.p75_unit_price), one, '萬／坪') : ''}
    ${rangeBand('總價・本區', t.p25_total_price, t.p50_total_price, t.p75_total_price, sc(t.p75_total_price, cityT && cityT.p75_total_price), n, '萬')}
    ${cityT ? rangeBand('總價・全市', cityT.p25_total_price, cityT.p50_total_price, cityT.p75_total_price, sc(t.p75_total_price, cityT.p75_total_price), n, '萬') : ''}
    ${rangeBand('坪數・本區', t.p25_ping, t.p50_ping, t.p75_ping, sc(t.p75_ping, cityT && cityT.p75_ping), one, '坪')}
    ${cityT ? rangeBand('坪數・全市', cityT.p25_ping, cityT.p50_ping, cityT.p75_ping, sc(t.p75_ping, cityT.p75_ping), one, '坪') : ''}</div>`;
}

function populationKpis(district) {
  const p = POPULATION && POPULATION.districts && POPULATION.districts[district];
  if (!p) return preparing('人口資料', '本區尚無戶籍人口資料。');
  const period = (POPULATION.meta && POPULATION.meta.period) || '';
  return `<div class="kpi-grid">
    ${kpi('現住人口', n(p.pop), '人', `截至 ${period}`)}
    ${kpi('戶數', n(p.households), '戶', '設籍戶數')}
    ${kpi('戶量', Number(p.ppl_per_hh).toFixed(2), '人／戶', '每戶平均人口')}
    ${kpi('里數', n(p.villages), '里', '行政里別')}
  </div>`;
}

function transactionsPanel(snapshot, district) {
  const rows = snapshot.recent_transactions || [];
  const body = rows.map(row => `<tr><td data-l="日期">${esc(row.date)}</td><td data-l="社區" class="tx-main"><span class="project-name">${esc(row.project)}</span><span class="address">${esc(row.address)}</span></td><td data-l="格局">${row.rooms!=null?`${row.rooms} 房`:'—'}<span class="address">${esc(row.type)}</span></td><td data-l="樓層">${esc(row.floor||'—')}</td><td data-l="萬／坪" class="numeric">${one(row.unit_price)}</td><td data-l="總價萬" class="numeric">${n(row.total_price)}</td><td data-l="坪數" class="numeric">${one(row.ping)}</td></tr>`).join('');
  return `<section class="section tight"><div class="section-heading-row"><div><p class="section-kicker">Transactions</p><h2>${monthLabel(state.month)}逐筆成交</h2></div><p class="section-deck">${district}${marketLabel()}本月最新登錄（最多 8 筆），用來對照上方統計。單價已扣除車位。</p></div><div class="data-panel">${body?`<div class="transaction-wrap"><table class="transactions tx-cards"><thead><tr><th>日期</th><th>社區／門牌</th><th>格局</th><th>樓層</th><th style="text-align:right">萬／坪</th><th style="text-align:right">總價萬</th><th style="text-align:right">坪數</th></tr></thead><tbody>${body}</tbody></table></div>`:`<div class="empty-state"><strong>本月沒有可顯示的成交</strong>可切換其他月份查看。</div>`}</div></section>`;
}

function projectsPanel(district) {
  if (!PROJECTS || !PROJECTS.districts || !PROJECTS.districts[district]) return '';
  const list = PROJECTS.districts[district];
  const rows = list.slice(0, 80).map(p => `<button class="linked-project project-row" type="button" data-pid="${p.pid}"><span class="no">◦</span><span><b>${p.name.includes('?')?PENDING_NAME(p.name):esc(p.name)}</b><small>${p.ps?`預售 ${p.ps}`:''}${p.ps&&p.rs?'・':''}${p.rs?`成屋 ${p.rs}`:''}　最近 ${p.last||'—'}</small></span><span class="value">${one(p.med)} 萬／坪</span></button>`).join('');
  return `<section class="section"><div class="section-heading-row"><div><p class="section-kicker">Project Index</p><h2>本區建案索引（${list.length}）</h2></div><p class="section-deck">點任一建案，看它從預售、交屋到中古轉售的完整實價登錄歷史。列表依登錄量排序，最多顯示 80 案。</p></div><div class="data-panel project-list scrolly">${rows}</div></section>`;
}

// ---------- 預售建案實價登錄清單（WP7） ----------
function presaleProjectsPanel(district) {
  const file = PRESALE[district];
  const pm = marketMonth('presale');
  if (!file) return `<div class="data-panel"><div class="empty-state"><strong>載入建案資料中…</strong></div></div>`;
  const list = BeidoSummary.aggregateProjects(file, pm, state.range);
  const t = (getSnapshot('presale', pm).districts[district] || {})['trailing_' + state.range];
  const listSum = list.reduce((a, p) => a + p.count, 0);
  if (!list.length) return `<div class="data-panel"><div class="empty-state"><strong>近 ${state.range} 個月沒有預售簽約登錄</strong>${district}在這段期間沒有可列出的預售建案。</div></div>`;
  const sorted = [...list].sort(state.projSort === 'latest' ? (a, b) => b.latest.localeCompare(a.latest) || b.count - a.count
    : state.projSort === 'price' ? (a, b) => (b.median ?? -1) - (a.median ?? -1) : (a, b) => b.count - a.count || b.latest.localeCompare(a.latest));
  const max = Math.max(...list.map(p => p.count), 1);
  const body = sorted.map((p, i) => {
    const nm = p.pending ? `${PENDING_NAME(p.name)} <span class="name-tag" title="實登原始名稱含無法辨識字元，正規化校正中">名稱校正中</span>` : esc(p.name);
    const merged = p.names && p.names.length > 1 ? `<small class="merged" title="${esc(p.names.join('、'))}">已合併 ${p.names.length} 個實登登錄名稱</small>` : '';
    return `<tr><td class="num rank">${i + 1}</td><td><button type="button" class="proj-link linked-project" data-pid="${p.pid}">${nm}</button>${merged}</td><td class="num"><span class="cnt-bar"><span style="width:${p.count/max*100}%"></span></span>${n(p.count)}</td><td class="num">${p.latest}</td><td class="num">${one(p.median)}</td></tr>`;
  }).join('');
  const diff = t && t.sample_count !== listSum
    ? `<p class="tx-note">清單合計 ${n(listSum)} 筆／期間預售成交 ${n(t.sample_count)} 筆：差額為官方動態查詢回補、尚未歸戶到建案的簽約，待季度封存後補齊。</p>` : `<p class="tx-note">清單合計 ${n(listSum)} 筆，與上方近 ${state.range} 個月預售成交數一致（已排除解約）。</p>`;
  const sortBtn = (k, label) => `<button type="button" data-psort="${k}" class="${state.projSort===k?'is-active':''}">${label}</button>`;
  return `<div class="data-panel"><div class="panel-head"><div><h3>預售建案實價登錄</h3><p>${district}・近 ${state.range} 個月（截至 ${monthLabel(pm)}）・${list.length} 個建案</p></div><div class="rank-switch">${sortBtn('count','成交量')}${sortBtn('latest','最新成交')}${sortBtn('price','中位單價')}</div></div>
    <div class="tx-scroll"><table class="tx-table presale-table"><thead><tr><th class="num">#</th><th>建案名稱</th><th class="num">成交量</th><th class="num">最新成交日</th><th class="num">中位單價（萬／坪）</th></tr></thead><tbody>${body}</tbody></table></div>${diff}
    <p class="tx-note">預售屋為簽約當下的實價登錄，屋況尚未完工；與中古屋（成屋）成交分開統計。建案名已依建商正式字形校正並合併同案異名。</p></div>`;
}

// ---------- 全區磁磚牆 + 地圖彈窗 ----------
function tileWall(current) {
  const snap = getSnapshot();
  const total = state.metric === 'total';
  const tiles = DATA.meta.districts.filter(d => d).map(d => {
    const z = snap.districts[d] || {};
    const v = total ? z.median_total_price : z.median_unit_price;
    const tags = [];
    if (isIncomplete()) tags.push(['登錄中', 'warn']);
    if (!z.sample_count) tags.push(['本月無成交', 'mute']);
    else if (z.sample_count < SAMPLE_MIN) tags.push(['樣本偏少', 'mute']);
    else if (isNum(z.versus_city) && !total) tags.push([`${z.versus_city >= 0 ? '高於' : '低於'}全市 ${Math.abs(z.versus_city).toFixed(1)}%`, z.versus_city >= 0 ? 'up' : 'down']);
    if (d === current) tags.unshift(['本區', 'cur']);
    return `<button type="button" class="tile linked-district${d===current?' is-current':''}" data-district="${d}"><b>${d}</b><span class="tile-v">${total ? n(v) : one(v)}<small>${total ? '萬' : '萬／坪'}</small></span><small class="tile-n">${n(z.sample_count || 0)} 件</small><span class="tile-tags">${tags.map(([t, c]) => `<i class="tag ${c}">${t}</i>`).join('')}</span></button>`;
  }).join('');
  return `<section class="section"><div class="section-heading-row"><div><p class="section-kicker">All Districts</p><h2>桃園 13 區一覽</h2></div><div class="wall-actions"><p class="section-deck">${marketLabel()}・${monthLabel(state.month)}單月中位${total?'總價':'單價'}與樣本數。點任一區切換。</p><button type="button" class="ghost-button" id="openMap">地圖檢視</button></div></div><div class="tile-wall">${tiles}</div></section>
  <dialog class="map-dialog" id="mapDialog" aria-label="桃園行政區地圖"><div class="map-dialog-head"><b>地圖看數據・${marketLabel()} ${monthLabel(state.month)}</b><button type="button" class="map-close" id="closeMap" aria-label="關閉地圖">×</button></div><div class="district-layout single">${districtMap(snap.city)}</div></dialog>`;
}

// ---------- 建案專頁（沿用） ----------
function projBadge(kind) {
  const c = {'預售簽約':'#3f6bb0','預售解約':'#a95536','首次移轉·疑似交屋':'#6a5a8c','中古轉售':'#39766f','換約':'#a6771a','成屋登錄':'#8a836f'}[kind] || '#8a836f';
  return `<span class="kind-badge" style="background:${c}1a;color:${c}">${kind}</span>`;
}
function shortAddr(a) { return String(a||'').replace(/^桃園市[^區]*區/, ''); }

function projRow(x) {
  let extra = '';
  if (x.ev === 'resale_transfer' && x.punit) {
    const cu = (x.unit - x.punit) / x.punit * 100, ct = x.ptotal ? (x.total - x.ptotal) / x.ptotal * 100 : null;
    extra = `<span class="change ${cu>0?'up':'down'}">單價${cu>0?'+':''}${cu.toFixed(1)}%</span>${ct!=null?` <span class="change ${ct>0?'up':'down'}">總價${ct>0?'+':''}${ct.toFixed(1)}%</span>`:''} <small class="muted">前手${x.pdate||''}</small>`;
  }
  const rt = x.src ? ' <span class="rt-badge">即時</span>' : '';
  const rm = parseInt(x.layout||'', 10); const layout = (rm > 8) ? '<span class="muted">格局待校正</span>' : esc(x.layout||'');
  return `<tr><td>${projBadge(x.kindLabel)}${rt}</td><td>${x.date||''}</td><td>${esc(shortAddr(x.addr))}</td><td>${layout}</td><td>${esc(x.floor||'')}</td><td class="numeric">${one(x.deed)}</td><td class="numeric">${x.park?n(x.park):'—'}</td><td class="numeric">${one(x.unit)}</td><td class="numeric">${n(x.total)}</td><td>${extra}</td></tr>`;
}

async function renderProject() {
  const pid = state.project;
  if (!PROJECT_CACHE[pid]) $('#projectView').innerHTML = `<button class="district-back" type="button" id="backToDistrict">返回${state.district||'全市'}</button><div class="district-title-row"><div><p class="section-kicker">Project Dossier</p><h2 class="page-h">載入建案資料…</h2></div></div>`;
  $('#backToDistrict')?.addEventListener('click', () => navigate({project:null}));
  let det = PROJECT_CACHE[pid];
  if (!det) { try { det = await (await fetch(asset(`data/projects/${pid}.json`), {cache:'no-store'})).json(); PROJECT_CACHE[pid] = det; } catch (_) { $('#projectView').innerHTML = '<div class="empty-state">建案資料載入失敗。</div>'; return; } }
  if (state.project !== pid) return;
  const s = det.summary;
  const presaleEv = det.presale.map(r => ({...r, ev: r.term ? 'presale_termination' : 'presale_contract', kindLabel: r.term ? '預售解約' : '預售簽約'}));
  const completedEv = det.resale.map(r => ({...r, ev: r.flag==='交屋'?'first_registration':r.flag==='轉售'?'resale_transfer':r.flag==='換約'?'contract_assignment':'unknown_completed', kindLabel: r.flag==='交屋'?'首次移轉·疑似交屋':r.flag==='轉售'?'中古轉售':r.flag==='換約'?'換約':'成屋登錄'}));
  const nSign = presaleEv.filter(x=>x.ev==='presale_contract').length, nTerm = presaleEv.filter(x=>x.ev==='presale_termination').length;
  const nFirst = completedEv.filter(x=>x.ev==='first_registration').length, nResale = completedEv.filter(x=>x.ev==='resale_transfer').length;
  const hasPre = det.presale.length > 0, hasCom = det.resale.length > 0;
  let view = state.projectView || (hasPre ? 'presale' : 'completed');
  if (view==='presale' && !hasPre) view='completed';
  if (view==='completed' && !hasCom) view='presale';
  const rows = view==='presale' ? presaleEv : completedEv;
  const chipDefs = view==='presale'
    ? [['all','全部'],['presale_contract','有效簽約'],['presale_termination','解約']]
    : [['all','全部'],['first_registration','首次移轉·疑似交屋'],['resale_transfer','中古轉售'],['contract_assignment','換約'],['unknown_completed','未分類']];
  const chip = chipDefs.some(c=>c[0]===state.projectChip) ? state.projectChip : 'all';
  const filtered = (chip==='all' ? rows : rows.filter(x=>x.ev===chip)).slice().sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const total = filtered.length, limit = state.projectRows || 50, shown = filtered.slice(0, limit);
  const body = shown.map(projRow).join('');
  const growth = s.growth!=null ? `<span class="change ${s.growth>0?'up':'down'}">${s.growth>0?'+':''}${s.growth}%</span>` : '—';
  const tabs = `<div class="proj-tabs" role="tablist">
    <button class="proj-tab ${view==='presale'?'is-active':''}" role="tab" aria-selected="${view==='presale'}" data-pv="presale" ${!hasPre?'disabled':''}>預售簽約（${det.presale.length}）</button>
    <button class="proj-tab ${view==='completed'?'is-active':''}" role="tab" aria-selected="${view==='completed'}" data-pv="completed" ${!hasCom?'disabled':''}>交屋後實登（${det.resale.length}）</button></div>`;
  const chips = `<div class="proj-chips">${chipDefs.map(c=>{const cn=c[0]==='all'?rows.length:rows.filter(x=>x.ev===c[0]).length;return `<button class="proj-chip ${chip===c[0]?'is-active':''}" data-pc="${c[0]}">${c[1]}（${cn}）</button>`;}).join('')}</div>`;
  const more = total>limit ? `<div class="load-more-wrap"><button class="load-more" id="loadMore">載入更多（已顯示 ${shown.length}／${total}）</button></div>` : `<p class="tx-note">共 ${total} 筆</p>`;
  const title = det.name.includes('?') ? PENDING_NAME(det.name) : esc(det.name);
  $('#projectView').innerHTML = `<button class="district-back" type="button" id="backToDistrict">返回${state.district||'全市'}</button>
    <div class="district-title-row"><div><p class="section-kicker">Project Dossier / ${det.district}</p><h2 class="page-h">${title}</h2>${(det.source_names&&det.source_names.length)?`<p class="source-names">實登原始登錄名：${det.source_names.map(esc).join('、')}（已依建商正式字形校正）</p>`:''}</div><p>${det.district}・分開呈現「預售簽約」與「交屋後實登」——同一戶的預售與日後首次移轉是不同官方事件，不相加成「成交總數」。</p></div>
    <section class="section tight"><div class="kpi-grid">
      ${kpi('有效預售簽約', n(nSign), '筆', s.presale_med?`均 ${one(s.presale_med)} 萬／坪`:'')}
      ${kpi('預售解約', n(nTerm), '筆', '撤銷／解約')}
      ${kpi('首次移轉·疑似交屋', n(nFirst), '筆', '非等於建商正式交屋')}
      ${kpi('中古轉售', n(nResale), '筆', s.resale_med?`均 ${one(s.resale_med)} 萬／坪・對前手 ${growth}`:'')}
    </div></section>
    <section class="section"><div class="section-heading-row"><div><p class="section-kicker">Lifecycle</p><h2>逐筆登錄</h2></div><p class="section-deck">兩大頁籤互斥：預售簽約看新約；交屋後實登看首次移轉與真中古轉售（附前手漲跌）。「首次移轉／疑似交屋」不等於建商正式交屋。</p></div>
      ${tabs}${chips}
      <div class="data-panel"><div class="transaction-wrap"><table class="transactions"><thead><tr><th>記號</th><th>成交日</th><th>門牌</th><th>格局</th><th>樓層</th><th style="text-align:right">權狀坪</th><th style="text-align:right">車位萬</th><th style="text-align:right">萬／坪</th><th style="text-align:right">總價萬</th><th>轉售對前手</th></tr></thead><tbody>${body}</tbody></table></div>${more}</div></section>`;
  $('#backToDistrict')?.addEventListener('click', () => navigate({project:null}));
  $$('[data-pv]').forEach(b => b.addEventListener('click', () => { if (!b.disabled) navigate({projectView:b.dataset.pv, projectChip:'all', projectRows:50}); }));
  $$('[data-pc]').forEach(b => b.addEventListener('click', () => { state.projectChip = b.dataset.pc; state.projectRows = 50; renderProject(); }));
  $('#loadMore')?.addEventListener('click', () => { state.projectRows = (state.projectRows||50) + 100; renderProject(); });
}

// ---------- 行政區頁 ----------
function marketCard(market, district) {
  const month = marketMonth(market);
  const z = getSnapshot(market, month).districts[district] || {};
  const active = market === state.market;
  const mom = isIncomplete(month, market) ? '<span class="change flat">登錄中，暫不比較</span>' : changeMarkup(z.month_over_month, '較上月');
  return `<button type="button" class="m-card${active?' is-active':''}" data-market-card="${market}" aria-pressed="${active}"><span class="m-card-label">${marketLabel(market)}均價</span><span class="m-card-v">${one(z.median_unit_price)}<small>萬／坪</small></span><span class="m-card-meta">${mom}</span><span class="m-card-meta muted">${monthLabel(month)}・${n(z.sample_count || 0)} 件</span></button>`;
}

function districtTabContent(snapshot, district, s) {
  const note = text => `<p class="tab-note">${esc(text || '')}</p>`;
  const t = snapshot['trailing_' + state.range] || {};
  if (state.dtab === 'trend')
    return note(s.notes.trend) + chartPanel(`${district}月度走勢`, `${marketLabel()}・近 ${state.range} 個月・截至 ${monthLabel(state.month)}`, district);
  if (state.dtab === 'structure')
    return note(s.notes.structure) + `<div class="detail-grid">${bandsPanel(snapshot)}${mixPanel(snapshot, 'type')}${mixPanel(snapshot, 'floor')}<div class="data-panel mix-panel"><h3>更細的產品切面</h3><p>以下切面需要逐筆資料的級距彙整，本站將在資料管線補上後開放。</p>${preparing('單價／總價／坪數級距分布', '各級距的筆數、占比與該級距中位數。')}${preparing(state.market === 'resale' ? '屋齡與格局分布' : '屋齡分布（預售不適用）', state.market === 'resale' ? '中古屋屋齡級距與房數格局。' : '預售屋尚未完工，不計屋齡；格局分布見左側。')}</div></div>`;
  if (state.dtab === 'projects')
    return note(s.notes.projects) + presaleProjectsPanel(district);
  if (state.dtab === 'people') {
    const period = (POPULATION && POPULATION.meta && POPULATION.meta.period) || '';
    return note(s.notes.population) + populationKpis(district)
      + `<div class="prep-grid">${preparing('戶籍人口趨勢（近 N 月）', `目前站內為單期戶籍統計（${period}），逐月序列補齊後顯示折線。`)}${preparing('高齡人口比率', '65 歲以上人口占比，需年齡別人口統計。')}${preparing('人口年增', '需前一年同月戶籍人口。')}${preparing('所得（中位數／平均）', '綜稅所得資料準備中，補齊後顯示中位與平均所得。')}</div>`
      + `<div class="spacer"></div>${crossPanel(district)}`;
  }
  // overview
  return note(s.notes.overview) + `<div class="period-kpis">
      ${kpi(`近 ${state.range} 月中位單價`, one(t.p50_unit_price), '萬／坪', `P25 ${one(t.p25_unit_price)}・P75 ${one(t.p75_unit_price)}`)}
      ${kpi(`近 ${state.range} 月中位總價`, n(t.p50_total_price), '萬元', `P25 ${n(t.p25_total_price)}・P75 ${n(t.p75_total_price)}`)}
      ${kpi('中位建物坪數', one(t.p50_ping), '坪', `P25 ${one(t.p25_ping)}・P75 ${one(t.p75_ping)}`)}
    </div><div class="detail-grid">${percentilePanel(snapshot)}${comparisonPanel(snapshot, district)}</div>`;
}

function renderDistrict() {
  const district = state.district;
  const snapshot = getSnapshot().districts[district];
  if (!snapshot) { state.district=''; render(); return; }
  const s = summaryFor(district);
  const t = snapshot['trailing_' + state.range] || {};
  const nWin = t.sample_count || 0;
  const pop = POPULATION && POPULATION.districts && POPULATION.districts[district];
  const seg = (attr, items, cur) => `<div class="seg">${items.map(([v, l]) => `<button type="button" ${attr}="${v}" class="${cur===v?'is-active':''}" aria-pressed="${cur===v}">${l}</button>`).join('')}</div>`;
  $('#districtView').innerHTML = `
    <nav class="crumbs" aria-label="麵包屑"><a href="${asset('')}" id="crumbCity">桃園市</a><span>／</span><span aria-current="page">${district}</span></nav>
    <div class="m-cards">${marketCard('resale', district)}${marketCard('presale', district)}
      <div class="m-card static"><span class="m-card-label">現住人口</span><span class="m-card-v">${pop ? n(pop.pop) : '—'}<small>人</small></span><span class="m-card-meta">${pop ? `${n(pop.households)} 戶・戶量 ${Number(pop.ppl_per_hh).toFixed(2)}` : '資料準備中'}</span><span class="m-card-meta muted">${pop ? `截至 ${POPULATION.meta.period}` : ''}</span></div></div>
    <div class="district-controls" role="group" aria-label="行政區篩選">
      <div class="dc-group"><span class="dc-label">行政區</span>
        <select id="districtSelect" class="dc-select">${DATA.meta.districts.filter(d=>d).map(d=>`<option value="${d}" ${d===district?'selected':''}>${d}</option>`).join('')}</select></div>
      <div class="dc-group"><span class="dc-label">市場</span>${seg('data-dmarket', [['resale','中古屋'],['presale','預售屋']], state.market)}</div>
      <div class="dc-group"><span class="dc-label">期間</span>${seg('data-range', [[12,'近 12 月'],[24,'近 24 月'],[36,'近 36 月']].map(([v,l])=>[v,l]), state.range)}</div>
      <div class="dc-group"><span class="dc-label">指標</span>${seg('data-metric', [['unit','單價'],['total','總價']], state.metric)}</div>
      <button type="button" class="dc-share" id="shareDistrict">分享本區</button>
    </div>
    <p class="status-line">${marketLabel()}・${monthLabel(state.month)}・${statusLabel()}。本頁所有比較沿用相同市場、月份與期間，不會在切換時偷換資料口徑。</p>
    ${summaryBlock(s, `Auto Summary / ${district}`)}
    <div class="stat4" aria-label="期間四格統計">
      ${kpi('有效成交數', n(nWin), '筆', `近 ${state.range} 個月`)}
      ${kpi('月均件數', nWin ? one(nWin / state.range) : '—', '筆／月', `占全市 ${one(t.share_of_city)}%`)}
      ${kpi('單價中位', one(t.p50_unit_price), '萬／坪', `全市 ${one(t.city_median_unit_price)}`)}
      ${kpi('總價中位', n(t.p50_total_price), '萬元', `坪數中位 ${one(t.p50_ping)} 坪`)}
    </div>
    <details class="month-kpis"><summary>${monthLabel(state.month)}單月數據</summary><div class="kpi-grid">
      ${kpi('本月單價中位數', one(snapshot.median_unit_price), '萬／坪', changeOrHold(snapshot.year_over_year,'較去年同期'))}
      ${kpi(isIncomplete()?'目前資料筆數':'本月成交件數', sampleDisplay(snapshot.sample_count), isUnavailable()?'':'件', isUnavailable()?'不可解讀為零成交':changeOrHold(snapshot.month_over_month,'單價較上月'))}
      ${kpi('本月總價中位數', n(snapshot.median_total_price), '萬元', `樣本 ${n(snapshot.sample_count)} 件`)}
      ${kpi('與全市單月比較', snapshot.versus_city == null ? '—' : `${snapshot.versus_city > 0 ? '+' : ''}${one(snapshot.versus_city)}`, snapshot.versus_city == null ? '' : '%', `全市 ${one(snapshot.city_median_unit_price)} 萬／坪`)}
    </div></details>
    ${transactionsPanel(snapshot, district)}
    <section class="section tight d-tabs-section" id="dtabs">
      <div class="d-tabs" role="tablist" aria-label="區域分析分頁">${DTABS.map(x => `<button type="button" role="tab" id="tab-${x.k}" aria-controls="dtab-panel" aria-selected="${state.dtab===x.k}" class="d-tab${state.dtab===x.k?' is-active':''}" data-dtab="${x.k}">${x.t}</button>`).join('')}</div>
      <div class="d-tab-panel" id="dtab-panel" role="tabpanel" aria-labelledby="tab-${state.dtab}">${districtTabContent(snapshot, district, s)}</div>
    </section>
    ${projectsPanel(district)}
    ${tileWall(district)}`;
}

// ---------- 事件 ----------
function bindRenderedEvents() {
  $$('[data-range]').forEach(button => button.addEventListener('click', () => navigate({range: Number(button.dataset.range)}, true)));
  $$('[data-rank]').forEach(button => button.addEventListener('click', () => { state.rankBy = button.dataset.rank; render(); }));
  $$('[data-metric]').forEach(button => button.addEventListener('click', () => navigate({metric: button.dataset.metric}, true)));
  $$('[data-dmarket]').forEach(button => button.addEventListener('click', () => { if (button.dataset.dmarket !== state.market) navigate({market: button.dataset.dmarket}, true); }));
  $$('[data-market-card]').forEach(button => button.addEventListener('click', () => { if (button.dataset.marketCard !== state.market) navigate({market: button.dataset.marketCard}, true); }));
  $$('[data-psort]').forEach(button => button.addEventListener('click', () => { state.projSort = button.dataset.psort; render(); }));
  $$('[data-dtab]').forEach(button => button.addEventListener('click', () => navigate({dtab: button.dataset.dtab}, true)));
  const tabs = $$('[data-dtab]');
  tabs.forEach((button, i) => button.addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    navigate({dtab: next.dataset.dtab}, true).then(() => $(`[data-dtab="${next.dataset.dtab}"]`)?.focus());
  }));
  $$('.linked-district').forEach(element => {
    element.addEventListener('click', () => { $('#mapDialog')?.open && $('#mapDialog').close(); navigate({district: element.dataset.district}); });
    element.addEventListener('mouseenter', () => syncDistrictHover(element.dataset.district, true));
    element.addEventListener('mouseleave', () => syncDistrictHover(element.dataset.district, false));
    element.addEventListener('focus', () => syncDistrictHover(element.dataset.district, true));
    element.addEventListener('blur', () => syncDistrictHover(element.dataset.district, false));
  });
  $('#backToCity')?.addEventListener('click', () => navigate({district:''}));
  $('#crumbCity')?.addEventListener('click', e => { e.preventDefault(); navigate({district:''}); });
  $$('.linked-project').forEach(el => el.addEventListener('click', () => navigate({project: el.dataset.pid})));
  $('#districtSelect')?.addEventListener('change', event => navigate({district: event.target.value}));
  $('#shareDistrict')?.addEventListener('click', sharePage);
  $('#openMap')?.addEventListener('click', () => { const d = $('#mapDialog'); if (d && d.showModal) d.showModal(); });
  $('#closeMap')?.addEventListener('click', () => $('#mapDialog')?.close());
  $('#mapDialog')?.addEventListener('click', e => { if (e.target.id === 'mapDialog') e.target.close(); });
  $$('[data-citytab]').forEach(button => button.addEventListener('click', () => { navigate({cityTab: button.dataset.citytab}, true); const nav = $('.city-nav-section'); if (nav) window.scrollTo({top: nav.offsetTop - 80, behavior:'smooth'}); }));
}

function syncDistrictHover(district, active) {
  $$(`.linked-district[data-district="${CSS.escape(district)}"]`).forEach(element => element.classList.toggle('is-linked',active));
}

function updateHero() {
  const snapshot = state.district ? (getSnapshot().districts[state.district] || {}) : getSnapshot().city;
  $('#heroMonth').textContent = monthLabel(state.month);
  const status = monthStatus();
  $('#heroStatus').innerHTML = status === 'complete' ? '● 資料已覆蓋・可比較量能'
    : status === 'local_source_gap' ? '<span class="status-gap">● 本站來源缺口</span>・資料不完整'
    : status === 'mixed' ? '<span class="status-gap">● 部分缺口·部分待發布</span>・不完整'
    : status === 'backfilling' ? '<span class="status-live">● 動態回補</span>・待官方對帳'
    : '<span class="status-gap">● 官方陸續登錄中</span>・不可判讀為零成交';
  $('#heroMarket').textContent = marketLabel();
  $('#heroScope').textContent = state.district || '桃園市';
  $('#heroSamples').textContent = isUnavailable() ? '—' : `${n(snapshot.sample_count)} 件`;
  $('#heroUpdated').textContent = String(DATA.meta.updated_at).slice(0,10);
  $('#headerFreshness').textContent = `資料更新 ${String(DATA.meta.updated_at).slice(0,10)}`;
  const d = state.project ? '' : state.district;
  document.body.dataset.view = state.project ? 'project' : d ? 'district' : 'city';
  $('#heroTitle').innerHTML = d ? `${d}<em>房價行情</em>` : state.project ? `${state.district || '桃園市'}<em>建案實價登錄</em>` : '看懂一座城市，<br>從每一筆<em>成交</em>開始。';
  $('#heroEyebrow').textContent = d ? `Taoyuan · ${SLUGS[d].toUpperCase()} District` : 'Beedoo Market Desk · Taoyuan';
  $('#heroLede').textContent = d
    ? `${d}預售屋與中古屋的實價登錄行情：均價、成交量、主力價位、建案與人口，一頁看懂。`
    : '不替市場下結論，先把量、價、時間與區域差異整理清楚。從桃園全市一路深入行政區，讓判斷有跡可循。';
  document.title = d ? `${d}房價行情｜預售屋・中古屋實價登錄｜貝多不動產` : '桃園成交行情｜貝多不動產';
}

function updateControls() {
  $$('[data-market]', $('#marketSwitch')).forEach(button => {
    const active = button.dataset.market === state.market;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const avail = [...marketMeta().available_months];
  const years = [...new Set(avail.map(m => m.slice(0,4)))].sort().reverse();
  const curYear = state.month.slice(0,4);
  $('#yearSelect').innerHTML = years.map(y => `<option value="${y}">${y} 年</option>`).join('');
  $('#yearSelect').value = curYear;
  const ymonths = avail.filter(m => m.slice(0,4) === curYear).sort().reverse();
  $('#monthSelect').innerHTML = ymonths.map(value => {
    const suffix = ({local_source_gap:'（本站缺口）', official_pending:'（官方登錄中）', mixed:'（部分缺口）', backfilling:'（動態回補）', unpublished:'（未發布）'})[monthStatus(value)] || '';
    return `<option value="${value}">${Number(value.slice(5))} 月${suffix}</option>`;
  }).join('');
  $('#monthSelect').value = state.month;
}

// 行政區使用獨立網址 /district/<slug>/（利於 SEO），其餘狀態放 query
function updateUrl(replace = false) {
  const url = new URL(state.district ? `district/${SLUGS[state.district]}/` : './', ROOT_URL);
  url.searchParams.set('market', state.market);
  url.searchParams.set('month', state.month);
  if (state.project) url.searchParams.set('project', state.project);
  if (state.project && state.projectView) url.searchParams.set('pv', state.projectView);
  if (!state.district && state.cityTab && state.cityTab !== 'rank') url.searchParams.set('tab', state.cityTab);
  if (state.district && state.dtab && state.dtab !== 'overview') url.searchParams.set('dtab', state.dtab);
  if (state.range && state.range !== 24) url.searchParams.set('range', state.range);
  if (state.metric === 'total') url.searchParams.set('metric', 'total');
  (replace ? history.replaceState : history.pushState).call(history, {...state}, '', url);
}

async function navigate(patch, replace = false) {
  if ('project' in patch) { state.projectView = ''; state.projectChip = 'all'; state.projectRows = 50; }
  Object.assign(state, patch);
  if (!marketMeta().available_months.includes(state.month)) state.month = marketMeta().complete_month;
  updateUrl(replace);
  await ensureViewData();
  render();
  if (patch.district !== undefined) document.querySelector('#main').scrollIntoView({behavior:'smooth',block:'start'});
  if ('project' in patch && patch.project) window.scrollTo({top:0,behavior:'smooth'});   // 點入建案從頂部開始
}

function render() {
  updateControls(); updateHero();
  const projectMode = Boolean(state.project);
  const districtMode = !projectMode && Boolean(state.district);
  $('#cityView').hidden = projectMode || Boolean(state.district);
  $('#districtView').hidden = projectMode || !state.district;
  $('#projectView').hidden = !projectMode;
  if (projectMode) renderProject();
  else if (districtMode) renderDistrict();
  else renderCity();
  bindRenderedEvents();
  $('#liveRegion').textContent = `${state.district||'桃園市'}，${marketLabel()}，${monthLabel(state.month)}資料已更新`;
}

function setupControls() {
  $('#marketSwitch').addEventListener('click', event => {
    const button = event.target.closest('[data-market]');
    if (button && button.dataset.market !== state.market) navigate({market:button.dataset.market});
  });
  $('#monthSelect').addEventListener('change', event => navigate({month:event.target.value}));
  $('#yearSelect').addEventListener('change', event => {
    const ms = marketMeta().available_months.filter(m => m.slice(0,4) === event.target.value).sort();
    if (ms.length) navigate({month: ms[ms.length-1]});
  });
  $('#shareButton').addEventListener('click', sharePage);
  $('#brandHome').addEventListener('click', event => { event.preventDefault(); navigate({district:'', project:null}); window.scrollTo({top:0,behavior:'smooth'}); });
  window.addEventListener('popstate', async () => { readUrlState(); await ensureViewData(); render(); });
}

async function sharePage(event) {
  const button = event && event.currentTarget || $('#shareButton');
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(location.href);
    button.textContent = '網址已複製';
  } catch (_) {
    window.prompt('複製這個網址', location.href);
  }
  setTimeout(() => button.textContent = original, 1800);
}

function readUrlState() {
  const params = new URLSearchParams(location.search);
  const market = params.get('market');
  const selectedMonth = params.get('month');
  const slug = (location.pathname.match(/\/district\/([a-z]+)\/?(?:index\.html)?$/) || [])[1];
  const district = SLUG_TO_DISTRICT[slug] || params.get('district');   // 舊式 ?district= 連結仍可用
  state.market = DATA.markets[market] ? market : (window.BEIDO_DEFAULT_MARKET || 'presale');
  state.month = marketMeta().available_months.includes(selectedMonth) ? selectedMonth : marketMeta().complete_month;
  state.district = DATA.meta.districts.includes(district) && district ? district : '';
  const project = params.get('project');
  state.project = project ? (REDIRECT[project] || project) : null;   // 舊流水PID → 新穩定ID 轉址
  const pv = params.get('pv'); state.projectView = ['presale','completed'].includes(pv) ? pv : '';
  const tab = params.get('tab');
  state.cityTab = ['rank','grid','map','tx','people'].includes(tab) ? tab : 'rank';
  const dtab = params.get('dtab');
  state.dtab = DTABS.some(x => x.k === dtab) ? dtab : 'overview';
  const range = Number(params.get('range'));
  state.range = [12,24,36].includes(range) ? range : 24;
  state.metric = params.get('metric') === 'total' ? 'total' : 'unit';
}

async function loadData() {
  $('#loading').hidden = false; $('#error').hidden = true; $('#app').hidden = true;
  try {
    const response = await fetch(asset(DATA_URL), {cache:'no-store'});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    DATA = await response.json();
    const side = async (rel, fallback) => { try { const r = await fetch(asset(rel), {cache:'no-store'}); return r.ok ? await r.json() : fallback; } catch (_) { return fallback; } };
    [PROJECTS, REDIRECT, POPULATION] = await Promise.all([side('data/projects/index.json', null), side('data/projects/redirect.json', {}), side('data/population.json', DATA.population || null)]);
    POPULATION = POPULATION || DATA.population || null;
    readUrlState(); setupControls(); updateUrl(true); await ensureViewData(); render();
    $('#loading').hidden = true; $('#app').hidden = false;
    const ssr = $('#ssr'); if (ssr) ssr.hidden = true;
  } catch (error) {
    $('#loading').hidden = true; $('#error').hidden = false;
    $('#errorMessage').textContent = `無法讀取資料（${error.message}）。請稍後重新載入。`;
  }
}

try {
  if (sessionStorage.getItem('beido-intro-played') || window.BEIDO_BASE) $('#brandIntro').classList.add('is-skipped');
  else sessionStorage.setItem('beido-intro-played','1');
} catch (_) { $('#brandIntro').classList.add('is-skipped'); }
$('#retryButton').addEventListener('click', loadData);
loadData();
