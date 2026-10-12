const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Who may call the API from a browser (CORS). This only matters for browser apps:
// server-to-server calls, curl and Postman are never affected by CORS.
//  1. Public read endpoints (see PUBLIC_API.md): any website.
//  2. Partner endpoints (PARTNER_API.md: create a pharmacy, log in, manage your own details
//     and stock): the sites in PARTNER_ORIGINS, default "*" = any website. This is safe because
//     they are protected by a login token sent in a header, not by cookies.
//  3. Everything else (patient trackers): only the frontend addresses in CORS_ORIGIN.
const PUBLIC_GET_PATHS = [
  /^\/api\/medications\/?$/,
  /^\/api\/medications\/search\/?$/,
  /^\/api\/medications\/by-pharmacy\/?$/,
  /^\/api\/pharmacies\/?$/,
  /^\/api\/pharmacies\/(?!me\/?$)[^/]+\/?$/,
];
const PARTNER_PATHS = [
  /^\/api\/auth\/(register|login)\/?$/,
  /^\/api\/medications(\/[^/]+(\/stock)?)?\/?$/, // create, bulk, mine, update, stock, delete
  /^\/api\/pharmacies\/me(\/location)?\/?$/,
];
const splitList = (value) => value.split(',').map((s) => s.trim()).filter(Boolean);
const allowedOrigins = splitList(process.env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173');
const partnerOrigins = splitList(process.env.PARTNER_ORIGINS ?? '*');

app.use(
  cors((req, callback) => {
    // For a preflight, judge the method the browser says it is about to use
    const method = req.method === 'OPTIONS' ? req.header('Access-Control-Request-Method') : req.method;
    if (method === 'GET' && PUBLIC_GET_PATHS.some((re) => re.test(req.path))) {
      return callback(null, { origin: '*' });
    }
    if (PARTNER_PATHS.some((re) => re.test(req.path))) {
      return callback(null, { origin: partnerOrigins.includes('*') ? '*' : [...allowedOrigins, ...partnerOrigins] });
    }
    callback(null, { origin: allowedOrigins });
  })
);
app.use(express.json({ limit: '1mb' }));

app.get('/', (req, res) => {
  res.send('API is running');
});

// Slow down password guessing: 20 failed attempts per IP per 15 minutes
// (successful logins don't count against the limit)
app.use(
  '/api/auth',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please try again in a few minutes.' },
  })
);

// Keep the open read endpoints from being hammered: 120 requests per IP per minute
const publicReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  skip: (req) => req.method !== 'GET',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});
app.use('/api/medications', publicReadLimiter);
app.use('/api/pharmacies', publicReadLimiter);

// Stop anyone filling the public map with fake pharmacies: only successful sign-ups count,
// 20 per IP per hour by default (REGISTER_LIMIT_PER_HOUR to change)
app.use(
  '/api/auth/register',
  rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: Number(process.env.REGISTER_LIMIT_PER_HOUR) || 20,
    skipFailedRequests: true,
    skip: (req) => req.method !== 'POST',
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many accounts created from this address. Please try again later.' },
  })
);

app.use('/api/auth', require('./routes/auth'));
app.use('/api/medications', require('./routes/medications'));
app.use('/api/pharmacies', require('./routes/pharmacies'));
app.use('/api/tracking', require('./routes/tracking'));

// Unknown API address: JSON, not an HTML error page
app.use('/api', (req, res) => {
  res.status(404).json({ error: `No such endpoint: ${req.method} ${req.originalUrl.split('?')[0]}` });
});

// Always answer with JSON, even for a malformed or oversized request body
// (Express recognises an error handler by its four parameters, so `_next` must stay)
app.use((err, req, res, _next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request body is not valid JSON.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'The request body is too large (1 MB maximum).' });
  console.error(err);
  res.status(500).json({ error: 'Unexpected server error.' });
});

module.exports = app;

if (require.main === module) {
  if (!process.env.JWT_SECRET) {
    console.error('JWT_SECRET is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    require('./dbCheck').checkDatabase().catch((err) => console.error('[database] Check failed:', err.message));
  });
}
