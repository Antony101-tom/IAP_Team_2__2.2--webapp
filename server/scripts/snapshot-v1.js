// Week 13: save what GET /api/pharmacies returns, to a file, using a fixed fake database.
// Run it BEFORE and AFTER adding v2, then diff the two files. Usage:
//   node scripts/snapshot-v1.js v1_before.json
//   node scripts/snapshot-v1.js v1_after.json
//   diff v1_before.json v1_after.json && echo "v1 unchanged"
const fs = require('fs');
const path = require('path');

process.env.JWT_SECRET = 'snapshot-secret';
process.env.API_KEYS = 'snapshot-key';
process.env.RATE_LIMIT_PER_MINUTE = '100000';
process.env.NODE_ENV = 'test'; // silences the request log

const FAKE_ROWS = [
  { id: 'a1', name: 'Wellness Pharmacy', phone: '0722000002', address: 'Tom Mboya Street, Nairobi', opening_hours: 'Daily 7am-10pm', latitude: -1.2833, longitude: 36.8219, in_stock_count: 3 },
  { id: 'b2', name: 'CityCare Chemist', phone: null, address: null, opening_hours: null, latitude: -1.29, longitude: 36.82, in_stock_count: 0 },
];

// Replace the database with the fake one before the app loads it
const dbPath = require.resolve('../db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool: { query: async () => [FAKE_ROWS] } } };

const request = require('supertest');
const app = require('../index');

(async () => {
  const out = process.argv[2] || 'v1_snapshot.json';
  const res = await request(app).get('/api/pharmacies').set('X-API-Key', 'snapshot-key');
  fs.writeFileSync(path.resolve(out), JSON.stringify({ status: res.status, body: res.body }, null, 2) + '\n');
  console.log(`saved ${out} (status ${res.status})`);
  process.exit(0);
})();
