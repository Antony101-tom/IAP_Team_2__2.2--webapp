const express = require('express');
const { pool } = require('../db');
const { requirePharmacy } = require('../middleware/auth');

// Find My Artisan, through Meditrac.
//
// The browser never talks to the partner directly: the partner's API key (PARTNER_API_KEY) stays on this
// server, and only a logged-in pharmacy may use these routes.
//
//   GET    /api/artisans?trade=&county=               -> partner GET    /artisans
//   GET    /api/artisans/:id                          -> partner GET    /artisans/{id}
//   POST   /api/artisans/:id/reviews                  -> partner POST   /artisans/{id}/reviews
//   PATCH  /api/artisans/:id/reviews/:reviewId        -> partner PATCH  /artisans/{id}/reviews/{reviewId}
//   DELETE /api/artisans/:id/reviews/:reviewId        -> partner DELETE /artisans/{id}/reviews/{reviewId}
//
// Bookings are different. The partner only knows "Meditrac" as ONE caller, so it cannot tell which pharmacy
// booked whom, and its availability blocks must never be changed by another pharmacy. So bookings go
// through us and are recorded in our own artisan_bookings table:
//
//   POST   /api/artisans/:id/availability   -> partner POST   /artisans/{id}/availability, then we record it
//   GET    /api/artisans/bookings/mine      -> this pharmacy's bookings (from our database)
//   PATCH  /api/artisans/bookings/:bookingId -> partner PATCH  /artisans/{id}/availability/{blockId}
//   DELETE /api/artisans/bookings/:bookingId -> partner DELETE /artisans/{id}/availability/{blockId}

const router = express.Router();
router.use(requirePharmacy);

// The partner runs on a free host that sleeps; waking up takes about a minute (see INTEGRATION_LOG.md, bug 5).
const TIMEOUT_MS = Number(process.env.PARTNER_TIMEOUT_MS) || 70000;
const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/; // ids go into a URL path: never forward anything else

// ---- talking to the partner ------------------------------------------------------------------------

