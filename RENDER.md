# Deploying MediTrac on Render

This puts the whole app online, so nobody needs your computer, ngrok, or a database password:

```
Anyone's browser ──►  Website (Render Static Site)  ──►  API (Render Web Service)  ──►  Supabase database
                      https://meditrac-site.onrender.com     https://meditrac-api.onrender.com
```

You create **two Render services** from the same GitHub repository. Supabase stays as it is.

> Button and menu names on Render change from time to time. Look for the closest match, and check render.com/docs if a screen
> looks different. The server side of this guide (port, health-check address, settings) was checked against this project; the
> Render screens themselves could not be tried from here.

## Before you start

- [ ] The code you want online is **on GitHub**, on the branch you will deploy (usually `main` after your pull request is merged).
- [ ] Supabase is set up and `npm run check:db` (in `server/`) passes on your computer. See `HOSTING.md`, steps 1 to 3.
- [ ] **Reset your database password** in Supabase (Project Settings > Database > Reset database password) and build a fresh
      `DATABASE_URL` with it. The old password was shared in a chat. Update your local `server/.env` too.
- [ ] Generate a **new `JWT_SECRET`** for the live server (do not reuse your laptop's):
      `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

## 1. Create the account

Go to render.com and sign up with **GitHub**. When asked, allow Render to see the repository you are deploying.

## 2. Deploy the API (Web Service)

**New + > Web Service**, choose your repository, then fill in:

| Setting | Value |
|---|---|
| Name | `meditrac-api` (becomes `meditrac-api.onrender.com`, or similar if the name is taken) |
| Region | Closest to your Supabase project. For Supabase `eu-west-1` (Ireland) choose **Frankfurt** |
| Branch | The branch you are deploying |
| **Root Directory** | `server` |
| Runtime / Language | Node |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Instance Type | Free |

Under **Advanced**, set **Health Check Path** to `/` (the API answers `API is running` there without touching the database).

Add these **Environment Variables**:

| Name | Value |
|---|---|
| `NODE_VERSION` | `22` |
| `DATABASE_URL` | Your Supabase **Session pooler** string, with the new password (see `HOSTING.md` step 3) |
| `JWT_SECRET` | The new secret you generated |
| `REQUIRE_LOGIN_FOR_WRITES` | `true` |
| `CORS_ORIGIN` | `http://localhost:5173` for now (you add the website's address in step 4) |
| `PARTNER_ORIGINS` | `*` (let other apps' websites use the partner endpoints), or a comma-separated list of sites |

Do **not** add `PORT` (Render sets it) or `TRUST_PROXY` (the default `1` is right behind Render's proxy, and keeps the sign-up and
login limits per visitor). Click **Create Web Service**.

Open the service's **Logs**. After a minute or two you should see:

```
Server running on http://localhost:10000
[database] Connected. The tables are ready.
```

Then open `https://YOUR-API-ADDRESS.onrender.com/api/medications` in a browser. You should see a list of medications.
If a `[database]` line shows a problem instead, the table in the README (and `HOSTING.md`) explains each message.

## 3. Deploy the website (Static Site)

**New + > Static Site**, same repository, then:

| Setting | Value |
|---|---|
| Name | `meditrac-site` |
| Branch | The same branch |
| Root Directory | leave **empty** (the website is in the main folder, not `server`) |
| Build Command | `npm install && npm run build` |
| Publish Directory | `dist` |

Environment Variables:

| Name | Value |
|---|---|
| `NODE_VERSION` | `22` |
| `VITE_API_URL` | The API address from step 2, with **no `/` or `/api` at the end**, e.g. `https://meditrac-api.onrender.com` |

Then add a **Redirect/Rewrite rule** (Redirects/Rewrites tab): Source `/*`, Destination `/index.html`, Action **Rewrite**.
Without it, opening or refreshing a page like `/register` shows "Not Found". (Render does not read the `_redirects` file that is in the
project; that one is for Netlify.)

Click **Create Static Site**. When it finishes, copy the website's address, e.g. `https://meditrac-site.onrender.com`.

## 4. Connect the two

Back in the **API service > Environment**, change `CORS_ORIGIN` to the website's address and keep localhost for local work:

```
CORS_ORIGIN=https://meditrac-site.onrender.com,http://localhost:5173
```

No trailing slash. Saving restarts the API.

## 5. Try it

1. Open the website's address. The first request after a quiet spell can take up to a minute (see "Free plan" below).
2. Log in as `patient@example.com` / `Password123`, or register.
3. Register a pharmacy, pin it on the map, add a medication. Search for it as a patient in another tab.
4. Test every endpoint of the live API from your computer (with `REQUIRE_LOGIN_FOR_WRITES=true` the tester needs a pharmacy's login token
   and id; `TESTING.md` explains `TOKEN` and `PHARMACY_ID`):
   ```powershell
   cd server
   $env:API_URL="https://meditrac-api.onrender.com/api"
   $env:TOKEN="a pharmacy token"; $env:PHARMACY_ID="that pharmacy's id"
   npm run test:live
   ```

## 6. Your teammates

Send them the **website address**. That is all: they open it in a browser, register, add data and see everyone's data. They need no code,
no `.env`, and no ngrok. Anyone who also develops the site locally puts the API address in `.env.local`
(`VITE_API_URL=https://meditrac-api.onrender.com`) and runs `npm run dev`; their `http://localhost:5173` is already allowed by `CORS_ORIGIN`.

## Updating the app later

- **Code changes:** push to the deployed branch. Render rebuilds and redeploys by itself (Auto-Deploy).
- **Changed an environment variable on the API:** saving it restarts the API.
- **Changed `VITE_API_URL` on the website:** it is baked in at build time, so use **Manual Deploy > Clear build cache & deploy**.
- **Changed the database tables:** run the new SQL in the Supabase SQL Editor (the API does not change tables by itself).

## Free plan: what to expect

- A free web service **goes to sleep when nobody has used it for a while**. The next request wakes it, which can take 30 to 60 seconds,
  and the website may look broken until then. Wait and reload. Free Supabase projects can also be paused after a long quiet period
  (restore them from the Supabase dashboard).
- Free plans have monthly limits. Check Render's current pricing page. For something people rely on, consider a paid instance.
- Logs are under each service's **Logs** tab. They are the first place to look when something fails.

## If something goes wrong

| What you see | Cause and fix |
|---|---|
| Build fails with `Cannot find module` or `package.json not found` | **Root Directory** is wrong: it must be `server` for the API and empty for the website |
| Build fails while installing `bcrypt` or complains about Node | Add `NODE_VERSION` = `22` and redeploy |
| `[database] ... password authentication failed` / `Tenant or user not found` / `ENOTFOUND` / timeout in the API logs | `DATABASE_URL` is wrong or not the Session pooler string. See the troubleshooting table in `HOSTING.md` |
| `The table "users" is missing` | `schema.sql` was not run in Supabase |
| Login or sign-up says "Something went wrong" (older code), or "did not answer like the MediTrac API (HTTP 404)" | The website is not talking to the API. It got a web page back instead of data. On the **website** service (not the API) set `VITE_API_URL` to the API's address, then **Manual Deploy > Clear build cache & deploy**. Open F12 > Network, click Log In, and look at the `login` request: its Request URL must start with your API address (`https://meditrac-api.onrender.com/api/auth/login`). If it starts with the website's own address, `VITE_API_URL` was missing when the site was built |
| "The server is starting up or temporarily unavailable (HTTP 502/503)" | The free API was asleep. Wait a minute and try again |
| The website opens but says it could not reach the server | `VITE_API_URL` is missing, wrong, or has a trailing `/` or `/api`, or the API is asleep. Fix it, then **Clear build cache & deploy** the website |
| Red "CORS" error in the browser console (F12) | `CORS_ORIGIN` on the API does not exactly match the website's address (check `https`, no trailing slash) |
| "Not Found" when refreshing `/register` or another page on the website | The rewrite rule `/*` to `/index.html` is missing |
| "Too many attempts" or "Too many requests" | A rate limit: 20 failed logins per 15 minutes, 20 sign-ups per hour, 120 page loads per minute, per visitor. Wait and retry |
| Deploy says the service failed health checks | Health Check Path must be `/`. Check the logs for a crash |

## Before real people use it

- Delete the demo accounts (SQL in `HOSTING.md`).
- Keep `REQUIRE_LOGIN_FOR_WRITES` set to `true`.
- Never put a secret in a variable starting with `VITE_`: those are public inside the website.
