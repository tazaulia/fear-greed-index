# Fear & Greed vs S&P 500

**Live → [fear-greed.taza.me](https://fear-greed.taza.me)**

A simple dashboard overlaying the **CNN Fear & Greed Index** against the
**S&P 500 index** over the past ~5 years. Updates itself once a day.

![chart](https://img.shields.io/badge/data-auto--updated%20daily-378ADD)

## How it stays up to date
A GitHub Action runs every day, pulls fresh numbers from CNN and Yahoo Finance,
and saves them into a **Neon Postgres** database. The page reads from that database
on the fly, so there are **no daily commits and no redeploys** — just fresh data.
No manual steps, no spreadsheets, no CSV downloads.

## Preview it locally
You need [Node.js](https://nodejs.org) (v20+) and the [Vercel CLI](https://vercel.com/docs/cli).

```bash
vercel env pull .env.local                          # grab the database URL once
node --env-file=.env.local scripts/fetch-data.js    # load the latest data
vercel dev                                          # serve the page + its data API
```
Open the URL `vercel dev` prints. (Use `vercel dev`, not a plain static server,
so the data endpoint runs.)

## Deploy
1. Push this repo to GitHub.
2. In Vercel: **New Project → import this repo**. Framework preset: **Other**.
   No build command.
3. Add a Neon database to the project (Storage → Neon) — it wires up the database
   URL automatically. Deploy. Done.

## Under the hood
- `index.html` — the whole page (chart logic + styling), draws from `/api/data`.
- `api/data.js` — tiny function that reads the data out of Neon.
- `scripts/fetch-data.js` — fetches and merges the two sources into Neon.
- `.github/workflows/update-data.yml` — the daily job.

No framework, no build step, no API keys.
