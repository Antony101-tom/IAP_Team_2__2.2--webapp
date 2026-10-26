# Security audit: MediTrac API (Week 9)

Scope: the Express API in `server/` (every route, the middleware, the logs and the repo contents) and the website's
use of it. Method: I read every route and response shape, then wrote automated tests for each claim below
(`server/__tests__/security-audit.test.js` and `api-key.test.js`) so the findings can be re-checked, not just believed.
The full suite is 276 tests and passes.

## Summary

| Area | Before | After |
|---|---|---|
| Authentication | API key only on public `GET` reads; **off** if `API_KEYS` unset; anyone could skip it by sending `Origin: http://localhost:5173` | Every endpoint needs a valid `X-API-Key` (401 otherwise); fails closed; server refuses to start without keys; no Origin bypass |
| Rate limiting | Per IP, on some routes only | Per API key on every route (100 per minute), 429 with `Retry-After` and a JSON body |
| Data exposure | Responses already built from explicit column lists | Unchanged (verified); `X-Powered-By: Express` header removed |
| Secrets | Real-looking partner key in an uploaded `server/.env`; no `.env.example` | `.env.example` files added, `.gitignore` hardened, no key in any committed file |

## 1. What I checked (Part D checklist), what I found, what I did

### Sensitive fields

- **Looked at:** every `res.json(...)` in `routes/auth.js`, `routes/medications.js`, `routes/pharmacies.js`, `routes/tracking.js`,
  and the SQL behind each public endpoint.
- **Found:** nothing wrong. Login and register build the account from an explicit list (`id, type, name, email`, plus
  public pharmacy details), so the `password_hash` that login reads from the database is never returned. Public endpoints use
  fixed column lists (`PUBLIC_MED_COLUMNS`, explicit pharmacy columns) with no `email`, no password and no `sku`.
  A pharmacy's email is only returned to that pharmacy (`/pharmacies/me`).
- **Evidence:** tests assert login responses contain no hash, and that the SQL of all five public reads never mentions
  `email`, `password` or `sku`.
- **Watch-out (not a bug today):** `serialize.cleanMedication` copies a whole row (`{ ...row }`). It is safe only because every query
  lists its columns. Never change one of those queries to `SELECT *`.
