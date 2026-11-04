// Sends a random mix of good requests, missing ids, requests with no key, and paths that don't exist,
// so there is something to see in the log and in /stats.
//
//   API=http://localhost:5000 KEY=<your-api-key> node scripts/traffic.js
//   API=https://meditrac-api.onrender.com KEY=<key> N=200 npm run traffic
//
// Your ring partner can run the same script against your URL with the key you issued them: their requests
// show up in your log with a different caller label from yours.
//
// Note the rate limit: 100 requests per key per minute. N=200 with a 50 ms pause is about 20 a second, so
// you will see 429s. That is data too.

const API = (process.env.API || 'http://localhost:5000').replace(/\/+$/, '');
const KEY = process.env.KEY;
const N = Number(process.env.N || 200);

if (!KEY) {
  console.error('Set KEY=<your API key>, e.g.  KEY=abc123 node scripts/traffic.js');
  process.exit(1);
}

const mix = [
  { method: 'GET', path: '/api/medications', key: true },
  { method: 'GET', path: '/api/medications', key: true },
  { method: 'GET', path: '/api/medications/search?name=para', key: true },
  { method: 'GET', path: '/api/medications/search?name=para&in_stock=true', key: true },
  { method: 'GET', path: '/api/pharmacies', key: true },
  { method: 'GET', path: '/api/pharmacies', key: true },
  { method: 'GET', path: '/api/pharmacies/00000000-0000-4000-8000-000000000000', key: true }, // no such id
  { method: 'GET', path: '/api/pharmacies', key: false },                                      // no key at all
  { method: 'GET', path: '/api/medications', key: false },                                     // no key at all
  { method: 'GET', path: '/not-a-route', key: true },                                          // no such path
];

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const counts = {};
  for (let i = 0; i < N; i++) {
    const r = mix[Math.floor(Math.random() * mix.length)];
    try {
      const res = await fetch(API + r.path, {
        method: r.method,
        headers: r.key ? { 'X-API-Key': KEY } : {},
      });
      counts[res.status] = (counts[res.status] || 0) + 1;
    } catch {
      counts.failed = (counts.failed || 0) + 1;
    }
    await pause(50);
  }
  console.log('Status codes received:', counts);
})();
