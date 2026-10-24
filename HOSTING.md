# Hosting MediTrac with Supabase

MediTrac has three parts. Each one goes in a different place:

| Part | Where it lives | What it needs |
|---|---|---|
| **Database** | Supabase (hosted PostgreSQL) | A free Supabase project |
| **API** (`server/`) | Any Node host, for example Render, Railway or Fly.io | Node 18+ and a few settings |
| **Website** (the React app) | Any static host, for example Vercel, Netlify or Cloudflare Pages | The built `dist` folder |

The website talks to the API, and the API talks to Supabase. Nobody connects to the database directly.

> **How this was tested.** The server was tested against an ordinary PostgreSQL database, which is what Supabase
> runs: all endpoints, encrypted connections, and passwords with special characters. It could not be tested against
> a real Supabase project, so the first start with your own connection string is the one new thing. If something is
> off, the server prints a plain-English fix as it starts (see "If something goes wrong" below).
> Button names on Supabase, Render and the other sites change from time to time; look for the closest match.

## 1. Create the Supabase project

1. Sign in at supabase.com and choose **New project**.
2. Pick a name and a region close to your users, and set a **database password**. Write it down: you need it in step 3.
3. Wait a minute or two while the project is created.

## 2. Create the tables

1. In the project, open **SQL Editor** and choose **New query**.
2. Open `server/schema.sql` from this project, copy everything, paste it into the editor, and click **Run**. It should finish with "Success".
3. Do the same with `server/seed_data.sql` if you want the demo data. Both files are safe to run again.
4. Open **Table Editor**. You should see `users`, `pharmacies`, `medications` and `tracked_medications`.

Supabase may show that Row Level Security is enabled on each table. That is intentional. It stops Supabase's public web API
from exposing the tables (they hold password hashes). The MediTrac server connects directly as the database owner, which is
not affected.

## 3. Get the connection string

1. Click **Connect** at the top of the dashboard (or open **Project Settings > Database**).
2. Choose **Session pooler** and copy the connection string. It looks like
   `postgresql://postgres.abcdefghij:[YOUR-PASSWORD]@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`.
3. Replace `[YOUR-PASSWORD]` with your database password and **delete the square brackets**.
4. If the password contains special characters, encode them: `@` becomes `%40`, `:` becomes `%3A`, `/` becomes `%2F`, `#` becomes `%23`,
   `%` becomes `%25`, and a space becomes `%20`. (Simplest of all: choose a password with only letters and numbers.)

Use the **Session pooler** string, not "Direct connection". The direct address is IPv6-only on the free plan, and many
home networks and hosting services cannot reach it. The pooler works everywhere.

## 4. Run it on your own computer first

```bash
cd server
cp .env.example .env          # on Windows PowerShell: copy .env.example .env
```

Edit `server/.env`: paste the connection string after `DATABASE_URL=` and set a `JWT_SECRET`
(generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). Then:

```bash
npm install
npm start
```

Right under "Server running on http://localhost:5000" you should see:

```
[database] Connected. The tables are ready.
```

Then start the website (`npm install` and `npm run dev` in the main project folder) and log in as `patient@example.com` /
`Password123`. You can also run `npm run test:live` in `server/` to check every endpoint (see `TESTING.md`).

## 5. Put the API online (example: Render)

A complete, step-by-step Render guide (API and website) is in `RENDER.md`. A summary:

1. Push the project to GitHub. `server/.env` is ignored by git, so your secrets stay out of it. Never commit it.
2. On render.com choose **New > Web Service** and connect the repository.
3. Settings: **Root Directory** `server`, **Build Command** `npm install`, **Start Command** `npm start`.
4. Add these **environment variables**:

| Name | Value |
|---|---|
| `DATABASE_URL` | the Session pooler string from step 3 |
| `JWT_SECRET` | a **new** long random string (not the one from your laptop) |
| `CORS_ORIGIN` | the address of your website, for example `https://meditrac.vercel.app` (no trailing slash). If teammates run the website on their own computers (`TEAM_SETUP.md`), also add `http://localhost:5173`, separated by a comma |
| `REQUIRE_LOGIN_FOR_WRITES` | `true` (see "Before real people use it") |
| `PARTNER_ORIGINS` | `*` to let any website use the partner endpoints, or a comma-separated list of allowed sites |

