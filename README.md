# MediTrac

MediTrac helps patients find medications at nearby pharmacies and lets pharmacies manage what they have in stock.

- **Patients** can search for a medication, see which registered pharmacies carry it, and view them on a map sorted by distance.
- **Pharmacies** can register an account, pin their location on a map, and manage their medication inventory from a dashboard.
- Accounts, medications and patient trackers are stored in a **Supabase** (PostgreSQL) database and served by an **Express** API (`server/`), so data is shared across browsers and devices, and the database is hosted for you.

This is the React + Vite version of the app, built with `react-router-dom` for routing and plain `leaflet` for the maps.

## Getting Started

You need **Node 18+** and a free **Supabase** account. Run the backend and the frontend in two terminals. To put the whole app online, see [HOSTING.md](HOSTING.md).

### 1. Database (Supabase)

1. Create a project at supabase.com and remember the database password you choose.
2. Open **SQL Editor > New query**, paste the contents of `server/schema.sql`, and click **Run**. This creates the four tables. Then do the same with `server/seed_data.sql` for optional demo data (see below).
3. Copy your connection string (**Connect** at the top of the dashboard, or **Project Settings > Database**). Choose the **Session pooler** one and replace `[YOUR-PASSWORD]` with your password.

[HOSTING.md](HOSTING.md) walks through each of these with the details that usually go wrong.

### 2. Backend (port 5000)

```bash
cd server
cp .env.example .env     # then edit .env: paste your DATABASE_URL, set a JWT_SECRET and add your API_KEYS
npm install
npm start                # or: npm run dev   (auto-restarts with nodemon)
```

Generate a `JWT_SECRET` with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`, and one API key per consumer with `npm run generate:key` (see [API keys and rate limits](#api-keys-and-rate-limits)). The server refuses to start without `API_KEYS`. You should see `Server running on http://localhost:5000` and, right under it, `[database] Connected. The tables are ready.`

### 3. Frontend (port 5173)

```bash
# from the project root
npm install
npm run dev
```

Before that, copy `.env.example` (in the project root) to `.env.local` and set `VITE_API_KEY` to the website's own key from the server's `API_KEYS`; every API request needs one. Visit `http://localhost:5173` and allow location access when your browser prompts for it. This is what lets the app calculate distances to nearby pharmacies. In development Vite forwards `/api/*` to the backend, so nothing else needs configuring.

### Try it out

Demo accounts from `seed_data.sql` all use the password `Password123` (delete them before going live):

| Account | Email |
|---|---|
| Patient | `patient@example.com` |
| Pharmacy | `info@halisipharmacy.co.ke` |
| Pharmacy | `wellness@example.com` |
| Pharmacy | `citycare@example.com` |

1. **Register a pharmacy account** (or log in as a demo one), pin its location on the map, and add a few medications.
2. **Create a separate patient account** (use a second browser tab: each tab keeps its own login).
3. Search for one of those medications as the patient. The pharmacy shows up with its distance, and you can **Track** a listing.
4. Back on the pharmacy dashboard, change a quantity (set it to 0 to mark it out of stock), then reload the patient dashboard to see it.

Passwords are hashed with bcrypt, and the API returns a signed login token that the frontend sends with every request that needs a login. A pharmacy can only change its own stock when it sends that token.

To produce a production build:

```bash
npm run build
npm run preview   # serve the built dist/ folder locally to sanity check it
```

When the frontend is hosted at a different address than the API, set `VITE_API_URL` (for example `https://api.example.com`) when building, and add the frontend's address to `CORS_ORIGIN` in `server/.env`.

### If you see "Server error during login" (or registration)

The browser only shows a generic message. The real reason is printed in the terminal where you ran
`npm start`: look right below "Server running..." for lines starting with `[database]`, or a
`Login error:` line when you try to log in. The usual causes:

| What the terminal says | Fix |
|---|---|
| `password authentication failed` | The password in `DATABASE_URL` is wrong. Reset it in Supabase (Project Settings > Database) and paste the new one in. Encode special characters, e.g. `@` as `%40` |
| `Tenant or user not found` | The username in `DATABASE_URL` is wrong. Copy the whole string again from Supabase |
| `ENOTFOUND` | The address is wrong. Copy the **Session pooler** string again from Supabase |
| `Connection terminated due to connection timeout` | Your network is blocking the database port. Run `Test-NetConnection YOUR-HOST -Port 5432` in PowerShell. If it says `False`, change `:5432` to `:6543` in `DATABASE_URL`, or try another network (a phone hotspot). If both ports work and it still fails, run `npm run check:db` in `server/` to see which step stalls. See HOSTING.md |
| `The table "users" is missing` | Run `server/schema.sql` in the Supabase SQL Editor |
| `DATABASE_URL is not set` | Create `server/.env` from `.env.example` |

After editing `server/.env`, stop the server (Ctrl+C) and run `npm start` again. It only reads `.env` at startup.

### Tests

```bash
cd server
npm test            # Jest + Supertest; uses a fake database, so Supabase isn't needed
API_KEY=<your-api-key> npm run test:live   # tests every endpoint of a RUNNING server against openapi.yaml (see TESTING.md)
```

