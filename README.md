# MediTrac

MediTrac helps patients find medications at nearby pharmacies and lets pharmacies manage what they have in stock.

- **Patients** can search for a medication, see which registered pharmacies carry it, and view them on a map sorted by distance.
- **Pharmacies** can register an account, pin their location on a map, and manage their medication inventory from a dashboard.
- Accounts, medications and patient trackers are stored in a **MySQL** database and served by an **Express** API (`server/`), so data is shared across browsers and devices.

This is the React + Vite version of the app, built with `react-router-dom` for routing and plain `leaflet` for the maps.

## Getting Started

You need **Node 18+** and **MySQL 8+**. Run the backend and the frontend in two terminals.

### 1. Database

```bash
cd server
mysql -u root -p < schema.sql              # creates the meditrac database and tables
mysql -u root -p meditrac < seed_data.sql  # optional demo data (see below)
```

On Windows PowerShell the `<` redirect doesn't work: open the **MySQL Command Line Client** (or Workbench) and run `SOURCE schema.sql;` then `SOURCE seed_data.sql;` with the full path to each file.

### 2. Backend (port 5000)

```bash
cd server
cp .env.example .env     # then edit .env: your MySQL password and a JWT_SECRET
npm install
npm start                # or: npm run dev   (auto-restarts with nodemon)
```

Generate a `JWT_SECRET` with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. You should see `Server running on http://localhost:5000`.

### 3. Frontend (port 5173)

```bash
# from the project root
npm install
npm run dev
```

Visit `http://localhost:5173` and allow location access when your browser prompts for it. This is what lets the app calculate distances to nearby pharmacies. In development Vite forwards `/api/*` to the backend, so nothing else needs configuring.

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

Passwords are hashed with bcrypt, and the API returns a signed login token that the frontend sends with every request that needs a login. A pharmacy can only change its own stock.

To produce a production build:

```bash
npm run build
npm run preview   # serve the built dist/ folder locally to sanity check it
```

When the frontend is hosted at a different address than the API, set `VITE_API_URL` (for example `https://api.example.com`) when building, and add the frontend's address to `CORS_ORIGIN` in `server/.env`.

### If you see "Server error during login" (or registration)

The browser only shows a generic message. The real reason is printed in the terminal where you ran
`npm start`: look right below "Server running..." for a line starting with `[database]`, or a
`Login error:` line when you try to log in. The usual causes:

| What the terminal says | Fix |
|---|---|
| `Access denied for user ...` | Wrong `DB_USER` / `DB_PASSWORD` in `server/.env`. XAMPP's `root` has no password: `DB_PASSWORD=` |
| `ECONNREFUSED` | MySQL isn't running. Start it (XAMPP: click Start next to MySQL) and restart the server |
| `Unknown database` | The database doesn't exist yet. Run `schema.sql` |
| `Table ... doesn't exist` | Run `schema.sql` |
| `Unknown column 'phone'` (pharmacy login only) | Run `migration_partner_api.sql` once |

After editing `server/.env`, stop the server (Ctrl+C) and run `npm start` again. It only reads `.env` at startup.

### Tests

```bash
cd server
npm test        # Jest + Supertest; uses a fake database, so MySQL isn't needed
```

## Project Structure

```
meditrac-react/
├── index.html
├── public/
│   └── logos/
├── server/
│   ├── index.js              # Express app
│   ├── db.js                 # MySQL connection pool
│   ├── schema.sql            # tables
│   ├── seed_data.sql         # optional demo data
│   ├── geo.js                # distance / near-me helpers
│   ├── pharmacyDetails.js    # validation for a pharmacy's public details
│   ├── migration_partner_api.sql  # only for databases created before the partner API
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

- The login session is kept per browser tab (`sessionStorage`), so you can be a pharmacy in one tab and a patient in another. Everything else is in MySQL.
- Only pharmacies that have pinned their location on the map have coordinates. Others show "Distance unknown" and sort after pharmacies that do.
- Other apps can read pharmacy data and build their own map: see `PUBLIC_API.md` and the working example in `examples/map-demo.html`.
- Other apps can also create a pharmacy and upload and update their own stock: see `PARTNER_API.md` and `examples/partner-sync.js`.
- If you created the database before this feature existed, run `server/migration_partner_api.sql` once (in the MySQL client: `SOURCE <path>/server/migration_partner_api.sql;`).
- `openapi.yaml` is the agreed API contract, and the server follows it (checked by `server/__tests__/contract.test.js`). Everything added beyond it is described in `openapi-extensions.yaml`, and the differences are listed in `CONTRACT_DEVIATIONS.md`.
- The contract's write endpoints take no login token, so by default they work without one. Set `REQUIRE_LOGIN_FOR_WRITES=true` in `server/.env` before the server is reachable by people you don't trust.
