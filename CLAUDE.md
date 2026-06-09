# CLAUDE.md — Fear & Greed vs S&P 500

## What this is
A single-page dashboard that overlays the **CNN Fear & Greed Index** (0–100)
against the **S&P 500 index** (^GSPC) over the trailing ~5 years, with range buttons
(3m/6m/1y/2y/5y). Plain HTML + Chart.js (via CDN) for the page; the data lives in
**Neon Postgres** and is served by one read-only Vercel function. Personal dashboard,
deployed on Vercel.

## Visual design
Styled after The Economist's editorial language — light-only (no dark mode), pure white
canvas, red (`#e3120b`) 2px top rule on `<main>`, Source Serif 4 for the headline, Source
Sans 3 for all chrome. Key CSS variables are declared in `:root` (`--canvas`, `--ink`,
`--body-grey`, `--hairline`, `--red`, `--fg`, `--sp`) — chart colours are read from these
at draw time via `getComputedStyle`, so changing a token flows through everywhere.

The page has three indicator stats above the chart (Previous close / One week ago / One
month ago), populated from the `/api/data` rows without any extra fetch. Default time
range is **1y**. Dates are formatted `en-GB` throughout. A "What is the Fear & Greed Index?"
link opens an explainer `<dialog>` modal (markup + logic inline in `index.html`).

## How it works
```
.github/workflows/update-data.yml  (daily cron, 22:30 UTC + manual dispatch)
  → scripts/fetch-data.js  fetches CNN + Yahoo, merges by trading day
  → UPSERTs the rows into Neon Postgres  (no git commit, no deploy)

index.html  → fetch('/api/data')  → Chart.js renders
  api/data.js  (Vercel function)  → SELECT from Neon → JSON (CDN-cached)
```
The whole point of this design: **the daily refresh no longer commits anything, so it
no longer triggers a Vercel deploy.** The data lives in Neon; the site reads it at
request time. There is no build step and no framework, but there is now one serverless
function (`api/data.js`) and one npm dependency (`@neondatabase/serverless`, used by
both the function and the fetch script). `scripts/fetch-data.js` runs on Node 20+.

**Connection string:** both the function and the script read
`process.env.DATABASE_URL` (fall back to `POSTGRES_URL`) — the pooled Neon URL. On
Vercel it's auto-injected by the Neon integration; in GitHub Actions it's the
`DATABASE_URL` repo secret; locally, pull it with `vercel env pull .env.local`.

**Schema** (one table, created by `fetch-data.js` via `CREATE TABLE IF NOT EXISTS`):
`daily_index (d date PK, fg real, sp500 numeric, updated_at timestamptz default now())`.
The upsert only bumps `updated_at` when a day's values actually change.

## Analytics
**Vercel Web Analytics** — two `<script>` tags in `index.html`'s `<head>` (a `window.va`
stub + a deferred `/_vercel/insights/script.js`). No npm package; Vercel's edge serves the
script at deploy time, so it only works on the deployed site and must be enabled in the
dashboard (Project → Analytics). Locally that path 404s — harmless.

## SEO / crawler files
The site is indexable; `index.html`'s `<head>` carries meta description, canonical, and
Open Graph + Twitter card tags. The production URL `https://fear-greed.taza.me/` is
**hardcoded in three places** — the `<head>` tags (canonical + `og:`/`twitter:`),
`robots.txt` (the `Sitemap:` line), and `sitemap.xml` (`<loc>`). If the domain ever
changes, update all three. `og-image.png` is the 1200×630 social card.

## Files
- `index.html` — markup + all chart logic. Fetches `/api/data` at load. Also carries the
  Vercel Web Analytics scripts (see Analytics above).
- `api/data.js` — read-only Vercel function. `SELECT`s from Neon and returns
  `{ updated, source, range, rows: [{ d, fg, sp500 }] }` (the shape the page expects),
  with a CDN `Cache-Control` header. Casts `d::text` + `sp500::float8` so the JSON
  matches what the chart needs.
- `scripts/fetch-data.js` — the only data-fetching code; upserts into Neon.
- `package.json` / `package-lock.json` — the single `@neondatabase/serverless` dep.
- `.github/workflows/update-data.yml` — daily refresh (upsert only; no commit).
- `robots.txt`, `sitemap.xml`, `og-image.png` — SEO/crawler assets (see SEO section).
- `favicon/` — icon set + `site.webmanifest`, linked from `index.html`'s `<head>`.

## Run locally
```bash
vercel env pull .env.local                          # get DATABASE_URL once
node --env-file=.env.local scripts/fetch-data.js    # refresh the rows in Neon
vercel dev                                          # serve page + /api/data together
```
Use `vercel dev` (not `python3 -m http.server`) so the `/api/data` function runs.

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
- **Never hardcode price/index data into `index.html`** — it all comes from `/api/data`,
  which reads Neon. (The original prototype had ~1,260 rows inlined; that was removed.)
- The fetch script **fails loudly**: on any error it exits non-zero *before* touching the
  DB, so a bad run never overwrites the known-good rows already in Neon. Keep that.
- The upsert is **idempotent** (keyed on `d`) and only bumps `updated_at` when values
  change — re-running on a weekend/holiday is a no-op. Keep that behavior.
- Rows are the **date intersection** of the two series (only days present in both).
- To switch the price line back to the **SPY ETF** (~$759 scale) instead of the index,
  change the symbol in `fetch-data.js` from `%5EGSPC` to `SPY` and relabel in `index.html`.

## Deploy
Push to GitHub → connect the repo once in Vercel (framework preset **Other**, no build
command). Vercel auto-installs the npm dep and builds the `api/` function. The Neon
integration injects `DATABASE_URL`. The daily GitHub Action upserts into Neon and does
**not** commit — so it does **not** deploy. Code pushes still auto-deploy as normal.
