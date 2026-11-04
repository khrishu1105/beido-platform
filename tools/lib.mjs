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

// 與前端一致的摘要輸入組裝（實作在 assets/summary.js）
export const summaryContext = args => Summary.context(args);
