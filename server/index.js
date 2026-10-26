const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { requireApiKey, loadKeys } = require('./middleware/apiKey');
const { perKeyRateLimit, perMinute } = require('./middleware/rateLimit');
require('dotenv').config();

const app = express();
app.disable('x-powered-by'); // don't advertise the framework to every caller

// The server normally sits behind a proxy (ngrok, Render, Railway...) that passes each visitor's real address
// in the X-Forwarded-For header. Trusting ONE proxy hop makes the rate limits count per visitor instead of
// lumping everyone together as "the proxy". Set TRUST_PROXY=0 if the server is reachable directly with no proxy
// in front, so nobody can fake that header.
const trustProxyHops = Number(process.env.TRUST_PROXY ?? '1');
app.set('trust proxy', Number.isInteger(trustProxyHops) && trustProxyHops > 0 ? trustProxyHops : false);
const PORT = process.env.PORT || 5000;

// Who may call the API from a browser (CORS). This only matters for browser apps:
// server-to-server calls, curl and Postman are never affected by CORS. CORS is NOT authentication:
// every request, whatever its origin, still needs an API key (see middleware/apiKey.js).
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
// Lets a browser app read these on a 429 (otherwise CORS hides them from its JavaScript)
const exposedHeaders = ['Retry-After', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset'];
const allowedOrigins = splitList(process.env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173');
const partnerOrigins = splitList(process.env.PARTNER_ORIGINS ?? '*');

app.use(
  cors((req, callback) => {
    // For a preflight, judge the method the browser says it is about to use
    const method = req.method === 'OPTIONS' ? req.header('Access-Control-Request-Method') : req.method;
    if (method === 'GET' && PUBLIC_GET_PATHS.some((re) => re.test(req.path))) {
      return callback(null, { origin: '*', exposedHeaders });
    }
    if (PARTNER_PATHS.some((re) => re.test(req.path))) {
      return callback(null, { origin: partnerOrigins.includes('*') ? '*' : [...allowedOrigins, ...partnerOrigins], exposedHeaders });
    }
    callback(null, { origin: allowedOrigins, exposedHeaders });
  })
);
app.use(express.json({ limit: '1mb' }));

// 1. WHO is calling: every request needs a valid X-API-Key, or it is a 401 and nothing below runs.
//    This is registered BEFORE all routes (order matters). The only open door is the health check.
app.use(requireApiKey());

// 2. HOW MUCH they may call: a per-key limit (RATE_LIMIT_PER_MINUTE, default 100) on every route.
//    Over the limit -> 429 with a Retry-After header and a JSON body.
app.use(perKeyRateLimit());

// Health check: the one endpoint that needs no key. It returns a fixed string, never data.
app.get('/', (req, res) => {
  res.send('API is running');
});

// Slow down password guessing: 20 failed attempts per IP per 15 minutes. This one counts per IP on
// purpose: all visitors of one website share one API key, but a password guesser has one address.
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
  if (loadKeys().length === 0) {
    console.error('API_KEYS is not set, so no request could ever be authenticated. Put one or more keys in .env (see .env.example).');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('[database] DATABASE_URL is not set, so there is no database to talk to. See HOSTING.md.');
  }
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    // Count only: never print a key
    console.log(`${loadKeys().length} API key(s) loaded. Rate limit: ${perMinute()} requests per key per minute.`);
    require('./dbCheck').checkDatabase().catch((err) => console.error('[database] Check failed:', err.message));
  });
}
