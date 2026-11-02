const express = require('express');
const { requirePharmacy } = require('../middleware/auth');

// Find My Artisan proxy.
//
// The browser never talks to the partner directly: the partner's API key (PARTNER_API_KEY) stays on this
// server, and only a logged-in pharmacy may use these routes. Each route maps 1:1 onto the partner's API:
//   GET    /api/artisans?trade=&county=                       -> GET    /artisans
//   GET    /api/artisans/:id                                  -> GET    /artisans/{id}
//   POST   /api/artisans/:id/reviews                          -> POST   /artisans/{id}/reviews
//   PATCH  /api/artisans/:id/reviews/:reviewId                -> PATCH  /artisans/{id}/reviews/{reviewId}
//   DELETE /api/artisans/:id/reviews/:reviewId                -> DELETE /artisans/{id}/reviews/{reviewId}
//   POST   /api/artisans/:id/availability                     -> POST   /artisans/{id}/availability
//   PATCH  /api/artisans/:id/availability/:blockId            -> PATCH  /artisans/{id}/availability/{blockId}
//   DELETE /api/artisans/:id/availability/:blockId            -> DELETE /artisans/{id}/availability/{blockId}

const router = express.Router();
router.use(requirePharmacy);

// The partner runs on a free host that sleeps; waking up takes about a minute (see INTEGRATION_LOG.md, bug 5).
const TIMEOUT_MS = Number(process.env.PARTNER_TIMEOUT_MS) || 70000;
const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/; // ids go into a URL path: never forward anything else

async function forward(req, res, path, { query } = {}) {
  const base = (process.env.PARTNER_URL || '').replace(/\/+$/, '');
  const key = process.env.PARTNER_API_KEY;
  if (!base || !key) {
    return res.status(503).json({ error: 'The artisan service is not configured on this server.' });
  }

  const hasBody = !['GET', 'DELETE'].includes(req.method);
  const qs = query && Object.keys(query).length ? `?${new URLSearchParams(query)}` : '';

  try {
    const upstream = await fetch(`${base}${path}${qs}`, {
      method: req.method,
      headers: {
        'X-API-Key': key,
        Accept: 'application/json',
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      },
      body: hasBody ? JSON.stringify(req.body || {}) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (upstream.status === 204) return res.status(204).end();

    let data = null;
    try { data = await upstream.json(); } catch { /* not JSON */ }

    if (upstream.status === 401 || upstream.status === 403) {
      // Our credentials for the partner are wrong: that is not the pharmacy's fault, and must not
      // look like an expired pharmacy login (the website logs people out on a 401).
      console.error(`[artisans] partner refused our API key (HTTP ${upstream.status})`);
      return res.status(502).json({ error: 'The artisan service refused this server\'s credentials. Please tell the Meditrac team.' });
    }
    if (upstream.status === 429) {
      const retry = upstream.headers.get('retry-after');
      if (retry) res.set('Retry-After', retry);
      return res.status(429).json({ error: 'The artisan service is busy. Please try again in a moment.' });
    }
    if (data === null) {
      return res.status(502).json({ error: `The artisan service gave an unexpected reply (HTTP ${upstream.status}).` });
    }
    return res.status(upstream.status).json(data);
  } catch (err) {
    const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
    console.error('[artisans] partner call failed:', err.cause?.code || err.message);
    return res.status(timedOut ? 504 : 502).json({
      error: timedOut
        ? 'The artisan service took too long to answer. It may be waking up: try again in a minute.'
        : 'Could not reach the artisan service.',
    });
  }
}

const badId = (res) => res.status(400).json({ error: 'Invalid id.' });

router.get('/', (req, res) => {
  const query = {};
  for (const f of ['trade', 'county']) {
    const v = typeof req.query[f] === 'string' ? req.query[f].trim() : '';
    if (v) query[f] = v.slice(0, 60);
  }
  return forward(req, res, '/artisans', { query });
});

router.get('/:id', (req, res) => {
  if (!SEGMENT.test(req.params.id)) return badId(res);
  return forward(req, res, `/artisans/${req.params.id}`);
});

for (const [sub, param] of [['reviews', 'reviewId'], ['availability', 'blockId']]) {
  router.post(`/:id/${sub}`, (req, res) => {
    if (!SEGMENT.test(req.params.id)) return badId(res);
    return forward(req, res, `/artisans/${req.params.id}/${sub}`);
  });
  for (const method of ['patch', 'delete']) {
    router[method](`/:id/${sub}/:${param}`, (req, res) => {
      if (!SEGMENT.test(req.params.id) || !SEGMENT.test(req.params[param])) return badId(res);
      return forward(req, res, `/artisans/${req.params.id}/${sub}/${req.params[param]}`);
    });
  }
}

module.exports = router;
