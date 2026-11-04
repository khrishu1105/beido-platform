// WCAG 2.1 對比檢查：墨藍金配色中所有「文字色 × 背景色」組合
// 一般文字需 ≥ 4.5:1；大字（≥24px 或 ≥18.66px 粗體）與非文字圖形需 ≥ 3:1
// 用法：node tools/qa/contrast.mjs   （讀 assets/app.css 的 :root 變數）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const css = fs.readFileSync(path.join(ROOT, 'assets/app.css'), 'utf8');
const root = css.match(/:root\s*{([\s\S]*?)}/)[1];
const V = Object.fromEntries([...root.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,8})/g)].map(m => [m[1], m[2]]));
const hex = h => { h = h.replace('#', ''); if (h.length === 3) h = [...h].map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const lum = c => { const [r, g, b] = hex(c).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
const c = k => V[k] || k;

// [用途, 前景, 背景, 等級 'text'|'large'|'ui']
export const PAIRS = [
  ['內文 ink / paper', 'ink', 'paper', 'text'],
  ['次要文字 muted / paper', 'muted', 'paper', 'text'],
  ['次要文字 muted / white(卡片)', 'muted', 'white', 'text'],
  ['次要文字 muted / paper-deep(方法區)', 'muted', 'paper-deep', 'text'],
  ['區塊小標 kicker gold-text / paper', 'gold-text', 'paper', 'text'],
  ['區塊小標 kicker gold-text / white', 'gold-text', 'white', 'text'],
  ['連結/標籤 gold-deep / white', 'gold-deep', 'white', 'text'],
  ['漲 rust / white', 'rust', 'white', 'text'],
  ['跌 teal / white', 'teal', 'white', 'text'],
  ['漲 rust / paper', 'rust', 'paper', 'text'],
  ['跌 teal / paper', 'teal', 'paper', 'text'],
  ['Hero 白字 white / night', 'white', 'night', 'text'],
  ['Hero 金字 gold-light / night', 'gold-light', 'night', 'text'],
  ['Hero 內文 hero-copy / night', 'hero-copy', 'night', 'text'],
  ['Hero 註記 hero-dim / night', 'hero-dim', 'night', 'text'],
  ['深底表頭 hero-dim / night', 'hero-dim', 'night', 'text'],
  ['選中按鈕 white / night', 'white', 'night', 'text'],
  ['本區磁磚標籤 night / gold-light', 'night', 'gold-light', 'text'],
  ['圖表軸字 axis / white', 'axis', 'white', 'text'],
  ['選中底線／卡片頂線 gold-deep / paper（非文字）', 'gold-deep', 'paper', 'ui'],
  ['裝飾金線 gold / night（非文字）', 'gold', 'night', 'ui'],
  ['圖表折線 navy / white（非文字）', 'navy', 'white', 'ui'],
  ['焦點框 focus / paper（非文字）', 'focus', 'paper', 'ui'],
  ['焦點框 focus / night（非文字）', 'focus-dark', 'night', 'ui'],
];
let fails = 0;
for (const [label, fg, bg, level] of PAIRS) {
  if (!V[fg] && !fg.startsWith('#')) { console.log(`?? ${label}: --${fg} 未定義`); fails++; continue; }
  const r = ratio(c(fg), c(bg)), need = level === 'text' ? 4.5 : 3;
  const ok = r >= need; if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${r.toFixed(2).padStart(5)}:1 (≥${need}) ${label}  ${c(fg)} on ${c(bg)}`);
}
console.log(`contrast pairs=${PAIRS.length} fails=${fails}`);
process.exit(fails ? 1 : 0);
