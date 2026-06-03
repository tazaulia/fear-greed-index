# Fear & Greed vs S&P 500

A simple dashboard overlaying the **CNN Fear & Greed Index** against the
**S&P 500 index** over the past ~5 years. Updates itself once a day.

![chart](https://img.shields.io/badge/data-auto--updated%20daily-378ADD)

## How it stays up to date
A GitHub Action runs every day, pulls fresh numbers from CNN and Yahoo Finance,
saves them into `data.json`, and commits the change. Vercel sees the commit and
redeploys automatically. No manual steps, no spreadsheets, no CSV downloads.

## Preview it locally
You need [Node.js](https://nodejs.org) (v20+) installed.

```bash
node scripts/fetch-data.js     # grab the latest data
python3 -m http.server 8000    # serve the folder
```
Open <http://localhost:8000>. (Use the local server — opening the file directly
won't let the page load `data.json`.)

## Deploy
1. Push this repo to GitHub.
2. In Vercel: **New Project → import this repo**. Framework preset: **Other**.
   No build command. Output directory: the repo root (leave default).
3. Deploy. Done — future daily data commits redeploy on their own.

## Under the hood
- `index.html` — the whole page (chart logic + styling), draws from `data.json`.
- `data.json` — the data, regenerated daily.
- `scripts/fetch-data.js` — fetches and merges the two sources.
- `.github/workflows/update-data.yml` — the daily job.

No framework, no build step, no API keys. See `CLAUDE.md` for the technical details
and data-source quirks.