class PartnerError extends Error {
  constructor(status, error, retryAfter) {
    super(error);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

// Returns { status, data } for ANY answer the partner gives (including 400/404/409, which the caller passes on).
// Throws PartnerError for things that are not the pharmacy's doing: not configured, unreachable, our key refused...
async function callPartner(method, path, { query, body } = {}) {
  const base = (process.env.PARTNER_URL || '').replace(/\/+$/, '');
  const key = process.env.PARTNER_API_KEY;
  if (!base || !key) throw new PartnerError(503, 'The artisan service is not configured on this server.');

  const hasBody = body !== undefined;
  const qs = query && Object.keys(query).length ? `?${new URLSearchParams(query)}` : '';

  let upstream;
  try {
    upstream = await fetch(`${base}${path}${qs}`, {
      method,
      headers: {
        'X-API-Key': key,
        Accept: 'application/json',
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      },
      body: hasBody ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
    console.error('[artisans] partner call failed:', err.cause?.code || err.message);
    throw new PartnerError(
      timedOut ? 504 : 502,
      timedOut
        ? 'The artisan service took too long to answer. It may be waking up: try again in a minute.'
        : 'Could not reach the artisan service.'
    );
  }

  if (upstream.status === 204) return { status: 204, data: null };

  let data = null;
  try { data = await upstream.json(); } catch { /* not JSON */ }

  if (upstream.status === 401 || upstream.status === 403) {
    // OUR credentials for the partner are wrong. That must not look like an expired pharmacy login
    // (the website logs people out on a 401).
    console.error(`[artisans] partner refused our API key (HTTP ${upstream.status})`);
    throw new PartnerError(502, "The artisan service refused this server's credentials. Please tell the Meditrac team.");
  }
  if (upstream.status === 429) {
    throw new PartnerError(429, 'The artisan service is busy. Please try again in a moment.', upstream.headers.get('retry-after'));
  }
  if (data === null) throw new PartnerError(502, `The artisan service gave an unexpected reply (HTTP ${upstream.status}).`);
  return { status: upstream.status, data };
}

const isOk = (status) => status >= 200 && status < 300;
const send = (res, { status, data }) => (status === 204 ? res.status(204).end() : res.status(status).json(data));

// Wraps a handler so a partner problem or a database problem always becomes a JSON error.
const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof PartnerError) {
      if (err.retryAfter) res.set('Retry-After', err.retryAfter);
      return res.status(err.status).json({ error: err.message });
    }
    console.error('[artisans]', err);
    res.status(500).json({ error: 'Unexpected server error.' });
  }
};

const badId = (res) => res.status(400).json({ error: 'Invalid id.' });
const clean = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

// start/end must be real dates, end after start. Returns { errors } or { start, end } as ISO strings.
function readWindow(body) {
  const s = new Date(body && body.start);
  const e = new Date(body && body.end);
  const errors = [];
  if (!body || !body.start || Number.isNaN(s.getTime())) errors.push('start must be a valid date and time');
  if (!body || !body.end || Number.isNaN(e.getTime())) errors.push('end must be a valid date and time');
  if (errors.length === 0 && e <= s) errors.push('end must be after start');
  return errors.length ? { errors } : { start: s.toISOString(), end: e.toISOString() };
}

const blockIdOf = (data) => {
  const v = data && (data.id ?? data.blockId ?? data.block_id);
  return v === undefined || v === null ? null : String(v);
};

const BOOKING_COLUMNS = `id, artisan_id, block_id, artisan_name, trade, area, county,
  start_at AS "start", end_at AS "end", note, created_at`;

// ---- bookings (ours) ------------------------------------------------------------------------------

router.get('/bookings/mine', handle(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT ${BOOKING_COLUMNS} FROM artisan_bookings WHERE pharmacy_id = ? ORDER BY start_at DESC`,
    [req.pharmacyId]
  );
  res.json(rows);
}));

async function findMyBooking(req, res) {
  if (!SEGMENT.test(req.params.bookingId)) { badId(res); return null; }
  const [rows] = await pool.query(
    'SELECT id, artisan_id, block_id FROM artisan_bookings WHERE id = ? AND pharmacy_id = ?',
    [req.params.bookingId, req.pharmacyId]
  );
  if (rows.length === 0) { res.status(404).json({ error: 'Booking not found.' }); return null; }
  return rows[0];
}

// Change the time (and/or the job note) of a booking this pharmacy made.
router.patch('/bookings/:bookingId', handle(async (req, res) => {
  const booking = await findMyBooking(req, res);
  if (!booking) return;

  const win = readWindow(req.body);
  if (win.errors) return res.status(400).json({ message: 'Validation failed', errors: win.errors });
  const note = req.body.note === undefined ? undefined : clean(req.body.note, 200);

  if (booking.block_id) {
    const result = await callPartner('PATCH', `/artisans/${booking.artisan_id}/availability/${booking.block_id}`, {
      body: { start: win.start, end: win.end },
    });
    if (!isOk(result.status)) return send(res, result); // e.g. the partner says the new time clashes
  }

  if (note === undefined) {
    await pool.query('UPDATE artisan_bookings SET start_at = ?, end_at = ? WHERE id = ? AND pharmacy_id = ?',
      [win.start, win.end, booking.id, req.pharmacyId]);
  } else {
    await pool.query('UPDATE artisan_bookings SET start_at = ?, end_at = ?, note = ? WHERE id = ? AND pharmacy_id = ?',
      [win.start, win.end, note, booking.id, req.pharmacyId]);
  }
  const [rows] = await pool.query(`SELECT ${BOOKING_COLUMNS} FROM artisan_bookings WHERE id = ?`, [booking.id]);
  res.json({ ...rows[0], synced: !!booking.block_id });
}));

// Cancel a booking this pharmacy made: free the artisan's time at the partner, then forget it here.
router.delete('/bookings/:bookingId', handle(async (req, res) => {
  const booking = await findMyBooking(req, res);
  if (!booking) return;

  let released = false;
  if (booking.block_id) {
    const result = await callPartner('DELETE', `/artisans/${booking.artisan_id}/availability/${booking.block_id}`);
    // 404 = the partner no longer has that block, so there is nothing left to free
    if (!isOk(result.status) && result.status !== 404) return send(res, result);
    released = true;
  }
  await pool.query('DELETE FROM artisan_bookings WHERE id = ? AND pharmacy_id = ?', [booking.id, req.pharmacyId]);
  res.json({ deleted: true, released });
}));

// ---- artisans (the partner's) -----------------------------------------------------------------------

router.get('/', handle(async (req, res) => {
  const query = {};
  for (const f of ['trade', 'county']) {
    const v = typeof req.query[f] === 'string' ? req.query[f].trim() : '';
    if (v) query[f] = v.slice(0, 60);
  }
  send(res, await callPartner('GET', '/artisans', { query }));
}));

router.get('/:id', handle(async (req, res) => {
  if (!SEGMENT.test(req.params.id)) return badId(res);
  send(res, await callPartner('GET', `/artisans/${req.params.id}`));
}));

// Book an artisan. Body: { start, end, note?, artisan?: { name, trade, area, county } }.
// Only start and end go to the partner; note and artisan are what WE show on the Booked Artisans screen.
router.post('/:id/availability', handle(async (req, res) => {
  if (!SEGMENT.test(req.params.id)) return badId(res);
  const win = readWindow(req.body);
  if (win.errors) return res.status(400).json({ message: 'Validation failed', errors: win.errors });

  const result = await callPartner('POST', `/artisans/${req.params.id}/availability`, {
    body: { start: win.start, end: win.end },
  });
  if (!isOk(result.status)) return send(res, result);

  const snap = (req.body.artisan && typeof req.body.artisan === 'object') ? req.body.artisan : {};
  let recorded = true;
  try {
    await pool.query(
      `INSERT INTO artisan_bookings
         (pharmacy_id, artisan_id, block_id, artisan_name, trade, area, county, start_at, end_at, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.pharmacyId, req.params.id, blockIdOf(result.data),
        clean(snap.name, 150) || `Artisan ${req.params.id}`,
        clean(snap.trade, 80), clean(snap.area, 120), clean(snap.county, 80),
        win.start, win.end, clean(req.body.note, 200),
      ]
    );
  } catch (err) {
    // The artisan IS booked at the partner. Say so, instead of pretending the booking failed.
    console.error('[artisans] booked at the partner but could not record it:', err.message);
    recorded = false;
  }
  const body = result.data && typeof result.data === 'object' ? result.data : {};
  res.status(result.status).json({ ...body, recorded });
}));

// ---- reviews (passed straight through) ---------------------------------------------------------------

router.post('/:id/reviews', handle(async (req, res) => {
  if (!SEGMENT.test(req.params.id)) return badId(res);
  send(res, await callPartner('POST', `/artisans/${req.params.id}/reviews`, { body: req.body || {} }));
}));

for (const method of ['PATCH', 'DELETE']) {
  router[method.toLowerCase()]('/:id/reviews/:reviewId', handle(async (req, res) => {
    if (!SEGMENT.test(req.params.id) || !SEGMENT.test(req.params.reviewId)) return badId(res);
    const body = method === 'PATCH' ? { body: req.body || {} } : {};
    send(res, await callPartner(method, `/artisans/${req.params.id}/reviews/${req.params.reviewId}`, body));
  }));
}

module.exports = router;
