# tools/ — 建置與驗證

全部是 Node 腳本（Node 18+），不需要額外安裝套件；瀏覽器測試用環境內已安裝的 Playwright（`require('playwright')`）。
本資料夾已在 `_config.yml` 排除，不會被 GitHub Pages 公開。

## 資料更新後重建（本機排程 ETL 跑完後接這行）

```bash
node tools/build-all.mjs
```

依序執行：

| 腳本 | 作用 |
|---|---|
| `build-presale-projects.mjs` | `data/projects/*.json` →（只讀）→ `data/presale_projects/<slug>.json`（預售有效簽約、同案異名合併） |
| `build-summaries.mjs` | 以 `assets/summary.js` 產生 `data/summaries/<slug>_<market>_<window>.json` |
| `build-pages.mjs` | 由 `index.html` 產生 13 區 `district/<slug>/index.html`、首頁 SEO 區塊、`sitemap.xml`、`robots.txt` |
| `check-summaries.mjs` | 全月份 × 區 × 市場 × 期間跑模板：無 NaN/空句/矛盾；數字等於 snapshot；預售清單對帳、無同名重複 |
| `check-seo.mjs` | 14 頁 JSON-LD（Dataset/FAQPage/BreadcrumbList）必填欄位與 FAQ 可見性 |

> 注意：`build-pages.mjs` 會改寫 `index.html` 內 `<!--SEO-->` `<!--SSR-->` `<!--BOOT-->` 標記區塊，
> 修改 `index.html` 版面後也要重跑一次，讓 13 區頁同步。

## 瀏覽器測試（需要本機伺服器）

```bash
python3 -m http.server 8765
```

另開一個終端機：

```bash
node tools/qa/e2e.cjs            # 自動化測試（25 項）：每頁可開、無 console error、關鍵數字、分頁、網址、鍵盤、延遲載入、磁磚三態、無 JS
node tools/qa/audit.cjs http://localhost:8765/ /tmp/qa   # 全面 QA：14 頁 × 390/768/1280 × 每分頁，第二個參數給資料夾就輸出截圖
node tools/qa/perf.cjs           # 載入請求數／體積／時間
node tools/qa/contrast.mjs       # WCAG AA 色彩對比（讀 assets/app.css 的 :root 色票），不需伺服器
```

任一腳本失敗會以非 0 結束，可直接接進 CI 或本機排程。
