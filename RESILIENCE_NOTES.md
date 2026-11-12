# Resilience Notes: Week 11

**Feature:** Find an Artisan (`GET /api/artisans`, `GET /api/artisans/:id`), which calls our upstream partner, Find My Artisan.
**Code:** `server/resilientFetch.js` (timeout + retry), `server/routes/artisans.js` (saved-data fallback), `src/components/ArtisanFinder.jsx` (banner), `server/flaky-partner.js` (stand-in partner used for the drill).

## 1. Before (Part A: the Week 10 behaviour)

I ran the Week 10 route against the stand-in partner.

- **Normal (`ok` mode):** a call took 0.0084 s.
- **Slow (`slow` mode, the partner answers after 10 s):** the Find an Artisan page hung on "Loading artisans…" for about 10 s. There was no way to give up (the old timeout was 70 s).
- **Flaky (`flaky` mode, fails twice then works):** only 2 of 6 page loads worked. The other 4 showed "Could not load artisans", even though a second attempt would have succeeded.

## 2. What I tested (after the changes)

| Failure | What the user saw | What the log said |
|---|---|---|
| Normal (`ok`) | Live list, no banner. | nothing |
| Slow (`slow`), saved copy exists | The same list with a yellow banner: "Showing saved data from 12:01:30. Find My Artisan is not responding…". At the first default timeout (5000 ms) this took about 20 s; at 1500 ms it took about _5__ s. | `attempt 1 failed (timeout), retrying in 200 ms`, `attempt 2 failed (timeout), retrying in 400 ms`, `partner call failed: timeout` |
| Slow, **nothing saved** (server just restarted) | Red message: "The artisan service took too long to answer. It may be waking up: try again in a minute." with a Try again button. No crash, no blank page. | three `timeout` lines |
| Flaky (503, 503, then OK) | ___ (live list, no banner?) | ___ |
| Always failing (`error`, HTTP 500) | ___ (saved list with banner?) | ___; the stand-in terminal showed ___ `GET /artisans` lines for one reload (expected 3) |
| Partner stopped (real partner) | ___ | ___ |
| Wrong API key (my extra case) | The page gets HTTP 502 "refused this server's credentials", not a login error. It is not retried (1 call). Covered by an automated test. | `partner refused our API key (HTTP 401)`. The key itself is never logged (an automated test checks this). |

Automated tests (`npm test` in `server/`, 323 passing) also check that a 404 is never retried or replaced by old data, that 429 honours `Retry-After`, that POST/PATCH/DELETE are never retried, and that saved data is kept per search.

## 3. My numbers, and why

| Setting | Value | Why |
|---|---|---|
| Timeout | **1500 ms** (`PARTNER_TIMEOUT_MS`) | The stand-in answers in about 9 ms, so 1.5 s leaves plenty of room for a bad moment. My first run used the default of 5000 ms, and the page took about 20 s before showing the fallback. That is far longer than a user would wait, so I lowered it. Real partner's normal response time: ___ s. |
| Retries | **2** (3 attempts in total), GET only | The most the handout allows. Booking, cancelling and review writes are never retried, because a retry could book twice. |
| Delay | **200 ms, then 400 ms**; `Retry-After` honoured on 429 (up to 5 s) | The wait grows, so a struggling partner is not hit in a tight loop. |
| Worst-case wait | 3 × 1500 + 200 + 400 = **5100 ms**. Measured: about ___ s. | `(retries + 1) × timeout + delays`. About 5 s is acceptable here because the user then sees saved data and not an error. |

**Cold starts.** In Week 10 (bug 5) the partner's free Render server took about a minute to wake after a quiet spell. No sensible timeout waits that long. The first load after a quiet spell may show the friendly error (or saved data) while it wakes, and trying again a minute later works. The Week 10 timeout of 70 s only hid this by making every user wait. For demos I make a warm-up call first.

## 4. What a real user would experience without this code

A pharmacy manager opens the Find an Artisan page to book an electrician for a broken light in the dispensary. With the Week 10 code, a slow partner leaves them looking at "Loading artisans…" for ten seconds or much longer (up to 70), so many would close the tab and phone someone instead. When the partner is flaky, the page shows "Could not load artisans" on about two loads in three, and the user clicks Try again without knowing a second attempt usually works. When the partner is down, they get an error and no artisans at all, even though the page showed the list a minute ago. With the new code the same manager sees the list within about five seconds, with a banner that says when the data was saved, and can still phone the artisan. They cannot book a time until the partner is back, which is correct, because a booking has to be recorded at the partner.

## 5. What I did not build

A **circuit breaker** is a switch that stops calling a partner that has been failing for a while and only tests it occasionally. Mine still tries every request three times, so during a long outage every page load waits up to the full worst-case time before showing saved data. A breaker would skip straight to the saved copy, so the page would be instant, and the struggling partner would stop getting three requests for every page load.

## 6. Real partner drill (Part E)

- Normal: ___
- Partner stopped: ___ (saved data with banner after about ___ s)
- Partner restarted: ___ (live data, banner gone, no code change)
- Retries seen in my own logs from my downstream partner: ___

## Limits I know about

- The saved copy is kept in server memory, so it disappears when the server restarts.
- A saved copy hides a wrong partner key from users, so the log is how I would find that out.
- Only the two read routes fall back to saved data. Booking and review writes fail with a clear message instead.
