// 資料更新後一次重建所有衍生檔（本機排程可在 ETL 完成後呼叫）：
//   node tools/build-all.mjs
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { ROOT } from './lib.mjs';

for (const step of ['build-presale-projects', 'build-summaries', 'build-pages', 'check-summaries', 'check-seo', 'qa/contrast']) {
  console.log(`▶ ${step}`);
  execFileSync(process.execPath, [path.join(ROOT, 'tools', `${step}.mjs`)], { stdio: 'inherit' });
}
