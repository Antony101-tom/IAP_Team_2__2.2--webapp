// Runs once when the server starts and says, in plain words, whether the database is ready.
// Most "Server error during login/registration" messages in the browser come from one of the
// problems reported here, and the real reason is otherwise only visible in this terminal.
const { pool } = require('./db');
const { describeError, errorCode } = require('./errors');

// Tables the API needs, and the columns that were added after the first version of schema.sql
const REQUIRED = {
  users: [],
  pharmacies: ['phone', 'address', 'opening_hours'],
  medications: ['sku'],
  tracked_medications: [],
};

function connectionHint(err, dbName) {
  switch (errorCode(err)) {
    case 'ECONNREFUSED':
      return 'MySQL is not running (or DB_HOST / DB_PORT in server/.env is wrong). Start MySQL (in XAMPP, click Start next to MySQL), then restart this server.';
    case 'ER_ACCESS_DENIED_ERROR':
      return 'The DB_USER or DB_PASSWORD in server/.env is wrong. XAMPP\'s "root" user has no password, so use an empty one:  DB_PASSWORD=';
    case 'ER_BAD_DB_ERROR':
      return `The database "${dbName}" does not exist. Create it by running schema.sql (see the README), or fix DB_NAME in server/.env.`;
    case 'ENOTFOUND':
      return 'DB_HOST in server/.env is not a known address. For MySQL on this computer use:  DB_HOST=localhost';
    default:
      return 'Check the DB_* settings in server/.env and that MySQL is running.';
  }
}

async function checkDatabase() {
  const dbName = process.env.DB_NAME || 'meditrac';

  try {
    await pool.query('SELECT 1');
  } catch (err) {
    console.error(`\n[database] Could not connect to MySQL: ${describeError(err)}`);
    console.error(`[database] ${connectionHint(err, dbName)}\n`);
    return false;
  }

  const [rows] = await pool.query(
    'SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = ?',
    [dbName]
  );
  const columns = {};
  for (const { t, c } of rows) (columns[t.toLowerCase()] ||= new Set()).add(c.toLowerCase());

  const problems = [];
  for (const [table, needed] of Object.entries(REQUIRED)) {
    if (!columns[table]) {
      problems.push(`The table "${table}" is missing. Run schema.sql (see the README).`);
      continue;
    }
    const missing = needed.filter((col) => !columns[table].has(col));
    if (missing.length > 0) {
      problems.push(
        `The table "${table}" has no ${missing.map((m) => `"${m}"`).join(', ')} column. ` +
          'Your database was created before this feature. Run migration_partner_api.sql once (see the README).'
      );
    }
  }

  if (problems.length > 0) {
    console.error(`\n[database] Connected to "${dbName}", but it is not set up correctly:`);
    problems.forEach((p) => console.error(`[database]  - ${p}`));
    console.error('[database] Until that is fixed, logins and other requests will fail with "Server error".\n');
    return false;
  }

  console.log(`[database] Connected. "${dbName}" is ready.`);
  return true;
}

module.exports = { checkDatabase };
