/*
 * 貝多行政區「自動市場總結」模板引擎（WP1）
 * 規則模板 + 數據插值：句式固定，數字全部取自 data/snapshots 的期間值、
 * beido-market-data.json 的月序列與 data/presale_projects 的建案彙整。
 * 同一份程式同時給瀏覽器（window.BeidoSummary）與 Node 產生靜態 JSON 用，
 * 確保 data/summaries/*.json 與畫面顯示的文字一字不差。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BeidoSummary = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = 2;
  const SAMPLE_MIN = 5;        // 少於 5 筆不計算漲跌（沿用方法論）
  const LOW_SAMPLE = 30;       // 期間樣本少於 30 筆加註「僅供參考」
  const MARKET_LABEL = { presale: '預售屋', resale: '中古屋' };

  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  const fmtInt = v => Math.round(v).toLocaleString('en-US');
  const fmt1 = v => Number(v).toFixed(1);
  const pct = v => Math.abs(v).toFixed(1);

  function addMonths(ym, delta) {
    const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)) - 1 + delta;
    const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12 + 1;
    return `${yy}-${String(mm).padStart(2, '0')}`;
  }
  function monthText(ym) { return `${ym.slice(0, 4)} 年 ${Number(ym.slice(5, 7))} 月`; }
  function windowRange(month, window) { return { start: addMonths(month, -(window - 1)), end: month }; }

  // 期間值與全市同期比較（與「行情總覽」比較橫條使用相同欄位）
  function versusCity(t) {
    if (!t || !isNum(t.p50_unit_price) || !isNum(t.city_median_unit_price) || t.city_median_unit_price <= 0) return null;
    return Math.round((t.p50_unit_price / t.city_median_unit_price - 1) * 1000) / 10;
  }

  function topMix(list, skipOther) {
    return (list || []).filter(x => x && x.count > 0 && (!skipOther || x.label !== '其他'))
      .slice().sort((a, b) => b.count - a.count);
  }

  /*
   * ctx = {
   *   district, market, window, month,
   *   trailing,            // snapshot.districts[d]['trailing_'+window]（或 city）
   *   monthly,             // snapshot.districts[d]（單月值：median_unit_price, year_over_year...）
   *   monthComplete,       // 該月是否為完整登錄月
   *   series,              // 該區月序列（截至 month、長度 window），同趨勢圖
   *   projects,            // [{name, count, latest, median}]（預售建案；可省略）
   *   population           // {pop, households, ppl_per_hh, villages, period}（可省略）
   * }
   */
  function build(ctx) {
    const { district, market, window, month } = ctx;
    const label = MARKET_LABEL[market] || market;
    const place = district || '桃園市';
    const t = ctx.trailing || null;
    const range = windowRange(month, window);
    const periodText = `近 ${window} 個月（${monthText(range.start)}至 ${monthText(range.end)}）`;
    const question = `${place}${label}房價多少？`;
    const n = t && isNum(t.sample_count) ? t.sample_count : 0;
    const sentences = [];
    const figures = { sample_count: n, window, start: range.start, end: range.end };

    if (!n || !isNum(t.p50_unit_price)) {
      sentences.push(n
        ? `${periodText}，${place}${label}有 ${fmtInt(n)} 筆成交但缺少可用單價，暫不提供行情摘要。`
        : `${periodText}，${place}${label}沒有有效成交登錄，暫不提供行情摘要。`);
      if (window < 36) sentences.push('可改選近 36 個月或切換市場別查看。');
      return finish();
    }
    // 樣本極少（1–4 筆）：只報筆數與中位數，不做分位、全市比較與結構判讀，避免以偏概全
    if (n < SAMPLE_MIN) {
      figures.per_month = Math.round(n / window * 10) / 10;
      figures.p50_unit = t.p50_unit_price; figures.p50_total = isNum(t.p50_total_price) ? t.p50_total_price : null;
      sentences.push(`${periodText}，${place}${label}僅有 ${fmtInt(n)} 筆有效成交，成交單價中位數為每坪 ${fmt1(t.p50_unit_price)} 萬元。`);
      sentences.push(`樣本少於 ${SAMPLE_MIN} 筆，不計算主力價位、全市比較與漲跌，數字僅反映個別成交。`);
      if (window < 36) sentences.push('可改選近 36 個月取得較完整的樣本。');
      return finish();
    }

    const perMonth = n / window;
    figures.per_month = Math.round(perMonth * 10) / 10;
    figures.p25_unit = t.p25_unit_price; figures.p50_unit = t.p50_unit_price; figures.p75_unit = t.p75_unit_price;
    figures.p50_total = t.p50_total_price; figures.p50_ping = t.p50_ping;

    // 1 量
    let s1 = `${periodText}，${place}${label}共有 ${fmtInt(n)} 筆有效成交，平均每月約 ${fmt1(perMonth)} 筆`;
    if (district && isNum(t.share_of_city)) s1 += `，占全市同期 ${fmt1(t.share_of_city)}%`;
    sentences.push(s1 + '。');

    // 2 價（P25/P50/P75）
    if (isNum(t.p25_unit_price) && isNum(t.p75_unit_price)) {
      if (fmt1(t.p25_unit_price) === fmt1(t.p75_unit_price))
        sentences.push(`成交單價中位數為每坪 ${fmt1(t.p50_unit_price)} 萬元，中間一半成交都集中在這個價位。`);
      else {
        let s2 = `成交單價中位數為每坪 ${fmt1(t.p50_unit_price)} 萬元，主力價位落在 ${fmt1(t.p25_unit_price)}～${fmt1(t.p75_unit_price)} 萬／坪（P25–P75）`;
        const spread = t.p25_unit_price > 0 ? t.p75_unit_price / t.p25_unit_price : null;
        if (spread != null && spread >= 1.8) s2 += `，高低價差達 ${spread.toFixed(1)} 倍，區內產品差異明顯`;
        sentences.push(s2 + '。');
      }
    } else sentences.push(`成交單價中位數為每坪 ${fmt1(t.p50_unit_price)} 萬元。`);

    // 3 與全市同期比較
    const vs = district ? versusCity(t) : null;
    figures.versus_city = vs;
    if (vs != null) {
      figures.city_p50_unit = t.city_median_unit_price;
      sentences.push(vs === 0
        ? `與桃園市同期中位數 ${fmt1(t.city_median_unit_price)} 萬／坪持平。`
        : `比桃園市同期中位數 ${fmt1(t.city_median_unit_price)} 萬／坪${vs > 0 ? '高' : '低'} ${pct(vs)}%。`);
    }

    // 4 總價與坪數
    if (isNum(t.p50_total_price)) {
      let s4 = `總價中位數 ${fmtInt(t.p50_total_price)} 萬元`;
      if (isNum(t.p25_total_price) && isNum(t.p75_total_price)) s4 += `，半數成交總價介於 ${fmtInt(t.p25_total_price)}～${fmtInt(t.p75_total_price)} 萬`;
      if (isNum(t.p50_ping)) s4 += `；建物坪數中位 ${fmt1(t.p50_ping)} 坪`;
      sentences.push(s4 + '。');
    }

    // 5 產品結構
    const types = topMix(t.type_mix, false);
    if (types.length) {
      const kind = market === 'presale' ? '房型' : '建物型態';
      let s5 = types.length === 1 || types[0].percentage >= 99.95
        ? `${kind}全部為${types[0].label}`
        : `${kind}以${types[0].label}為主（${fmt1(types[0].percentage)}%）`;
      if (types[1] && types[0].percentage < 99.95) s5 += `，其次為${types[1].label}（${fmt1(types[1].percentage)}%）`;
      sentences.push(s5 + '。');
    }

    // 6 單月走勢（只在完整登錄月且樣本足夠時判讀）
    const mo = ctx.monthly || {};
    if (!ctx.monthComplete) {
      sentences.push(`${monthText(month)}仍在登錄中，暫不做單月漲跌判讀。`);
    } else if ((mo.sample_count || 0) < SAMPLE_MIN) {
      sentences.push(`${monthText(month)}單月僅 ${fmtInt(mo.sample_count || 0)} 筆成交，暫不做單月漲跌判讀。`);
    } else if (isNum(mo.median_unit_price) && isNum(mo.year_over_year)) {
      const y = mo.year_over_year, flat = Math.abs(y) < 0.05;
      let s6 = `${monthText(month)}單月中位單價 ${fmt1(mo.median_unit_price)} 萬／坪，較去年同期${flat ? '持平' : `${y > 0 ? '上漲' : '下跌'} ${pct(y)}%`}`;
      if (Math.abs(y) >= 30) s6 += '（單月波動大，宜以期間值為準）';
      sentences.push(s6 + '。');
    }

    // 7 樣本提醒
    if (n < LOW_SAMPLE) sentences.push(`期間樣本僅 ${fmtInt(n)} 筆，數值易受個案影響，僅供參考。`);

    return finish();

    function finish() {
      const notes = buildNotes(ctx, t, n);
      return {
        version: VERSION,
        district: district || null,
        market, market_label: label, window, month,
        question,
        text: sentences.join(''),
        sentences,
        notes,
        figures
      };
    }
  }

  // 各分頁一句話註解
  function buildNotes(ctx, t, n) {
    const { district, market, window } = ctx;
    const place = district || '桃園市';
    const label = MARKET_LABEL[market] || market;
    const notes = {};

    if (n && n < SAMPLE_MIN && t && isNum(t.p50_unit_price)) {
      notes.overview = `近 ${window} 個月僅 ${fmtInt(n)} 筆成交（中位 ${fmt1(t.p50_unit_price)} 萬／坪），樣本不足以判讀主力價位。`;
    } else if (n && t && isNum(t.p50_unit_price)) {
      const vs = district ? versusCity(t) : null;
      notes.overview = vs == null
        ? `近 ${window} 個月中間一半成交落在 ${fmt1(t.p25_unit_price)}～${fmt1(t.p75_unit_price)} 萬／坪。`
        : `近 ${window} 個月中位單價 ${fmt1(t.p50_unit_price)} 萬／坪，${vs === 0 ? '與全市同期持平' : `${vs > 0 ? '高於' : '低於'}全市同期 ${pct(vs)}%`}。`;
    } else notes.overview = n ? `近 ${window} 個月缺少可用單價，暫無期間行情。` : `近 ${window} 個月沒有成交登錄，暫無期間行情。`;

    const series = (ctx.series || []).filter(x => x && isNum(x.sample_count));
    const priced = series.filter(x => isNum(x.median_unit_price) && x.sample_count >= SAMPLE_MIN);
    const active = series.filter(x => x.sample_count > 0).length;
    const gap = window - active;
    const gapText = gap > 0 ? `期間內有 ${gap} 個月無成交登錄` : '';
    if (series.length && priced.length) {
      const peak = series.slice().sort((a, b) => b.sample_count - a.sample_count || a.month.localeCompare(b.month))[0];
      const lo = Math.min(...priced.map(x => x.median_unit_price)), hi = Math.max(...priced.map(x => x.median_unit_price));
      const priceText = priced.length === 1 || fmt1(lo) === fmt1(hi)
        ? `圖中僅 ${monthText(priced[0].month)}樣本足夠，單月中位單價 ${fmt1(priced[0].median_unit_price)} 萬／坪`
        : `圖中樣本足夠（≥${SAMPLE_MIN} 筆）的月份，單月中位單價介於 ${fmt1(lo)}～${fmt1(hi)} 萬／坪`;
      notes.trend = `${priceText}；成交量最高為 ${monthText(peak.month)}的 ${fmtInt(peak.sample_count)} 件${gapText ? '；' + gapText : ''}。`;
    } else if (active) notes.trend = `近 ${window} 個月共 ${fmtInt(active)} 個月有成交，但單月樣本都少於 ${SAMPLE_MIN} 筆，走勢僅供參考。`;
    else notes.trend = `近 ${window} 個月沒有成交登錄，暫無走勢。`;

    const types = topMix(t && t.type_mix, false), floors = topMix(t && t.floor_mix, true);
    if (types.length && n < SAMPLE_MIN) notes.structure = `近 ${window} 個月僅 ${fmtInt(n)} 筆成交，產品組成不具代表性。`;
    else if (types.length) {
      let s = `${market === 'presale' ? '房型' : '建物型態'}以「${types[0].label}」占 ${fmt1(types[0].percentage)}% 最多`;
      if (floors.length) s += `，樓層以「${floors[0].label}」占 ${fmt1(floors[0].percentage)}% 最多`;
      notes.structure = s + '。';
    } else notes.structure = '近期樣本不足，暫無產品組成。';

    const projects = (ctx.projects || []).filter(p => p.count > 0);
    if (ctx.projects) {
      if (projects.length) {
        const top = projects.slice().sort((a, b) => b.count - a.count || (b.latest || '').localeCompare(a.latest || ''))[0];
        const nm = String(top.name).replace(/\?/g, '□');
        notes.projects = projects.length === 1
          ? `近 ${window} 個月只有「${nm}」1 個預售建案登錄簽約，共 ${fmtInt(top.count)} 筆。`
          : `近 ${window} 個月共有 ${fmtInt(projects.length)} 個預售建案登錄簽約，成交最多為「${nm}」${fmtInt(top.count)} 筆。`;
      } else notes.projects = `近 ${window} 個月${place}沒有預售建案簽約登錄。`;
    }

    const p = ctx.population;
    if (p && isNum(p.pop)) {
      let s = `${place}現住人口 ${fmtInt(p.pop)} 人、${fmtInt(p.households)} 戶，戶量 ${Number(p.ppl_per_hh).toFixed(2)} 人／戶`;
      if (n) s += `；近 ${window} 個月每千人${label}成交 ${fmt1(n / p.pop * 1000)} 件`;
      notes.population = s + '。';
    }
    return notes;
  }

  /*
   * 預售建案期間彙整（WP7）：data/presale_projects/<slug>.json 的每案 rows=[[yyyymmdd, 單價×100], ...]
   * 只含有效簽約（已排除解約），口徑與 snapshots 預售樣本相同。
   */
  function median(values) {
    if (!values.length) return null;
    const v = values.slice().sort((a, b) => a - b), mid = v.length >> 1;
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  }
  function aggregateProjects(file, month, window) {
    const { start, end } = windowRange(month, window);
    const lo = Number(start.replace('-', '')) * 100 + 1, hi = Number(end.replace('-', '')) * 100 + 31;
    const out = [];
    for (const p of (file && file.projects) || []) {
      const units = []; let latest = 0, count = 0;
      for (const r of p.rows) {
        if (r[0] < lo || r[0] > hi) continue;
        count++;
        if (r[1] != null) units.push(r[1] / 100);
        if (r[0] > latest) latest = r[0];
      }
      if (!count) continue;
      const m = median(units);
      const ds = String(latest);
      out.push({ name: p.name, pid: p.pid, names: p.names, pending: !!p.pending, count,
        latest: `${ds.slice(0, 4)}-${ds.slice(4, 6)}-${ds.slice(6, 8)}`, median: m == null ? null : Math.round(m * 10) / 10 });
    }
    out.sort((a, b) => b.count - a.count || b.latest.localeCompare(a.latest) || a.name.localeCompare(b.name));
    return out;
  }

  // 組裝摘要輸入：瀏覽器與 Node 共用，保證同一組資料得到同一段文字
  function context({ market, district, window, month, data, snapshot, presaleFile, population }) {
    const meta = data.markets[market].meta;
    const node = district ? ((snapshot && snapshot.districts) || {})[district] : (snapshot && snapshot.city);
    const seriesAll = (district ? data.markets[market].series.districts[district] : data.markets[market].series.city) || [];
    const { start } = windowRange(month, window);
    const status = (meta.month_status || {})[month];
    return {
      district, market, window, month,
      trailing: node ? node['trailing_' + window] : null,
      monthly: node || {},
      monthComplete: status ? status === 'complete' : true,
      series: seriesAll.filter(x => x.month >= start && x.month <= month),
      projects: presaleFile ? aggregateProjects(presaleFile, month, window) : undefined,
      population: population && district && population.districts[district]
        ? Object.assign({}, population.districts[district], { period: population.meta.period }) : undefined
    };
  }

  return { VERSION, SAMPLE_MIN, build, context, addMonths, windowRange, versusCity, monthText, median, aggregateProjects };
});
