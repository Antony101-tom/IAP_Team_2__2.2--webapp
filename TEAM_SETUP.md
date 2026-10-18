# Team setup: everyone shares one database, nobody gets its password

The group runs ONE API online (it holds the database login). Everyone else runs only the website and points it at that API.
Teammates can register accounts, add medications and use the current data, without ever seeing a database password.

```
Teammate's computer                  Hosted online                    Supabase
  website (npm run dev)  ─────►   MediTrac API (server/)   ─────►   database
  knows only the API address         holds DATABASE_URL            (private)
```

## For whoever owns the database (once)

1. **Put the API online.** Follow [RENDER.md](RENDER.md) (or steps 1 to 5 of [HOSTING.md](HOSTING.md)). You end up with an address like `https://meditrac-api.onrender.com`.
2. **Set these on the host** (the API's environment variables):

   | Name | Value |
   |---|---|
   | `DATABASE_URL`, `JWT_SECRET` | as in HOSTING.md. Only you ever see these |
   | `CORS_ORIGIN` | `http://localhost:5173,http://127.0.0.1:5173` (teammates' computers). Add your hosted website's address too, if there is one, separated by a comma |
   | `REQUIRE_LOGIN_FOR_WRITES` | `true`, so nobody can change stock without a login |

3. **Check it works:** open `https://your-api-address/api/medications` in a browser. You should see a list of medications.
4. **Send teammates the API address** (it is not a secret) and the project code. Do **not** send your `DATABASE_URL` or `server/.env`.

Until the API is online you can share your own computer for a short time (it must stay switched on and the server running):
`ngrok http 5000` gives a temporary public address (copy the real `https://....ngrok-free.app` address from the ngrok screen, never
an example one), or on the same Wi-Fi use `http://YOUR-IP:5000` and allow Node through the Windows Firewall. A free ngrok address
normally changes every time ngrok restarts, but every free account also has ONE fixed address (ngrok dashboard > Domains, it ends in
`.ngrok-free.dev` or `.ngrok-free.app`). Start ngrok with it and teammates only set `.env.local` once:
`ngrok http --url=YOUR-FIXED-DOMAIN 5000` (older ngrok versions use `--domain=` instead of `--url=`). The website already
sends the header ngrok needs to skip its warning page, so use the latest code.

## For each teammate

You do not need Supabase, a database or the `server` folder.

1. Install **Node 20 or newer** from nodejs.org.
2. Get the project code (clone the repository, or unzip it) and open the main folder in a terminal.
3. Run `npm install`.
4. Create a file named **`.env.local`** in the main folder (next to `package.json`) containing one line, with the address you were given:
   ```
   VITE_API_URL=https://your-meditrac-api.onrender.com
   ```
   (`.env.example` in the same folder shows the format. On Windows, create the file in VS Code rather than Notepad, which adds `.txt`.)
5. Run `npm run dev` and open `http://localhost:5173`.

You are now looking at the shared data. Try it:

- **Log in** with a demo account (`patient@example.com`, `wellness@example.com` ... all with the password `Password123`) if the owner kept them, or **register your own**.
- **Add data:** register as a **pharmacy**, pin its location on the map, and add medications. Everyone sees them straight away.
- **Search as a patient** from a second browser tab (each tab keeps its own login).

If you change `.env.local`, stop `npm run dev` (Ctrl+C) and start it again.

## What you will see, and who sees what

| | Where it lives | Who can see it |
|---|---|---|
| Medications and pharmacies already in the database | Supabase, read through the API | Everyone. The patient dashboard searches all pharmacies' stock |
| A pharmacy account you register, its map pin and its medications | The same database | Everyone (patients can find it and its stock) |
| A pharmacy's own stock list (its dashboard) | The same database | Only that pharmacy edits it. Others can read it through search |
| Trackers ("Track" button) | The same database | Only the patient who made them |
| Login sessions | Your own browser tab | Only you |

To check it works as a group: one person registers a pharmacy and adds a medication, and another person logs in as a patient, searches
for it, and finds it. Reload the page if it does not show up straight away.

To look at the raw data without any login, open these in a browser (replace the address):
`https://YOUR-API-ADDRESS/api/medications` and `https://YOUR-API-ADDRESS/api/pharmacies`.

## If something does not work

| What you see | Cause and fix |
|---|---|
| "Could not reach the server" | The API address in `.env.local` is wrong, has a trailing `/`, or the API is asleep. Free hosts sleep when unused: wait 30 to 60 seconds and try again |
| A red "CORS" error in the browser console (F12) | The owner must add `http://localhost:5173` to `CORS_ORIGIN` on the API. If you run the site on a different port, add that address instead |
| The site shows nothing or uses the wrong data | `.env.local` is in the wrong folder (it belongs next to `package.json`, not in `server`), or it was edited without restarting `npm run dev` |
| Changes by others do not appear | Reload the page. Data is read when a page loads |

## Good to know

- Everyone is editing the same live data. Use test names like "TEST - Alice" for things you add, and remove them when done.
- Keep `server/.env` and the database password to yourself, always. Teammates never need them.
- If a secret is ever shared by accident (for example it ends up in a chat or a commit), reset the database password in Supabase and generate a new `JWT_SECRET`.
