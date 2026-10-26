const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { isHealthCheck } = require('./apiKey');

// Rate limiting per API key (Week 9, Part C).
//
// Authentication says WHO is calling; this stops any one caller calling too much, whether that is
// abuse or a consumer's infinite loop. Requests are counted per API key (so one noisy consumer
// cannot use up another consumer's allowance) in a fixed time window.
//
//   RATE_LIMIT_PER_MINUTE   requests allowed per key per minute (default 100)
//
// Why 100: a person using the website or a partner app makes a handful of requests per
// interaction (one list call, one search), so a few per second is already heavy. 100 a minute
// (about 1.7 a second, sustained) leaves room for a partner's bulk sync or a page that loads
// several lists at once, but a buggy loop or a scraper hits the ceiling within seconds.
//
// Honest limit: the counters live in this server's memory. They reset when the server restarts
// and they are not shared between several copies of the server. Production systems use a shared
// store such as Redis.

const DEFAULT_PER_MINUTE = 100;

function perMinute() {
  const n = Number(process.env.RATE_LIMIT_PER_MINUTE);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_PER_MINUTE;
}

function perKeyRateLimit() {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: () => perMinute(), // read on every request, so it can be changed without a restart
    standardHeaders: true, // RateLimit-* headers, and Retry-After on a 429
    legacyHeaders: false,
    // The host's health check (Render pings GET / every few seconds) must never be limited: if it got a 429
    // the host would think the server is down and restart it, which shows up as 502 for everyone.
    skip: (req) => isHealthCheck(req),
    // requireApiKey runs first and sets req.apiKeyId; the address is only a safety net
    keyGenerator: (req) => req.apiKeyId || ipKeyGenerator(req.ip),
    handler: (req, res, _next, options) => {
      const retryAfter = Number(res.getHeader('Retry-After')) || Math.ceil(options.windowMs / 1000);
      res.set('Retry-After', String(retryAfter));
      res.status(429).json({ error: 'Too many requests', retryAfter });
    },
  });
}

module.exports = { perKeyRateLimit, perMinute };
