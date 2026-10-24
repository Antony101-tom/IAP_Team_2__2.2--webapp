# Integration Log: Week 10

**Our app:** MediTrac (pharmacy stock finder), API at https://meditrac-api.onrender.com
**Upstream partner:** Find My Artisan, API at https://find-my-artisan.onrender.com (auth header `X-API-Key`)
**Downstream partner:** Team 3, who consume our MediTrac API
**Date:** 23 October 2026

## What we integrated

We call the partner's `GET /artisans` from a script on our side (`server/scripts/sync-artisans.js`, run with `npm run sync:artisans`) and add each artisan to our `users` table as a patient. Only the columns in our schema are kept (`name`, `email`, `password_hash`). Everything else in the partner's data is dropped.

The key and URL are read from `server/.env` (`PARTNER_URL`, `PARTNER_API_KEY`, `MEDITRAC_API_URL`). `.env` is not committed, and `server/.env.example` holds placeholder values only.

**Result:** 31 artisans fetched, 31 added, 0 already existed, 0 skipped.

## First call (Part B)

Made from a terminal, outside our app:

```
curl.exe -i -H "X-API-Key: <key>" https://find-my-artisan.onrender.com/artisans
```

- Status: 200, JSON list of 31 artisans.
- Fields on each artisan: `id` (number), `name`, `trade`, `area`, `county`, `verified` (boolean), `busy` (list of `{start, end}` timestamps).
- Not present: `email`, `phone`. See bug 2.

## Bugs and surprises

| # | What broke (symptom) | Root cause | Fix | Whose code, and who fixed it |
|---|---|---|---|---|
| 1 | In PowerShell, `curl -H "X-API-KEY: ..." <url>` failed with "Cannot bind parameter 'Headers'... Cannot convert the value of type System.String to type System.Collections.IDictionary". | In PowerShell, `curl` is an alias for `Invoke-WebRequest`, which expects `-Headers` as a hashtable. In our first attempts the key and URL were also pasted with no space between them. | Used `curl.exe -H "X-API-Key: ..." <url>` (the real curl), with a space before the URL. `Invoke-RestMethod -Headers @{...}` also works. | Ours (tooling and a typo). Fixed by us. |
| 2 | The partner's artisans have no `email`, but our `users` table requires a unique one. | Their contract exposes only `id`, `name`, `trade`, `area`, `county`, `verified`, `busy`. Our schema needs `name`, `email`, `password_hash`. | Generated a stable placeholder email per artisan (`artisan-<id>@find-my-artisan.invalid`), so re-running the sync finds the same email and does not create duplicates. Dropped `trade`, `area`, `county`, `verified` and `busy`, because our schema has no columns for them. | Gap between the two contracts. Fixed on our side. Suggestion for the partner: add an `email` field if real contact details are needed. |
| 3 | The first version of the sync script ran from our laptops and failed on every artisan with "Connection terminated due to connection timeout" and "getaddrinfo ENOTFOUND aws-0-REGION.pooler.supabase.com". | Two causes. First, `DATABASE_URL` in the new folder's `.env` still held the placeholder host from `.env.example`. Second, after that was fixed, our laptop could not open a connection to Supabase on port 5432 (`npm run check:db` showed "no answer after 6 seconds"), even though DNS resolved and the connection string was valid. | Stopped connecting to the database from the laptop. The script now calls our own hosted API (`POST /api/auth/register` on Render), and the Render service writes to Supabase. | Environment and our setup, not a code bug. Fixed by us. |
| 4 | Running the new script printed "Could not reach your API: UNABLE_TO_VERIFY_LEAF_SIGNATURE", although `curl.exe https://meditrac-api.onrender.com/api/medications` returned 200 OK. | Node checks certificates against its own built-in list, while curl uses the Windows certificate store. A network or antivirus layer that re-signs HTTPS traffic is trusted by Windows but rejected by Node. | Ran Node with the Windows certificate store (`NODE_OPTIONS=--use-system-ca`) for that terminal session only. Nothing was changed in the code or `.env`. [CONFIRM: if you used `NODE_TLS_REJECT_UNAUTHORIZED=0` for one run instead, say so here.] | Environment. Fixed by us. |
| 5 | The sync failed with "UND_ERR_CONNECT_TIMEOUT" on the first request to the partner, although the same request had worked earlier. | The partner's Render server was asleep. Free Render services take about a minute to wake after a quiet spell, and Node gave up after about 10 seconds. | Woke the server with a `curl.exe` call and ran the sync again, and it then fetched all 31 artisans. No code change. For demos, make a warm-up call first. | Partner's hosting. Nothing to fix on either side. Retries and timeouts are next week's topic. |
| 6 | Risk of our own sign-up limit stopping the import: 31 artisans, but our API allows only 20 successful sign-ups per IP per hour. | `REGISTER_LIMIT_PER_HOUR` defaults to 20 in `server/index.js`. | The script stops with a clear message on HTTP 429 and treats already-added artisans as "already existed" on a re-run, so it is safe to repeat. [CONFIRM: say whether you raised `REGISTER_LIMIT_PER_HOUR` on Render, or whether the limit was never hit.] | Ours (our own limit). Fixed by us. |
| 7 | After replacing the script, the old version kept running: output still said "First artisan from partner" and "Connection terminated". | The new code had been pasted into a different copy of the project folder than the one the terminal was running (there were several unzipped copies). | Checked the file with `Select-String -Pattern "pool","register"` to see which version was on disk, then wrote the new file directly from PowerShell. Kept using one folder from then on. | Ours (workflow). Fixed by us. |
| 8 | `npm run sync:artisans` failed with "Cannot find module 'dotenv'", then "Missing script: sync:artisans", then `npm install` failed with "Could not read package.json". | The zip does not include `node_modules`. The commands were also run from the wrong folders: the website folder (`iap`) and the folder above the project each have no `sync:artisans` script. The backend lives in `iap/server`. | Ran `npm install` inside `iap/server`, and ran the sync from `iap/server`. | Ours (setup). Fixed by us. |
| 9 | Artisan accounts could not be logged into. | The sync creates each account with a random password that is never stored or shown, so nobody knows it. (Our API has no password-reset endpoint.) | For testing, set one known password for all artisan accounts. Generated a bcrypt hash with Node and ran an `UPDATE` on `users` in the Supabase SQL Editor, limited to emails like `artisan-%@find-my-artisan.invalid`. | Ours (design decision). Fixed by us. |
| 10 | The SQL update failed with "ERROR 42601: trailing junk after parameter at or near $2b$10$...". | Two mistakes: the bcrypt hash was not wrapped in single quotes (Postgres read `$2b$10$...` as a parameter), and the query targeted `auth.users`, which is Supabase's own login table and has no `password_hash` column, instead of our `public.users`. The query failed before changing anything. | Quoted the hash and changed the table to `public.users`. | Ours. Fixed by us. |

