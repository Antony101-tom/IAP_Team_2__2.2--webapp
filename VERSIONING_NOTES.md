# Week 13: Versioning notes

## 1. The change
`GET /api/pharmacies` now returns `{ "data": [ ... ], "count": N }` in v2 (at `/api/v2/pharmacies`) instead of a bare list `[ ... ]`. Nothing else changes.

## 2. Why it is worth a break
A bare list has nowhere to put anything but the items. Wrapping it now lets us add paging (`next`, `total`) later without a second breaking change, and `count` saves callers from counting.

## 3. Prediction: the line in my partner's code that will fail
Team 3 reads the pharmacy list to draw their map. Our own example consumer shows the pattern most callers will have, `examples/map-demo.html`:

```js
const list = await get('/api/pharmacies', near);
groups = list.map((p) => ({ ...p, lines: [...] }));   // <- fails on v2
```

On the v2 body, `list` is an object, so `list.map` is `undefined` and throws "list.map is not a function".
They do not break today: `/api/pharmacies` and `/api/v1/pharmacies` still return the bare list.

**TODO before sending the notice:** ask Team 3 for the exact file and line where they call `/api/pharmacies` and replace the example above with theirs.

## How v2 was built
- `v1.js` / `v2.js`: two routers over the same data. Both mount `sharedRoutes.js`, so every endpoint that did **not** change is the same code in both versions.
- `routes/pharmacies.js`: the list query moved into one function, `fetchPharmacyList`, used by both versions. v1's output is byte-identical (proof below).
- `index.js`: `/api/v2` and `/api/v1` and `/api` (old URLs) are mounted **after** `requireApiKey()` and the rate limiter.
- Login and register limiters now cover all three prefixes with **one** counter each, otherwise a password guesser could triple their attempts by changing the URL. This is tested.
- CORS patterns accept `/api/v1` and `/api/v2` prefixes, so browser apps can call v2.
- `monitoring.js` needed no change: your log already records the full path and `/stats` already uses `req.baseUrl`, so the three URLs are three rows.
- Only the pharmacy **list** carries `Deprecation`/`Sunset`/`Link` headers, because it is the only thing that changed. The sunset date is `2026-11-18` (override with `V1_SUNSET`).

## Evidence that v1 did not change
- `node scripts/snapshot-v1.js v1_before.json` before the work, `v1_after.json` after: `diff v1_before.json v1_after.json` printed nothing.
- `__tests__/versions.test.js` keeps proving it (field names, bare list, error shapes, old URLs).
- All 326 earlier tests still pass (342 in total).

## 4. Who still uses v1? (Part F, fill in from the live server)
TODO: run `curl -s -H "X-API-Key: <key>" <url>/stats` and copy the counts for `GET /api/pharmacies` and `GET /api/v1/pharmacies`, and the caller labels from the log.
- Calls on v1 / caller labels: ...
- Is Team 3 still on v1? ...
- Could I switch v1 off today without breaking anyone? ...

## 5. Part E: receiving Find My Artisan's notice (Team 1, dated 2026-11-11)
**Judging the notice.** It says what changes (reviews need a finished job logged for Meditrac, else `403 no_job`), why (reviews feed the `verified` badge), a before and after, migration steps, a curl command to try v2 by hand, and a sunset date (Tue 24 Nov 2026). It also says what is *not* changing. What it leaves open: the headline says "v1 of the API" but "What is changing" lists only the review POST, and it says v1 will "stop working" on 24 Nov but later that v1 "keeps answering after it" until they turn it off. Specific question to send: *"On 24 Nov, does v1 stop answering, or only start to be monitored? And does `GET /v2/artisans?trade=` accept the same filters?"* TODO: write one or two sentences on how it felt to receive it.

**What I changed** (all of it is in one place):
- `server/partner.js` (new): `versions = { v1: '', v2: '/v2' }`, `partnerPath()`, and `PARTNER_VERSION` read from `.env` (default `v1`; a typo throws).
- `server/routes/artisans.js`: the one `fetchWithRetry` URL now goes through `partnerPath(path)`, so list, single artisan, availability and reviews all move together. Nothing else in the route changed.
- `server/scripts/sync-artisans.js`: uses `partnerPath('/artisans')` too.
- `.env.example`: `PARTNER_VERSION=v1`. Migrating is one word, and so is the rollback.
- A one-time log line when the partner replies with a `Deprecation` header, with its sunset date. This would have told us before the notice did.
- `403 no_job` was already handled (explained to the user, not mistaken for a refused key, never retried, since writes are not retried). Their v2 message is different from ours, so we keep our own explanation.
- Tests: `server/__tests__/partner.test.js` (11 tests).

**Why there is no `parse()` per version** (unlike the handout's example): the partner says the request body, 201 response and every other path are the same in v2, so there is nothing to translate. The handout's "fail loudly" idea is applied where a mistake is possible: an unknown `PARTNER_VERSION` throws, and a real 404 is never replaced by saved data.

**Still to do by hand (I cannot reach their server from here):**
1. Run their curl, with your real key (artisan 3 should answer `403 no_job` and write nothing).
   `curl -X POST -H "X-API-Key: <your-key>" -H "Content-Type: application/json" -d '{"author":"test","rating":5}' https://find-my-artisan.onrender.com/v2/artisans/3/reviews`
2. Set `PARTNER_VERSION=v2` in `server/.env`, restart, and load the artisans page. The response must have `"stale": false`, and the terminal must show no `partner call failed` or `serving saved copy` lines. (The Week 11 fallback can hide a broken migration behind saved data.)
3. Switch to v1, reload, then back to v2. Both work until the sunset date.
4. Ask Team 1 to look in their `/stats` or log: a row `POST /v2/artisans/:id/reviews` from your caller label, and the v1 counts no longer growing. Copy the lines here: TODO.
5. When booking an artisan by phone, ask them to log the job for Meditrac on their dashboard (their migration step 3). Our own "mark as done" check is separate and stays.

## 6. Reflection (150 to 250 words, in your own words)
TODO. Answer: (1) what it was like to receive a breaking change and what you did first, (2) what your partner's notice did well and what was missing, (3) what you would change in your own notice, (4) one thing you would do differently as API owner.
