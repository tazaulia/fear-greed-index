// Read-only endpoint the page fetches at load. Returns every row from Neon in
// the same shape the site used to read from data.json:
//   { updated, source, range, rows: [{ d, fg, sp500 }] }
// The frontend slices by range client-side, so we hand back the full series.
//
// Casts in SQL matter: Postgres returns `numeric` as a string and `date` as a
// Date, but the chart does arithmetic on sp500 and string-compares d — so we
// emit d::text ('YYYY-MM-DD') and sp500::float8 (a JS number).

const { neon } = require('@neondatabase/serverless');

const SOURCE = {
  fearGreed: 'CNN Business (production.dataviz.cnn.io)',
  sp500: 'Yahoo Finance ^GSPC',
};

module.exports = async (req, res) => {
  try {
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set');

    const sql = neon(connectionString);
    const rows = await sql`
      SELECT d::text AS d, fg, sp500::float8 AS sp500
      FROM daily_index
      ORDER BY d
    `;
    if (!rows.length) {
      res.status(503).json({ error: 'No data yet' });
      return;
    }
    const [{ updated }] = await sql`SELECT max(updated_at) AS updated FROM daily_index`;

    // Data changes at most once a day — let Vercel's CDN serve it from cache.
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    res.status(200).json({
      updated,
      source: SOURCE,
      range: { start: rows[0].d, end: rows[rows.length - 1].d, count: rows.length },
      rows,
    });
  } catch (err) {
    console.error('/api/data failed:', err);
    res.status(500).json({ error: 'Failed to load data' });
  }
};
