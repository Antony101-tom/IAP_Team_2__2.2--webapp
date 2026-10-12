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

## 2026-10-06 — Database moved from Supabase to MySQL

**What changed:** The server now uses MySQL (`mysql2`) instead of Supabase. The
`server/supabaseClient.js` file is gone, replaced by `server/db.js`, and the
tables are defined in `server/schema.sql` (`users`, `pharmacies`, `medications`,
`tracked_medications`). Medication ids are still UUID strings.

**Why:** The project needs to run on a plain MySQL database. The `/medications`
paths, request bodies and response shapes are unchanged, so the earlier entries
above still describe the API.

**Also:** pharmacies are now their own `pharmacies` table (the earlier note about a
shared `profiles` table no longer applies), which fixes `GET /medications/by-pharmacy`
reading from a table that did not match the schema.

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
- `POST` / `PUT /medications` with a `pharmacy_id` that matches no pharmacy return `400` with the contract's
  `ValidationError` instead of a `500`.
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

## 2026-10-06 — Database moved from Supabase to MySQL

The server uses MySQL (`mysql2`) instead of Supabase. `server/supabaseClient.js` is replaced by `server/db.js`,
and the tables are in `server/schema.sql` (`users`, `pharmacies`, `medications`, `tracked_medications`).
Medication ids are still UUID strings. Pharmacies are their own `pharmacies` table, which fixes
`GET /medications/by-pharmacy` reading from a table that did not match the schema.

## 2026-10-06 — New endpoints beyond the contract

Described in `openapi-extensions.yaml`, so they do not touch the contract:
`POST /auth/register`, `POST /auth/login`, `GET /medications/mine`, `POST /medications/bulk`,
`GET /medications/search`, `GET /pharmacies`, `GET /pharmacies/{id}`, `GET` / `PATCH /pharmacies/me`,
`PUT /pharmacies/me/location`, `GET` / `POST` / `DELETE /tracking`.
Guides: `PUBLIC_API.md` (read-only, for other apps building a map) and `PARTNER_API.md` (create a pharmacy and
manage its own stock). The public read endpoints are open to any website (CORS `*`) and the partner endpoints
too by default (`PARTNER_ORIGINS`). Patient trackers are not. Only successful sign-ups are rate limited (20 per
IP per hour); public reads are limited to 120 per minute per IP.

**Database:** existing databases need `server/migration_partner_api.sql` run once; a fresh `schema.sql` already
includes it.

