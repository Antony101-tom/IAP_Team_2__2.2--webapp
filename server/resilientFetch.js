// Week 11: timeout + capped retries for calls to the upstream partner (Find My Artisan).
//
//  - Every attempt has a timeout, so a slow partner is cut off instead of holding the page hostage.
//  - Only momentary failures are retried: timeouts, dropped connections, 429 and 5xx.
//  - 4xx (wrong key, wrong path, bad request) are returned at once: asking again changes nothing.
//  - Only GET is retried. POST/PUT/PATCH/DELETE could run twice (see the idempotency idea from Week 3).
//  - At most `retries` extra attempts, with a growing wait (200 ms, 400 ms...) and Retry-After honoured.
//
// Nothing here logs headers, so the partner's API key can never end up in the log.

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A short, key-free reason for the log: "timeout", "ECONNREFUSED", "HTTP 503"...
function reasonOf(err) {
  if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) return 'timeout';
  return (err && (err.cause?.code || err.message)) || 'unknown';
}

async function fetchWithRetry(url, options = {}, config = {}) {
  const { timeoutMs = 1500, retries = 2, delayMs = 200, label = 'partner' } = config;
  const method = (options.method || 'GET').toUpperCase();
  const maxRetries = method === 'GET' ? retries : 0; // never retry writes

  for (let attempt = 0; ; attempt++) {
    let wait = delayMs * 2 ** attempt; // 200 ms, then 400 ms
    let why;
    try {
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
      if (!RETRY_STATUSES.has(res.status) || attempt >= maxRetries) return res;

      why = `HTTP ${res.status}`;
      const retryAfter = Number(res.headers && res.headers.get('Retry-After'));
      if (res.status === 429 && retryAfter > 0) {
        wait = Math.min(retryAfter * 1000, 5000); // wait as asked, but never more than 5 s
      }
      if (res.body && res.body.cancel) res.body.cancel().catch(() => {}); // free the connection
    } catch (err) {
      if (attempt >= maxRetries) throw err; // out of retries: the caller decides what the user sees
      why = reasonOf(err);
    }
    console.warn(`[${label}] attempt ${attempt + 1} failed (${why}), retrying in ${wait} ms`);
    await sleep(wait);
  }
}

module.exports = { fetchWithRetry, reasonOf, RETRY_STATUSES };