- **Minor:** `sku` (a pharmacy's own product code, not public) is included in the write endpoints' responses
  (`POST`/`PUT`/`PATCH`). See the next item for why that matters only while writes are open.

### Other people's data (changing an ID in the URL)

- **Looked at:** every route that takes an ID or acts on an account.
- **Found, fine:** `/pharmacies/me`, `/medications/mine` and `/tracking` take the account from the signed token, never from the URL
  or body. Tracker deletes are scoped by `user_id`. With a pharmacy token, medication writes are scoped to that pharmacy
  (`AND pharmacy_id = ?`) and a different `pharmacy_id` in the body is a 403. `GET /pharmacies/{id}` is public on purpose (it
  is the Public API).
- **Found, open risk (not fixed in code, on purpose):** with **no** login token, `PUT`, `PATCH /stock` and `DELETE` on
  `/medications/{id}` work on *any* medication, and `PUT` can move a medication to another `pharmacy_id`. This is what the agreed
  contract (`openapi.yaml`) requires, because the contract has no login on those endpoints, and the contract tests enforce it.
  **What changed this week:** a caller now also needs a valid API key and is rate limited, so the exposure is limited to
  key holders (your team and your ring partner) instead of the whole internet.
  **Fix for the live server:** set `REQUIRE_LOGIN_FOR_WRITES=true` (already required by `RENDER.md`, `HOSTING.md` and
  `TEAM_SETUP.md`). With it, writes need a pharmacy token and are limited to that pharmacy's own stock. It stays `false` in
  `.env.example` only so the local contract tests and a no-login demo keep working.

### Error messages

- **Looked at:** every `catch`, the global error handler, the 404 handler and the startup messages.
- **Found:** nothing wrong. Database failures log the real error on the server (`console.error`) and send a fixed message
  to the caller (for example `Failed to fetch medications`). Malformed JSON is a clean 400, an oversized body a clean 413,
  an unknown path a JSON 404 that does not echo the query string. Login answers identically for an unknown email and a wrong
  password, so emails cannot be probed.
- **Evidence:** a test makes the database throw an error containing a table name, a file path and an SQL statement, and
  asserts none of it reaches the response on four endpoints.
- **Found and fixed:** the `X-Powered-By: Express` header told every caller which framework to target. Removed
  (`app.disable('x-powered-by')`, tested).

### Write endpoints: extra fields

- **Looked at:** how every `POST`, `PUT` and `PATCH` reads `req.body`.
- **Found:** nothing wrong. Handlers destructure an explicit list of fields; `register` and `PATCH /pharmacies/me` use a fixed
  whitelist (`readPharmacyDetails`); the `id` is always generated by the server; column names in SQL come from fixed lists, and
  values are parameterized (`?`). There is no `isAdmin` or role column to inject into.
- **Evidence:** tests send `id`, `isAdmin`, `role`, `created_at` and `password_hash` and assert none reach the database.
- **Exception:** the unauthenticated `PUT` above takes `pharmacy_id` from the body (see "Other people's data").

### Keys in the wrong place

- **Looked at:** every file in the project, the startup and request logging, and the error responses.
- **Found, secrets in the shared zip:** the project I was given contained `server/.env`. Its database password and `JWT_SECRET`
  were still placeholders, but `PARTNER_API_KEY` looks real (48 hex characters). **Action for you:** do not share or commit
  that file; if it was ever committed or sent anywhere public, ask the partner team for a new key. I removed both
  `.env` files from the cleaned copy.
- **Found, no `.env.example`:** the lab requires one. Added `server/.env.example` and a root `.env.example` (placeholders only).
- **Found, `.gitignore`:** it covered `.env` and `*.local`. It now also covers `.env.*` while allowing the `*.example` templates
  (checked with `git add -n`: only the examples are picked up).
- **Found, none:** no real key, JWT secret or database password appears in any other file (scanned using the values from
  `.env` as search terms), in `README.md`, in the docs, or in the logs. The server prints only *how many* keys loaded, never
  the keys, and a test asserts neither a wrong key nor the real key is ever logged.
- **Not checkable from a zip:** git history (the zip has no `.git`). Run these in your repo; any output means a secret
  was committed and that secret must be rotated, because deleting the file does not remove it from history:
  ```bash
  git log --all --oneline -- server/.env .env.local
  git log --all -S"<first-10-characters-of-the-partner-key>" --oneline
  ```

## 2. Authentication (Part B): what was wrong and how it is fixed

| Problem found | Fix |
|---|---|
| Key required only for `GET` on 5 public paths; every write, login, registration and tracking route was open | One middleware, registered **before all routes**, covers every method and path |
| `API_KEYS` unset meant the check switched itself **off** | Fails closed: no keys means no request is valid, and `npm start` exits with a clear message |
| Requests with an `Origin` of "our website" skipped the key, and any `curl` can fake that header | Origin exemption removed. The website sends its own key (`VITE_API_KEY`) |
| A missing key and a wrong key got different messages | One message for both: `Missing or invalid API key` |

Already good and kept: keys are compared in constant time (SHA-256 digests with `timingSafeEqual`), so response timing does not help a guesser.

Open on purpose: `GET /` (and `HEAD /`), the health check. Hosts like Render poll it to know the server is up. It returns the
fixed text `API is running` and touches no data. CORS preflight (`OPTIONS`) is answered by the CORS layer: browsers cannot
send custom headers on a preflight, and it returns no data.

**One key per consumer.** `API_KEYS` is a comma-separated list: one key for your team, one for each ring partner, one for your
website. Revoking one is deleting it from the list (tested: the others keep working). Keys come from the environment, are
generated with `npm run generate:key`, and are sent to their owner privately.

**Test evidence:** `api-key.test.js` checks no key, wrong key and valid key on 21 endpoints (reads, writes, login, registration,
tracking, profile, unknown paths), that the handler never runs without a key, that a fake `Origin` does not help, that it fails
closed, and that the 401 and 429 match `openapi.yaml` for **every** operation in the contract. I also broke the code on purpose
three ways (always allow, never limit, bring back the Origin bypass); the tests failed each time (49, 5 and 1 failures).

## 3. Rate limit (Part C): threshold and reasoning

**100 requests per API key per minute** (`RATE_LIMIT_PER_MINUTE`).

- A person using the website or a partner app makes a handful of calls per interaction (one list, one search). A few per second
  is already heavy use, and 100 per minute is about 1.7 per second sustained.
- It leaves room for a partner's stock sync or a page that loads several lists at once, but a buggy `while(true)` loop or a
  scraper reaches the ceiling within seconds, which is exactly what the limit is for.
- It is counted per key, so one noisy consumer cannot use up another's allowance.
- Over the limit: `429`, a `Retry-After: <seconds>` header, and `{ "error": "Too many requests", "retryAfter": <seconds> }`.
- The separate per-IP limits (20 failed logins per 15 minutes, 20 sign-ups per hour) stay: a password guesser has one address,
  while every visitor of the website shares one key.

**The health check is exempt from the limit.** Hosts such as Render ping `GET /` every few seconds. If that were counted, a low limit (for example 3 during the lab demo) would make the host's own checks get 429s, and it would restart the server and answer 502. The limiter skips `GET`/`HEAD /` (tested).

**Honest limits.** The counters live in the server's memory: they reset on restart and are not shared between several copies
of the server (production uses a shared store such as Redis). Also, all visitors of the website share the website's one key, so a
very busy site would collectively hit 100 per minute; raise `RATE_LIMIT_PER_MINUTE` if that happens.

**Demonstration:** `RATE_LIMIT_DEMO.txt` has the curl output from a real run (401, 401, 200, then `200 200 200 429 429`, and the
full 429 with its header and body). It used a stand-in database, so redo it on your machine for your own screenshot:

```bash
cd server
API_KEYS=<your-api-key> JWT_SECRET=x RATE_LIMIT_PER_MINUTE=3 node scripts/demo-server.js   # or your real server with RATE_LIMIT_PER_MINUTE=3 in .env

curl -i http://localhost:5055/api/pharmacies                              # expect 401
curl -i -H "X-API-Key: wrong" http://localhost:5055/api/pharmacies        # expect 401
for i in 1 2 3 4 5; do curl -s -o /dev/null -w "%{http_code} " -H "X-API-Key: <your-api-key>" http://localhost:5055/api/pharmacies; done   # expect 200 200 200 429 429
```

(For your real server use its port, usually 5000, and remove `RATE_LIMIT_PER_MINUTE=3` afterwards.)

## 4. Still open or worth knowing

1. **Anonymous writes** while `REQUIRE_LOGIN_FOR_WRITES` is `false` (see "Other people's data"). Set it to `true` on the live server.
2. **The website's key is public** (it is compiled into the site). It identifies "our website" and can be revoked on its own; it is not a
   secret, and it is not what protects patients' or pharmacies' data (login tokens do).
3. **Single-server limiter** (above).
4. **Passwords:** minimum 6 characters. Fine for a course project; a real product should require more.
5. **No HTTPS in this code:** TLS is provided by the host (Render, ngrok). Never run the live API over plain HTTP.
