# CLAUDE.md — Fear & Greed vs S&P 500

## What this is
A single-page static dashboard that overlays the **CNN Fear & Greed Index** (0–100)
against the **S&P 500 index** (^GSPC) over the trailing ~5 years, with range buttons
(3m/6m/1y/2y/5y) and a light/dark toggle. Built with plain HTML + Chart.js (via CDN).
Personal dashboard, deployed on Vercel.

## How it works
```
.github/workflows/update-data.yml  (daily cron, 22:30 UTC + manual dispatch)
  → scripts/fetch-data.js  fetches CNN + Yahoo, merges by trading day
  → writes data.json, commits it
  → Vercel auto-deploys the new commit
index.html  → fetch('./data.json')  → Chart.js renders   (same-origin, no CORS)
```
There is **no build step, no framework, no serverless function, and no npm
dependency**. `scripts/fetch-data.js` runs on Node 20+ using the built-in `fetch`.

## Files
- `index.html` — markup + all chart logic. Reads `./data.json` at load.
- `data.json` — `{ updated, source, range, rows: [{ d, fg, sp500 }] }`. Generated; committed.
- `scripts/fetch-data.js` — the only data-fetching code.
- `.github/workflows/update-data.yml` — daily refresh.

## Run locally
```bash
node scripts/fetch-data.js          # refresh data.json
python3 -m http.server 8000         # then open http://localhost:8000
```
(Open over http://, not file://, so `fetch('./data.json')` works.)

## Data sources & gotchas (verified — do not "simplify" these away)
- **CNN Fear & Greed**: `https://production.dataviz.cnn.io/index/fearandgreed/graphdata/{YYYY-MM-DD}`
  where the date is ~5y ago. **Requires browser-like headers** (`User-Agent`,
  `Accept: application/json`, `Origin: https://www.cnn.com`, `Referer: https://www.cnn.com/`)
  or it returns **HTTP 418 "I'm a teapot. You're a bot."** Shape:
  `fear_and_greed_historical.data[]` = `{ x: epoch ms, y: score }`. History caps at
  ~5 years (older start dates return HTTP 500).
- **S&P 500 (^GSPC)**: `https://query2.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=1d&range=5y`
  with a `User-Agent`. Datacenter IPs get **HTTP 429** on `query1` — the script tries
  `query2` first, then `query1`. Shape: `chart.result[0].timestamp[]` (epoch **seconds**)
  + `indicators.quote[0].close[]` (some entries `null` → filtered).

## Conventions / what NOT to do
- **Never hardcode price/index data into `index.html` again** — it all comes from `data.json`.
  (The original prototype had ~1,260 rows inlined; that was the thing we removed.)
- The fetch script **fails loudly**: on any error it exits non-zero and writes nothing,
  so a bad run never overwrites a known-good `data.json`. Keep that behavior.
- Rows are the **date intersection** of the two series (only days present in both).
- To switch the price line back to the **SPY ETF** (~$759 scale) instead of the index,
  change the symbol in `fetch-data.js` from `%5EGSPC` to `SPY` and relabel in `index.html`.

## Deploy
Push to GitHub → connect the repo once in Vercel (framework preset **Other**, no build
command, output = repo root). Every push, including the daily `data: daily update`
commits, auto-deploys.
