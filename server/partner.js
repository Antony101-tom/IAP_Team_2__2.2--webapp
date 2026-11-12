// Week 13: the ONE place that knows which version of the Find My Artisan API we call.
//
// Find My Artisan deprecated v1 (notice of 2026-11-11) and made v2 live. The only behavioural change is that
// POST /v2/artisans/{id}/reviews answers 403 { code: "no_job" } until the artisan has a finished job logged for
// Meditrac. Every other v2 path answers exactly like v1, just under a /v2 prefix.
//
// So a version here is just a URL prefix. The rest of the app asks partnerPath('/artisans/3') and never writes
// "/v2" itself. Switching is one word in .env (PARTNER_VERSION=v2), and so is rolling back (PARTNER_VERSION=v1).
const versions = {
  v1: { prefix: '' }, // /artisans/...     (deprecated, sunset Tue 24 Nov 2026)
  v2: { prefix: '/v2' }, // /v2/artisans/...
};

function activeVersion() {
  const name = (process.env.PARTNER_VERSION || 'v1').trim();
  if (!versions[name]) {
    // Fail loudly: a typo must not silently send calls to a path that does not exist
    throw new Error(`PARTNER_VERSION must be one of ${Object.keys(versions).join(', ')} (got "${name}")`);
  }
  return name;
}

// '/artisans/3/reviews' -> '/artisans/3/reviews' (v1) or '/v2/artisans/3/reviews' (v2)
function partnerPath(path) {
  return versions[activeVersion()].prefix + path;
}

// The partner announces a retirement on every v1 response (Deprecation, Sunset, Link). Report it once per
// endpoint, so the log tells us we are still on a deprecated version BEFORE it stops working.
const warned = new Set();
function noteDeprecation(headers, method, path) {
  const get = (name) => (headers && typeof headers.get === 'function' ? headers.get(name) : null);
  if (!get('deprecation')) return;
  const key = `${method} ${path}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[artisans] partner endpoint is deprecated: ${key} (sunset ${get('sunset') || 'unknown'}, use ${get('link') || 'the successor version'}). Set PARTNER_VERSION=v2.`);
}

module.exports = { versions, activeVersion, partnerPath, noteDeprecation };
