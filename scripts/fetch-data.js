// Fetches the CNN Fear & Greed index and the S&P 500 index (^GSPC) for the
// trailing ~5 years, merges them by trading day, and upserts them into Neon.
//
// Runs on Node 20+ (built-in fetch). Invoked daily by
// .github/workflows/update-data.yml, and can be run by hand to re-seed:
//   node --env-file=.env.local scripts/fetch-data.js
// Needs DATABASE_URL (the pooled Neon connection string) in the environment.
//
// Design notes (see CLAUDE.md for the full gotchas):
//   - CNN returns HTTP 418 "I'm a teapot" without browser-like headers.
//   - Yahoo rate-limits (429) from datacenter IPs; we try query2 then query1.
//   - If either source fails or returns nothing, we throw and write NOTHING,
//     so a bad day never overwrites the known-good rows already in Neon.

const { neon } = require('@neondatabase/serverless');

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

// ---- Merge & upsert into Neon ----------------------------------------------

async function main() {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set (pull it with `vercel env pull .env.local`)');
  }

  const [fg, sp] = await Promise.all([fetchFearGreed(), fetchSP500()]);

  // Intersection by date: only keep days present in BOTH series.
  // Deduplicate by date (CNN occasionally returns duplicate entries for the same day —
  // last value wins, which matches how the Map-based spByDate dedup works for Yahoo).
  const spByDate = new Map(sp.map((r) => [r.d, r.sp500]));
  const rowsByDate = new Map();
  for (const r of fg) {
    if (spByDate.has(r.d)) rowsByDate.set(r.d, { d: r.d, fg: r.fg, sp500: spByDate.get(r.d) });
  }
  const rows = [...rowsByDate.values()].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));

  if (rows.length === 0) {
    throw new Error('No overlapping dates between Fear & Greed and S&P 500');
  }

  const sql = neon(connectionString);

  await sql.query(`
    CREATE TABLE IF NOT EXISTS daily_index (
      d          date PRIMARY KEY,
      fg         real        NOT NULL,
      sp500      numeric     NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  // One round trip: UNNEST three parallel arrays into rows, then upsert by date.
  // The WHERE clause leaves updated_at untouched on unchanged days (weekends /
  // holidays / re-runs), so it only moves when the market data actually changes.
  await sql.query(
    `INSERT INTO daily_index (d, fg, sp500)
     SELECT * FROM UNNEST($1::date[], $2::real[], $3::numeric[])
     ON CONFLICT (d) DO UPDATE
       SET fg = EXCLUDED.fg, sp500 = EXCLUDED.sp500, updated_at = now()
       WHERE daily_index.fg    IS DISTINCT FROM EXCLUDED.fg
          OR daily_index.sp500 IS DISTINCT FROM EXCLUDED.sp500`,
    [rows.map((r) => r.d), rows.map((r) => r.fg), rows.map((r) => r.sp500)]
  );

  console.log(
    `Upserted ${rows.length} rows (${rows[0].d} → ${rows[rows.length - 1].d}) into Neon`
  );
}

main().catch((err) => {
  console.error('fetch-data failed:', err.message);
  process.exit(1);
});
