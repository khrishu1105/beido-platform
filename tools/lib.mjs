// 共用：讀資料、行政區代稱
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const require = createRequire(import.meta.url);
export const Summary = require(path.join(ROOT, 'assets/summary.js'));

export const SLUGS = {
  '中壢區': 'zhongli', '八德區': 'bade', '大園區': 'dayuan', '大溪區': 'daxi', '平鎮區': 'pingzhen',
  '復興區': 'fuxing', '新屋區': 'xinwu', '桃園區': 'taoyuan', '楊梅區': 'yangmei', '蘆竹區': 'luzhu',
  '觀音區': 'guanyin', '龍潭區': 'longtan', '龜山區': 'guishan'
};
export const DISTRICTS = Object.keys(SLUGS);
export const MARKETS = ['resale', 'presale'];
export const WINDOWS = [12, 24, 36];
export const SITE = 'https://beedoo.com.tw/';

export const readJSON = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
export function writeJSON(rel, obj, pretty = false) {
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, pretty ? 1 : 0) + '\n');
}
export function writeText(rel, text) {
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

// 與前端一致的摘要輸入組裝
export function summaryContext({ market, district, window, month, data, snapshot, presaleFile, population }) {
  const meta = data.markets[market].meta;
  const node = district ? (snapshot.districts || {})[district] : snapshot.city;
  const seriesAll = district ? data.markets[market].series.districts[district] : data.markets[market].series.city;
  const { start } = Summary.windowRange(month, window);
  const series = seriesAll.filter(x => x.month >= start && x.month <= month);
  return {
    district, market, window, month,
    trailing: node ? node['trailing_' + window] : null,
    monthly: node || {},
    monthComplete: (meta.month_status || {})[month] ? meta.month_status[month] === 'complete' : true,
    series,
    projects: presaleFile ? Summary.aggregateProjects(presaleFile, month, window) : undefined,
    population: population ? { ...population.districts[district], period: population.meta.period } : undefined
  };
}
