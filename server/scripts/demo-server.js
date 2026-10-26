// Starts the REAL API (real middleware, real routes) with a stand-in database that returns empty
// lists, so you can try authentication and rate limiting with curl without a database.
//
//   API_KEYS=<key> RATE_LIMIT_PER_MINUTE=3 JWT_SECRET=x node scripts/demo-server.js
//
// Then, from another terminal (see SECURITY_AUDIT.md for the exact commands):
//   curl -i http://localhost:5055/api/pharmacies                      -> 401
//   curl -i -H "X-API-Key: <key>" http://localhost:5055/api/pharmacies -> 200 200 200 429 429 (limit 3)
//
// Not for production: it never talks to a real database.
const path = require('path');
const dbPath = require.resolve(path.join(__dirname, '..', 'db'));
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: { pool: { query: async () => [[]] } },
};
const app = require('../index');
const PORT = process.env.DEMO_PORT || 5055;
app.listen(PORT, () => console.log(`Demo server on http://localhost:${PORT} (stand-in database, real auth and rate limiting)`));
