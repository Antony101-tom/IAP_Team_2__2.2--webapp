const crypto = require('crypto');

// API-key authentication (Week 9, Part B).
//
//  - EVERY request must send a valid "X-API-Key: <key>" header, otherwise it gets a 401 and the
//    route handler never runs. There are no exceptions for "harmless" GETs.
//  - The only open door is the health check (GET / HEAD on "/"), see isHealthCheck below.
//    (Browser CORS preflights, OPTIONS, are answered by the cors middleware before this one runs;
//    browsers cannot attach custom headers to a preflight, and it returns no data.)
//  - It FAILS CLOSED: if API_KEYS is missing or empty, no key is valid, so every request is a 401.
//    index.js also refuses to start without keys, so a forgotten environment variable on the
//    host can never silently leave the API open.
//  - No Origin exemption. Anyone can fake an Origin header from curl, so trusting it would be
//    a hole. Our own website sends its own key instead (VITE_API_KEY, see README.md).
//
// API_KEYS is a comma-separated list. Give EACH consumer (ring partner, your team, your website)
// its own key so you can tell callers apart and revoke one without breaking the rest.
// Keys come from the environment, never from source code. They are compared in constant time.

const splitList = (value) => (value || '').split(',').map((s) => s.trim()).filter(Boolean);

function loadKeys() {
  return splitList(process.env.API_KEYS);
}

function sameKey(a, b) {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// A short, non-reversible label for a key. Used to count requests per key and to tell callers
// apart in logs WITHOUT ever storing or printing the key itself.
function keyId(key) {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
}

// The one public endpoint: "is the server up?". It returns a fixed string and no data.
const isHealthCheck = (req) => (req.method === 'GET' || req.method === 'HEAD') && req.path === '/';

function requireApiKey() {
  return (req, res, next) => {
    if (isHealthCheck(req)) return next();

    const sent = req.get('X-API-Key');
    const match = sent ? loadKeys().find((k) => sameKey(sent, k)) : undefined;
    if (!match) {
      return res.status(401).json({ error: 'Missing or invalid API key' });
    }
    req.apiKeyId = keyId(match); // never the key itself
    next();
  };
}

module.exports = { requireApiKey, loadKeys, keyId, isHealthCheck };