## API keys and rate limits

**Every endpoint needs an API key.** The only open endpoint is the health check, `GET /` (it returns the text `API is running` and no data). Everything under `/api`, reads and writes alike, answers `401` without a valid key and never reaches the code that handles the request.

Send your key in the `X-API-Key` header on every request:

```bash
curl -H "X-API-Key: <your-api-key>" http://localhost:5000/api/pharmacies
```

| Situation | Response |
|---|---|
| Valid key | The normal response (`200`, `201`, ...) |
| No `X-API-Key` header, or a wrong key | `401` with `{ "error": "Missing or invalid API key" }` |
| More than the limit in one minute | `429` with a `Retry-After: <seconds>` header and `{ "error": "Too many requests", "retryAfter": <seconds> }` |

**Rate limit:** 100 requests per API key per minute (`RATE_LIMIT_PER_MINUTE` in `server/.env` changes it). Counting is per key, so one consumer's infinite loop cannot use up another consumer's allowance. A well-behaved client waits `Retry-After` seconds and tries again. The sign-up and failed-login limits (per IP address) are separate and unchanged; see [PARTNER_API.md](PARTNER_API.md).

**Keys, in short:**

- One key per consumer (your team, each ring partner, your own website), all listed comma-separated in `API_KEYS` in `server/.env`. Remove a key from the list to revoke it; the others keep working.
- Create a key with `npm run generate:key` (in `server/`). Send it to its owner privately (direct message), never in the repo or a class channel.
- Keys live in environment variables, never in source code. `.env` is in `.gitignore`; `.env.example` (placeholders only) is what gets committed.
- Never write a real key in this README or any file you commit. Use `<your-api-key>` as the placeholder.
- The website's key (`VITE_API_KEY`) is compiled into the site and visible to anyone who opens it, so it identifies "our website"; it is not a secret. Give it its own key, separate from any partner's.
- The in-memory limiter resets when the server restarts and is not shared between several copies of the server. That is fine for this course; production systems use a shared store such as Redis.

The full security review is in [SECURITY_AUDIT.md](SECURITY_AUDIT.md); `RATE_LIMIT_DEMO.txt` shows the `401` and `429` responses from a real run.

## Project Structure

```
meditrac-react/
├── index.html
├── public/
│   └── logos/
├── server/
│   ├── index.js              # Express app
│   ├── db.js                 # PostgreSQL (Supabase) connection pool
│   ├── dbCheck.js            # startup check that explains database problems
│   ├── scripts/test-endpoints.js  # npm run test:live
│   ├── schema.sql            # tables (run in the Supabase SQL Editor)
│   ├── seed_data.sql         # optional demo data
│   ├── geo.js                # distance / near-me helpers
│   ├── pharmacyDetails.js    # validation for a pharmacy's public details
│   ├── .env.example          # copy to .env
│   ├── middleware/auth.js    # login-token checks
│   ├── routes/               # auth, medications, pharmacies, tracking
│   └── __tests__/
├── src/
│   ├── main.jsx
│   ├── App.jsx
│   ├── index.css
│   ├── pages/
│   │   ├── HomePage.jsx
│   │   ├── RegisterPage.jsx
│   │   ├── UserDashboardPage.jsx
│   │   └── PharmacyDashboardPage.jsx
│   ├── components/
│   │   ├── Navbar.jsx
│   │   ├── PharmacyLocationPicker.jsx
│   │   ├── ResultsMap.jsx
│   │   └── AddMedicationModal.jsx
│   ├── utils/
│   │   ├── accounts.js        # per-tab login session
│   │   ├── api.js             # fetch helper for the Express API
│   │   ├── medications.js
│   │   ├── geo.js
│   │   └── useGeolocation.js
│   └── styles/
```

## Notes

- The login session is kept per browser tab (`sessionStorage`), so you can be a pharmacy in one tab and a patient in another. Everything else is in the Supabase database.
- Only pharmacies that have pinned their location on the map have coordinates. Others show "Distance unknown" and sort after pharmacies that do.
- Other apps can read pharmacy data and build their own map: see `PUBLIC_API.md` and the working example in `examples/map-demo.html`.
- Other apps can also create a pharmacy and upload and update their own stock: see `PARTNER_API.md` and `examples/partner-sync.js`.
- To host the app online (Supabase for the database, plus a host for the API and the website): see `HOSTING.md`, or `RENDER.md` for step-by-step Render instructions. To let teammates use the shared data without database access: see `TEAM_SETUP.md`. To test the endpoints: see `TESTING.md`.
- `openapi.yaml` is the agreed API contract, and the server follows it (checked by `server/__tests__/contract.test.js`). Everything added beyond it is described in `openapi-extensions.yaml`, and the differences are listed in `CONTRACT_DEVIATIONS.md`.
- The contract's write endpoints take no login token, so by default a valid API key is all they need. Set `REQUIRE_LOGIN_FOR_WRITES=true` in `server/.env` before the server is reachable by people you don't trust.
