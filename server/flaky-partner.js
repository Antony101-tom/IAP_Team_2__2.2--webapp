// Stand-in partner for the Week 11 drill. Not part of MediTrac: run it on its own with `node flaky-partner.js`.
// Needs Node 18+ and Express (it is already in server/node_modules). Switch modes without restarting:
//   curl http://localhost:4000/__mode/slow     (ok | slow | flaky | error)
// Serves /artisans and /artisans/:id in the same shape as Find My Artisan, so MediTrac can point at it:
//   PARTNER_URL=http://localhost:4000  PARTNER_API_KEY=anything   (in server/.env)
const express = require('express');
const app = express();
let mode = 'ok'; // ok | slow | flaky | error
let calls = 0;
const artisans = [
  { id: 1, name: 'Achieng Otieno', trade: 'Plumbing', area: 'Embakasi', county: 'Nairobi', verified: true, busy: [] },
  { id: 2, name: 'Brian Mwangi', trade: 'Electrical', area: 'Westlands', county: 'Nairobi', verified: false, busy: [] },
];

app.get('/__mode/:m', (req, res) => { mode = req.params.m; calls = 0; res.json({ mode }); });

async function misbehave(req, res) {
  calls += 1;
  console.log(`GET ${req.path} (call ${calls}, mode ${mode})`);
  if (mode === 'slow') await new Promise((r) => setTimeout(r, 10000)); // answers after 10 seconds
  if (mode === 'flaky' && calls % 3 !== 0) { res.status(503).json({ message: 'Try again' }); return true; } // fails twice, then works
  if (mode === 'error') { res.status(500).json({ message: 'Internal error' }); return true; } // always fails
  return false;
}
app.get('/artisans', async (req, res) => { if (!(await misbehave(req, res))) res.json(artisans); });
app.get('/artisans/:id', async (req, res) => {
  if (await misbehave(req, res)) return;
  const a = artisans.find((x) => String(x.id) === req.params.id);
  return a ? res.json(a) : res.status(404).json({ message: 'Not found' });
});
app.listen(4000, () => console.log('Stand-in partner on http://localhost:4000'));
