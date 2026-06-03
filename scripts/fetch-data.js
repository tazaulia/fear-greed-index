// Fetches the CNN Fear & Greed index and the S&P 500 index (^GSPC) for the
// trailing ~5 years, merges them by trading day, and writes data.json.
//
// Runs on Node 20+ (built-in fetch, no npm dependencies). Invoked daily by
// .github/workflows/update-data.yml, and can be run by hand to re-seed:
//   node scripts/fetch-data.js
//
// Design notes (see CLAUDE.md for the full gotchas):
//   - CNN returns HTTP 418 "I'm a teapot" without browser-like headers.
//   - Yahoo rate-limits (429) from datacenter IPs; we try query2 then query1.
//   - If either source fails or returns nothing, we throw and write NOTHING,
//     so a bad day never overwrites a known-good data.json.

const fs = require('fs');
const path = require('path');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
const toDate = (ms) => new Date(ms).toISOString().slice(0, 10);

// ---- CNN Fear & Greed -------------------------------------------------------

async function fetchFearGreed() {
  const start = new Date();
  start.setFullYear(start.getFullYear() - 5);
  const startStr = start.toISOString().slice(0, 10);

  const res = await fetch(
    `https://production.dataviz.cnn.io/index/fearandgreed/graphdata/${startStr}`,
    {
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
        Origin: 'https://www.cnn.com',
        Referer: 'https://www.cnn.com/',
      },
    }
  );
  if (!res.ok) throw new Error(`CNN fetch failed: HTTP ${res.status}`);

  const json = await res.json();
  const points = json?.fear_and_greed_historical?.data;
  if (!Array.isArray(points) || points.length === 0) {
    throw new Error('CNN returned no Fear & Greed data');
  }
  // { x: epoch ms, y: score 0-100 } -> { d, fg }
  return points.map((p) => ({ d: toDate(p.x), fg: round1(p.y) }));
}

// ---- Yahoo Finance S&P 500 (^GSPC) -----------------------------------------

async function fetchSP500() {
  const symbol = '%5EGSPC'; // ^GSPC, URL-encoded
  const hosts = ['query2.finance.yahoo.com', 'query1.finance.yahoo.com'];

  let json;
  let lastErr;
  for (const host of hosts) {
    try {
      const res = await fetch(
        `https://${host}/v8/finance/chart/${symbol}?interval=1d&range=5y`,
        { headers: { 'User-Agent': UA } }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      json = await res.json();
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!json) throw new Error(`Yahoo fetch failed: ${lastErr?.message}`);

  const result = json?.chart?.result?.[0];
  const timestamps = result?.timestamp;
  const closes = result?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(timestamps) || !Array.isArray(closes)) {
    throw new Error('Yahoo returned no S&P 500 data');
  }

  // timestamp is epoch SECONDS; some closes can be null -> drop them.
  const rows = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (closes[i] == null) continue;
    rows.push({ d: toDate(timestamps[i] * 1000), sp500: round2(closes[i]) });
  }
  if (rows.length === 0) throw new Error('Yahoo returned only null closes');
  return rows;
}

// ---- Merge & write ----------------------------------------------------------

async function main() {
  const [fg, sp] = await Promise.all([fetchFearGreed(), fetchSP500()]);

  // Intersection by date: only keep days present in BOTH series.
  const spByDate = new Map(sp.map((r) => [r.d, r.sp500]));
  const rows = fg
    .filter((r) => spByDate.has(r.d))
    .map((r) => ({ d: r.d, fg: r.fg, sp500: spByDate.get(r.d) }))
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));

  if (rows.length === 0) {
    throw new Error('No overlapping dates between Fear & Greed and S&P 500');
  }

  const outPath = path.join(__dirname, '..', 'data.json');

  // Skip the write entirely if the actual market data is unchanged (e.g. on
  // weekends/holidays). Only the `rows` are compared — the `updated` timestamp
  // is intentionally ignored so it can't trigger a needless daily commit/deploy.
  if (fs.existsSync(outPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      if (JSON.stringify(prev.rows) === JSON.stringify(rows)) {
        console.log(`No change — ${rows.length} rows unchanged, leaving data.json as is`);
        return;
      }
    } catch {
      // Unreadable/corrupt existing file — fall through and overwrite it.
    }
  }

  const out = {
    updated: new Date().toISOString(),
    source: {
      fearGreed: 'CNN Business (production.dataviz.cnn.io)',
      sp500: 'Yahoo Finance ^GSPC',
    },
    range: { start: rows[0].d, end: rows[rows.length - 1].d, count: rows.length },
    rows,
  };

  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
  console.log(
    `Wrote ${rows.length} rows (${rows[0].d} → ${rows[rows.length - 1].d}) to data.json`
  );
}

main().catch((err) => {
  console.error('fetch-data failed:', err.message);
  process.exit(1);
});