## Things we tested on purpose

| Test | What we did | Result |
|---|---|---|
| Good key, list of artisans | `curl.exe -i -H "X-API-Key: <key>" .../artisans` | 200 with 31 artisans. |
| Re-running the sync | Ran `npm run sync:artisans` more than once | [CONFIRM after running: expect "0 added, 31 already existed, 0 skipped"] |
| Wrong key | [Run: `curl.exe -i -H "X-API-Key: wrong" .../artisans/1` and write the result] | [Expect 401 `{"code":"unauthorized"}`] |
| ID that does not exist | [Run: `curl.exe -i -H "X-API-Key: <key>" .../artisans/99999` and write the result] | [Write the status code] |
| Partner stopped or unreachable | A real example happened by accident: the first request timed out while their server was asleep (bug 5) | Sync failed with a clear error and no partial data was written. |

## Helping our downstream partner (Part E)

[Write what Team 3 reported to us: any 401s, 404s or 429s seen in our server logs, whose side the problem was on, and what we changed. If nothing was reported, write "Nothing reported by Team 3 during the lab; we watched our logs throughout."]

Our rate limits, so partners know what to expect: public read endpoints allow 120 requests per IP per minute, and sign-ups allow 20 per IP per hour (`REGISTER_LIMIT_PER_HOUR`).

## What we would do differently

- Ask the partner for an `email` field before designing the import, instead of finding out from the first response.
- Keep one project folder, so a script update cannot land in the wrong copy.
- Add a warm-up call to the demo routine, because free Render services sleep.
- Add timeouts and retries to the partner call (next week's topic).
