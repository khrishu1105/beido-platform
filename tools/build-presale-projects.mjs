// WP7：由 data/projects/*.json 產生 data/presale_projects/<slug>.json
// 只取有效預售簽約（term=0），每案 rows=[[yyyymmdd, 單價×100|null]]（無單價者計件不計中位，同 snapshots）。
// 建案名沿用 data/projects（已套用 project_aliases / name_quality_report 校正），
// 再做「顯示層」同案異名合併，不改動原始資料：
//   R1 字形正規化：悦/悅、鋭/銳、画/畫、双/雙、滙/匯、絵/繪、全半形、空白、大小寫
//   R2 建商字樣：「鼎巨建設La Vie」＝「鼎巨La Vie」（去除名稱中的「建設」）
//   R3 戶別代碼：同一基底下 ≥3 個「A1-03」「01-S3」型代碼名，視為同一建案的戶別登錄
//   R4 亂碼：名稱含「?」且在同區只唯一對應到一個已校正名稱時併入；否則標記待校正
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, SLUGS, readJSON, writeJSON } from './lib.mjs';

const index = readJSON('data/projects/index.json');
const nq = readJSON('data/name_quality_report.json');
const unresolved = new Set(nq.items.filter(i => !i.mapped).map(i => `${i.district}|${i.source_name}`));

const GLYPH = { '悦': '悅', '鋭': '銳', '画': '畫', '双': '雙', '滙': '匯', '絵': '繪', '臺': '台' };
const norm = s => s.normalize('NFKC').replace(/[悦鋭画双滙絵臺]/g, c => GLYPH[c]).replace(/\s+/g, '').toLowerCase();
const normDev = s => norm(s).replace(/建設/g, '');
const UNIT_CODE = /^(.+?)[-‐]?([a-z]{0,2}\d{1,2}-[a-z]?\d{1,3})$/i;

const report = { generated_from: 'data/projects', rules: ['R1 字形/空白/大小寫正規化', 'R2 去除「建設」字樣', 'R3 同基底≥3 個戶別代碼名合併', 'R4 含「?」唯一對應合併'], merges: [], pending: [] };
let totalRows = 0;

for (const district of Object.keys(SLUGS)) {
  const list = index.districts[district] || [];
  const items = [];
  for (const p of list) {
    if (!p.ps) continue;
    const det = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/projects', p.pid + '.json'), 'utf8'));
    const rows = det.presale.filter(r => !r.term && r.date)
      .map(r => [Number(r.date.replace(/-/g, '')), r.unit == null ? null : Math.round(r.unit * 100)]).sort((a, b) => a[0] - b[0]);
    if (!rows.length) continue;
    items.push({ pid: p.pid, name: p.name, rows, key: normDev(p.name) });
  }

  // R3：戶別代碼基底
  const baseCount = {};
  for (const it of items) { const m = norm(it.name).match(UNIT_CODE); if (m) baseCount[normDev(m[1])] = (baseCount[normDev(m[1])] || 0) + 1; }
  for (const it of items) {
    const m = it.name.normalize('NFKC').match(UNIT_CODE);
    if (m && baseCount[normDev(m[1])] >= 3) { it.key = normDev(m[1]); it.baseName = m[1].replace(/[-‐\s]+$/, ''); }
  }
  // R4：含 ? 的名稱
  const cleanKeys = [...new Set(items.filter(it => !it.name.includes('?')).map(it => it.key))];
  for (const it of items.filter(it => it.name.includes('?'))) {
    const re = new RegExp('^' + normDev(it.name).split('?').map(x => x.replace(/[.*+^${}()|[\]\\]/g, '\\$&')).join('.') + '$');
    const hits = cleanKeys.filter(k => re.test(k));
    if (hits.length === 1) it.key = hits[0];
    else it.pending = true;
  }

  const groups = new Map();
  for (const it of items) { if (!groups.has(it.key)) groups.set(it.key, []); groups.get(it.key).push(it); }
  const projects = [];
  for (const g of groups.values()) {
    g.sort((a, b) => b.rows.length - a.rows.length);
    const clean = g.filter(x => !x.name.includes('?'));
    const lead = clean[0] || g[0];
    const name = lead.baseName || lead.name;
    const rows = g.flatMap(x => x.rows).sort((a, b) => a[0] - b[0]);
    totalRows += rows.length;
    const pending = !clean.length;
    const entry = { name, pid: lead.pid, rows };
    if (g.length > 1) { entry.names = g.map(x => x.name); entry.pids = g.map(x => x.pid); report.merges.push({ district, name, from: entry.names }); }
    if (pending) { entry.pending = true; report.pending.push({ district, name, unresolved: unresolved.has(`${district}|${name}`) }); }
    projects.push(entry);
  }
  projects.sort((a, b) => b.rows.length - a.rows.length);
  writeJSON(`data/presale_projects/${SLUGS[district]}.json`, { district, projects });
}
writeJSON('data/presale_projects/_merge_report.json', report, true);
console.log(`presale_projects: rows=${totalRows} merges=${report.merges.length} pending=${report.pending.length}`);
