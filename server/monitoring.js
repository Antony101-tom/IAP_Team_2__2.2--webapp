// Week 12: request logging and running totals.
//
//  - monitor      one JSON line per finished request (the log: WHAT happened)
//  - statsHandler GET /stats, running totals since the server started (the numbers: HOW MUCH)
//
// What is logged: time, method, path, status, response time, and a short label for the caller.
// What is NEVER logged: API keys or tokens (not even partly), passwords, request or response bodies, query strings.
//
// Honest limit: the totals live in this server's memory. They reset on every restart and would be wrong
// across several copies of the server. Production systems send them to a shared monitoring tool.

const round = (n) => Math.round(n * 10) / 10;

function freshStats() {
  return {
    startedAt: new Date().toISOString(),
    total: 0,
    clientErrors: 0, // 4xx: usually the caller's mistake
    serverErrors: 0, // 5xx: our fault
    totalMs: 0,
    routes: {},
    partner: { calls: 0, failures: 0 }, // Find My Artisan: how often is the partner really failing?
  };
}
let stats = freshStats();

function newRoute() {
  return { count: 0, clientErrors: 0, serverErrors: 0, totalMs: 0, maxMs: 0 };
}

// A label for who called, without ever writing the key itself. requireApiKey (middleware/apiKey.js) sets
// req.apiKeyId, which is already a one-way hash of the key, and only for a VALID key. Six characters of it
// tell callers apart; nobody can get the key back from it. Wrong or missing key -> "none".
function who(req) {
  return req.apiKeyId ? `key-${String(req.apiKeyId).slice(0, 6)}` : 'none';
}

// Jest runs the whole API in tests; one log line per test request would bury the results.
const logging = () => process.env.NODE_ENV !== 'test' || process.env.MONITOR_LOG === 'true';

function monitor(req, res, next) {
  const start = process.hrtime.bigint();
  // Read the path NOW, before any router runs: inside a router Express strips the mount prefix
  // (/api/medications -> /), so reading it later would log "/" for everything. req.path has no query string.
  const path = req.path;

  res.on('finish', () => { // after the response is sent, so status and timing are final
    const ms = Number(process.hrtime.bigint() - start) / 1e6;

    if (logging()) {
      console.log(JSON.stringify({
        time: new Date().toISOString(),
        method: req.method,
        path,
        status: res.statusCode,
        ms: round(ms),
        caller: who(req),
      }));
    }

    // Group by route PATTERN: /api/pharmacies/abc and /api/pharmacies/xyz both become GET /api/pharmacies/:id.
    // (Grouping by the raw path would make every id its own row and the list would grow forever.)
    // (a router's root route is '/', which would print as "/api/pharmacies/": drop that trailing slash)
    const route = req.route ? (req.baseUrl + req.route.path).replace(/(.)\/$/, '$1') : '(no route)';
    const label = `${req.method} ${route}`;
    const r = stats.routes[label] || newRoute();
    stats.routes[label] = r;
    stats.total += 1;
    stats.totalMs += ms;
    r.count += 1;
    r.totalMs += ms;
    r.maxMs = Math.max(r.maxMs, ms);

    if (res.statusCode >= 500) {
      stats.serverErrors += 1;
      r.serverErrors += 1;
    } else if (res.statusCode >= 400) {
      stats.clientErrors += 1;
      r.clientErrors += 1;
    }
  });
  next();
}

// Called by routes/artisans.js after each call to the partner.
function recordPartnerCall(ok) {
  stats.partner.calls += 1;
  if (!ok) stats.partner.failures += 1;
}

function statsHandler(req, res) {
  const routes = {};
  for (const [label, r] of Object.entries(stats.routes)) {
    routes[label] = {
      count: r.count,
      clientErrors: r.clientErrors,
      serverErrors: r.serverErrors,
      avgMs: round(r.totalMs / r.count),
      maxMs: round(r.maxMs),
    };
  }
  const rate = stats.total ? (stats.serverErrors / stats.total) * 100 : 0;
  const avg = stats.total ? stats.totalMs / stats.total : 0;
  const partnerRate = stats.partner.calls ? (stats.partner.failures / stats.partner.calls) * 100 : 0;
  res.json({
    startedAt: stats.startedAt,
    uptimeSeconds: Math.round(process.uptime()),
    total: stats.total,
    clientErrors: stats.clientErrors,
    serverErrors: stats.serverErrors,
    errorRatePercent: round(rate),
    avgMs: round(avg),
    partner: { ...stats.partner, failureRatePercent: round(partnerRate) },
    routes,
  });
}

function resetStats() { // for tests
  stats = freshStats();
}

module.exports = { monitor, statsHandler, recordPartnerCall, resetStats, who };
