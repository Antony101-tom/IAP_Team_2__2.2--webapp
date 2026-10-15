// Database access for MediTrac: PostgreSQL, hosted on Supabase (or any Postgres).
//
// The routes were written against a tiny "query" interface:
//     const [rows] = await pool.query('SELECT ... WHERE x = ?', [value]);        // SELECT
//     const [{ affectedRows }] = await pool.query('UPDATE ... WHERE x = ?', []);  // UPDATE / DELETE / INSERT
// and `pool.getConnection()` for transactions. This file provides exactly that on top of the `pg`
// library (it also turns each ? into the $1, $2... that PostgreSQL expects), so the routes did not
// need to change when the database moved to Supabase.
const dns = require('dns');
const { Pool, types } = require('pg');
require('dotenv').config();

// If a host has both IPv4 and IPv6 addresses, try IPv4 first. On many home networks IPv6 is advertised
// but does not actually work, and the connection then hangs until it times out. Supabase's pooler
// works over IPv4. (This only changes the ORDER: a host with only IPv6 still works.)
try {
  dns.setDefaultResultOrder('ipv4first');
} catch {
  /* very old Node versions: nothing to do */
}

// PostgreSQL returns NUMERIC (prices, distances) and BIGINT (counts) as strings. The API sends numbers.
types.setTypeParser(1700, (value) => parseFloat(value)); // numeric
types.setTypeParser(20, (value) => parseInt(value, 10)); // bigint, e.g. COUNT(*)

const connectionString = process.env.DATABASE_URL;

// Supabase only accepts encrypted connections. A database on this computer usually has no SSL.
// DB_SSL=true / false overrides the automatic choice.
function sslOption() {
  if (process.env.DB_SSL === 'false') return false;
  if (process.env.DB_SSL === 'true') return { rejectUnauthorized: false };
  try {
    const host = new URL(connectionString).hostname;
    return ['localhost', '127.0.0.1', '::1'].includes(host) ? false : { rejectUnauthorized: false };
  } catch {
    return false;
  }
}

const pgPool = new Pool({
  connectionString,
  ssl: sslOption(),
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// A pool must not crash the whole server when an idle connection drops
pgPool.on('error', (err) => console.error('[database] Idle connection error:', err.message));

// "WHERE a = ? AND b = ?"  ->  "WHERE a = $1 AND b = $2"
function toPostgres(sql) {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

async function run(executor, sql, params = []) {
  const result = await executor.query(toPostgres(sql), params);
  return result.command === 'SELECT' ? [result.rows] : [{ affectedRows: result.rowCount }];
}

const pool = {
  query: (sql, params) => run(pgPool, sql, params),

  // For transactions: one connection that stays checked out until release()
  async getConnection() {
    const client = await pgPool.connect();
    return {
      query: (sql, params) => run(client, sql, params),
      beginTransaction: () => client.query('BEGIN'),
      commit: () => client.query('COMMIT'),
      rollback: () => client.query('ROLLBACK'),
      release: () => client.release(),
    };
  },
};

module.exports = { pool, toPostgres };
