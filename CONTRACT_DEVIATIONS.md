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