The host sets `PORT` itself, and `TRUST_PROXY` defaults to `1`, which is right because hosts like Render sit behind a proxy (it makes the sign-up and login limits count each visitor separately). Railway and Fly.io use the same idea: root directory `server`, `npm install`, `npm start`, same variables.
Open `https://your-api-address/api/medications`: you should see a list of medications.

Free plans on some hosts put the API to sleep when nobody has used it for a while, so the first request afterwards can take
several seconds. Free Supabase projects can also be paused after a period of inactivity; you can restore them from the dashboard.

## 6. Put the website online (example: Vercel or Netlify)

1. Create a new project from the same GitHub repository. The root directory is the main project folder (not `server`).
2. Build command `npm run build`, output directory `dist`.
3. Add the environment variable **`VITE_API_URL`** with your API address, for example `https://meditrac-api.onrender.com`
   (no trailing slash). It must be set **before** the build, because it is baked into the website when it is built.
4. Deploy. Visiting `/register` directly works because the project already includes the routing file each host needs
   (`vercel.json` for Vercel, `public/_redirects` for Netlify).

Then make sure the API's `CORS_ORIGIN` is exactly the website's address, and redeploy the API if you changed it.

## Before real people use it

- **Delete the demo accounts** (they all use `Password123`). In the Supabase SQL Editor:
  ```sql
  delete from users where email = 'patient@example.com';
  delete from pharmacies where email in ('info@halisipharmacy.co.ke', 'wellness@example.com', 'citycare@example.com');
  ```
- **Set `REQUIRE_LOGIN_FOR_WRITES=true`.** The agreed API contract has no login on the stock endpoints, so without this
  anyone who finds the API address can change any pharmacy's stock. With it, a pharmacy must send its login token.
- Use a fresh `JWT_SECRET` for the live server, and keep the database password private.
- The "anon" and "service_role" keys on Supabase's API page are **not used** by MediTrac. Never put a service key in the website.

## If something goes wrong

The API prints the reason when it starts. On Render, look in the service's **Logs**.

| Message | What it means and the fix |
|---|---|
| `password authentication failed` | Wrong password in `DATABASE_URL`. Reset it in Supabase (Project Settings > Database), then update the variable. Encode special characters. |
| `Tenant or user not found` | The username part is wrong. Copy the whole Session pooler string again. |
| `ENOTFOUND` | The address is wrong. Copy the Session pooler string again, exactly as Supabase shows it. |
| `Connection terminated due to connection timeout` | The database never answered. Usually your network blocks the port (school or work Wi-Fi, some providers, a VPN). In PowerShell run `Test-NetConnection YOUR-HOST -Port 5432`. If it says `TcpTestSucceeded : False`, change `:5432` to `:6543` in `DATABASE_URL` (the pooler's other port), or use another network such as a phone hotspot. This only affects running on that network: a hosted API (step 5) is not affected. If both ports test `True` and it still times out, run `npm run check:db` in `server/`. It checks the address, the connection and the login one step at a time and says which one fails. |
| `The table "users" is missing` | `schema.sql` was not run. Do step 2. |
| `DATABASE_URL is not set` | The variable is missing on the host (or `server/.env` does not exist locally). |
| The website loads but every request fails, with a red "CORS" error in the browser console | `CORS_ORIGIN` on the API does not exactly match the website's address. |
| The website says it could not reach the server | `VITE_API_URL` was missing or wrong when the website was built. Fix it and redeploy the website. |

## Moving data from the old MySQL version

The old local MySQL database is not connected to Supabase. The demo data comes back with `seed_data.sql`. Accounts that
people registered in the old database would need to register again, or be copied across: password hashes are
bcrypt, so they work unchanged in the new database.
