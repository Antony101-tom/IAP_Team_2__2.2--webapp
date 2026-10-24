// Runs once when the server starts and says, in plain words, whether the database is ready.
// Most "Server error during login/registration" messages in the browser come from one of the
// problems reported here, and the real reason is otherwise only visible in this terminal.
const { pool } = require('./db');
const { describeError, errorCode } = require('./errors');

// Tables the API needs, and columns that must exist in them
const REQUIRED = {
  users: ['id', 'name', 'email', 'password_hash'],
  pharmacies: ['id', 'name', 'email', 'password_hash', 'phone', 'address', 'opening_hours', 'latitude', 'longitude'],
  medications: ['id', 'name', 'form', 'category', 'quantity', 'unit', 'price', 'branch', 'sku', 'pharmacy_id'],
  tracked_medications: ['user_id', 'medication_id'],
};

function connectionHint(err) {
  const code = errorCode(err);
  const message = String(err.message || '');
  if (!process.env.DATABASE_URL) {
    return 'DATABASE_URL is not set. Copy server/.env.example to server/.env and paste your Supabase connection string into it (see HOSTING.md).';
  }
  if (message.includes('Tenant or user not found')) {
    return 'The username in DATABASE_URL is wrong. With Supabase\'s pooler it looks like  postgres.YOUR-PROJECT-REF . Copy the whole connection string again from Supabase (Project Settings > Database).';
  }
  // pg's own 10 second connection limit has no error code, only this message
  if (code === 'ETIMEDOUT' || /connection timeout|timed out/i.test(message)) {
    let host = 'YOUR-HOST';
    let port = '5432';
    try {
      const url = new URL(process.env.DATABASE_URL);
      host = url.hostname;
      port = url.port || '5432';
    } catch {
      /* keep the placeholders */
    }
    const other = port === '5432' ? '6543' : '5432';
    return (
      `The database did not answer within 10 seconds. This usually means your network (school or work Wi-Fi, some internet providers, a VPN or a firewall) blocks port ${port}. ` +
      `Test it in PowerShell:  Test-NetConnection ${host} -Port ${port}  . If it says TcpTestSucceeded : False, try port ${other} in DATABASE_URL, ` +
      'a different network (for example your phone\'s hotspot), or turn the VPN off. Also make sure you copied the "Session pooler" string, not "Direct connection". ' +
      'If that test says True but this still fails, run  npm run check:db  to see exactly which step stalls.'
    );
  }
  switch (code) {
    case '28P01':
      return 'Wrong database password in DATABASE_URL. In Supabase use Project Settings > Database > Reset database password, then put the new password into DATABASE_URL (replace [YOUR-PASSWORD] and remove the square brackets; encode special characters like @ as %40).';
    case 'ENOTFOUND':
      return 'The address in DATABASE_URL was not found. Copy the connection string again from Supabase (Project Settings > Database > Connection string).';
    case 'ECONNREFUSED':
      return 'The database is not accepting connections at the address in DATABASE_URL. For a database on this computer, start PostgreSQL. For Supabase, re-copy the connection string and check the port.';
    case '3D000':
      return 'The database name in DATABASE_URL does not exist. Supabase\'s is called  postgres .';
    case '28000':
      return 'The database refused this user. Re-copy the connection string from Supabase.';
    default:
      return 'Check DATABASE_URL in server/.env (HOSTING.md explains where to find it).';
  }
}

async function checkDatabase() {
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    console.error(`\n[database] Could not connect to the database: ${describeError(err)}`);
    console.error(`[database] ${connectionHint(err)}\n`);
    return false;
  }

  const [rows] = await pool.query(
    "SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = 'public'"
  );
  const columns = {};
  for (const { t, c } of rows) (columns[t.toLowerCase()] ||= new Set()).add(c.toLowerCase());

  const problems = [];
  for (const [table, needed] of Object.entries(REQUIRED)) {
    if (!columns[table]) {
      problems.push(`The table "${table}" is missing. Run schema.sql in the Supabase SQL Editor (see HOSTING.md).`);
      continue;
    }
    const missing = needed.filter((col) => !columns[table].has(col));
    if (missing.length > 0) {
      problems.push(
        `The table "${table}" has no ${missing.map((m) => `"${m}"`).join(', ')} column. ` +
          'It was created by an older version of schema.sql. Run the current schema.sql (see HOSTING.md), or drop that table first if it holds nothing you need.'
      );
    }
  }

  if (problems.length > 0) {
    console.error('\n[database] Connected, but the database is not set up correctly:');
    problems.forEach((p) => console.error(`[database]  - ${p}`));
    console.error('[database] Until that is fixed, logins and other requests will fail with "Server error".\n');
    return false;
  }

  console.log('[database] Connected. The tables are ready.');
  return true;
}

module.exports = { checkDatabase, connectionHint };
