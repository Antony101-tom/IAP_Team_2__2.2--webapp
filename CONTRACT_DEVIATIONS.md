# Contract Deviations

## 2026-09-25 — Renamed all endpoints from /pharmacies to /medications

**What changed:** The original openapi.yaml documented endpoints under
/pharmacies (e.g. POST /pharmacies, GET /pharmacies/{id}/stock).
The actual implementation in routes/medications.js operates on a
medications table directly (with a pharmacy_id foreign key referencing
the profiles table), not a standalone pharmacies resource. All paths
were updated to /medications, /medications/{id},
/medications/{id}/stock, and /medications/by-pharmacy to match the
real server behavior.

**Why:** The original spec was written before the database schema was
finalized. Medications, not pharmacies, are the actual resource being
created/read/updated/deleted by the server. Pharmacy data lives in the
shared `profiles` table (type = 'pharmacy'), not a separate table.

## 2026-09-25 — Added /medications/by-pharmacy endpoint (not in original spec)

**What changed:** Added GET /medications/by-pharmacy?name=..., not
present in the original contract.

**Why:** Needed a way to fetch medications scoped to one pharmacy by
name for the catalog view.

## 2026-09-25 — Write endpoints require service_role key locally

**What changed:** Row Level Security policies on the medications table
block INSERT/UPDATE via the anon key for unauthenticated requests. For
local testing, the server's .env was configured with the service_role
key instead of anon to bypass RLS during verification.

**Why:** No authenticated pharmacy session exists yet in this testing
flow. This is a temporary local-testing workaround, not a production
security posture — noted here so it isn't mistaken for the intended
final behavior.

## 2026-10-06 — Contract confirmed as the source of truth; extras kept separate

**What changed:** `openapi.yaml` is the agreed contract and is back to exactly what the team wrote. The
server follows it. An automated test (`server/__tests__/contract.test.js`) reads that file, calls every
operation without a login token, and checks each response's status and body against the contract.
Everything added beyond it is documented in `openapi-extensions.yaml`, with nothing in it changing how a
contract operation behaves.

**Fixes to match the contract:**
- `PATCH /medications/{id}/stock` 400 responses are now `{ "error": "..." }` (the contract's `Error`).
  They used to be `{ "message": "..." }`.
- A medication's optional text fields (`form`, `category`, `unit`, `branch`) are left out when empty. The
  contract says they are strings, so they are no longer sent as `null`.
- `POST` / `PUT /medications` with a `pharmacy_id` that matches no pharmacy return `404` `{ "error": "Pharmacy not found" }`
  (an id in the URL that matches no medication is `404` `{ "error": "Medication not found" }`). They used to be `500`, then `400`.
- The write operations take **no login token**, as in the contract. They work without one.

**Additive differences (a client following only the contract can ignore all of them):**
- If a pharmacy does send its login token on `POST` / `PUT` / `PATCH` / `DELETE`, it can only change its own
  medications. `REQUIRE_LOGIN_FOR_WRITES=true` in `server/.env` makes the token mandatory. **Without it,
  anyone who can reach the server can change any pharmacy's stock**, exactly as in the contract.
  Turn it on before the server is reachable by people you don't trust.
- `GET /medications` records also carry `pharmacy`, `latitude` and `longitude`.
- Optional `sku` on medications; `409` if a pharmacy reuses one.
- Quantity or price below 0, and text longer than the database columns allow (name 150, form 100, category 80,
  unit 30, branch 150), return `400` `ValidationError`.

## 2026-10-06 — New endpoints beyond the contract

Described in `openapi-extensions.yaml`, so they do not touch the contract:
`POST /auth/register`, `POST /auth/login`, `GET /medications/mine`, `POST /medications/bulk`,
`GET /medications/search`, `GET /pharmacies`, `GET /pharmacies/{id}`, `GET` / `PATCH /pharmacies/me`,
`PUT /pharmacies/me/location`, `GET` / `POST` / `DELETE /tracking`.
Guides: `PUBLIC_API.md` (read-only, for other apps building a map) and `PARTNER_API.md` (create a pharmacy and
manage its own stock). The public read endpoints are open to any website (CORS `*`) and the partner endpoints
too by default (`PARTNER_ORIGINS`). Patient trackers are not. Only successful sign-ups are rate limited (20 per
IP per hour); public reads are limited to 120 per minute per IP.


## 2026-10-12 — Database: Supabase (PostgreSQL), through the Express server

**What changed:** The server stores its data in a Supabase-hosted PostgreSQL database. The tables are in
`server/schema.sql` (`users`, `pharmacies`, `medications`, `tracked_medications`), run once in the Supabase SQL
Editor. The server connects with the `DATABASE_URL` connection string (`server/db.js`, using the `pg` library).
The contract (`openapi.yaml`) is untouched, and so is every endpoint. Ids are still UUID strings.

**Why:** Supabase hosts the database for you, so the app can be put online without running a database server.
See `HOSTING.md`.

**Things that behave differently from the earlier MySQL version of this project:**
- Pharmacies are their own `pharmacies` table (the earlier `profiles` idea no longer applies), which also fixes
  `GET /medications/by-pharmacy` reading from a table that did not match the schema.
- The extra search endpoint (`/medications/search`) matches names and categories case-insensitively, and `%` / `_` are matched
  literally. `/medications/by-pharmacy` is exact and case-sensitive, as the contract says.
- Row Level Security is switched on for every table with no policies. Supabase publishes tables through a public
  web API; this keeps password hashes out of it. The Express server connects as the database owner and is not affected.
- A price above 99999999.99 or a quantity above 2147483647 returns `400` (`ValidationError`), because the columns
  cannot hold more.

## 2026-10-18 — Updated contract (500 responses, 404 for an unknown pharmacy, exact names, created_at)

**What changed in `openapi.yaml`** (made by the team) and how the server follows it:
- Every operation documents a `500` `{ "error": "..." }`. The server already answers failures that way; the automated tests now check
  every `500` (internals are not leaked in the message).
- `POST /medications` and `PUT /medications/{id}` answer `404` `Pharmacy not found` for an unknown `pharmacy_id`. This applies with or
  without a login token.
- `GET /medications/by-pharmacy` matches the name exactly and case-sensitively. (It was case-insensitive before.)
- `Medication` includes `created_at` (an ISO date-time string). It is returned by every medication response.
- `security: []`: the contract takes no login. The server still works that way by default; on a public server set
  `REQUIRE_LOGIN_FOR_WRITES=true`, and then `POST` / `PUT` / `PATCH` / `DELETE` need a pharmacy token (`401` without one). See `TESTING.md`.

`server/__tests__/contract.test.js` now checks all 21 documented responses, and `npm run test:live` checks the 15 that can be
produced on a running server (the six `500`s cannot be provoked on demand).

