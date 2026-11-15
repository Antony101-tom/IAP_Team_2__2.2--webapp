# MediTrac API: getting started

MediTrac lets you read pharmacy and medicine data (where can I find this medicine, which pharmacies are near me, what does this pharmacy stock?) and, if you are a pharmacy or partner, publish and update your own stock.

- **Live address:** `https://meditrac-api.onrender.com`
- **Current version:** `v2` (paths start with `/api/v2`)
- **Format:** JSON in, JSON out

This page gets you from nothing to a working call in five minutes. For the full details, see [PUBLIC_API.md](PUBLIC_API.md) (reading data), [PARTNER_API.md](PARTNER_API.md) (publishing stock) and [openapi.yaml](openapi.yaml) (the exact contract).

> **First call may be slow.** The server sleeps when idle, so the first request after a quiet period can take up to a minute. Retry once before you assume something is broken.

---

## 1. Get an API key

Every request needs an API key in the `X-API-Key` header. Ask the API owner (Team 2) for one: each consumer gets their own key, so keep it private and **never commit it to git or paste it into a chat**. Use `<your-api-key>` wherever you see it below.

## 2. Make your first call

```bash
curl -i -H "X-API-Key: <your-api-key>" "https://meditrac-api.onrender.com/api/v2/pharmacies"
```

On Windows PowerShell, use `curl.exe` instead of `curl`. A good first response starts with `HTTP/1.1 200 OK`:

```json
{
  "data": [
    { "id": "a1000000-0000-4000-8000-000000000002", "name": "Wellness Pharmacy",
      "phone": "0722000002", "address": "Tom Mboya Street, Nairobi", "opening_hours": "Daily 7am-10pm",
      "latitude": -1.2833, "longitude": 36.8219, "in_stock_count": 3 }
  ],
  "count": 1
}
```

From JavaScript:

```js
const API = 'https://meditrac-api.onrender.com/api/v2';
const KEY = process.env.MEDITRAC_API_KEY; // load it from configuration; never hard-code a real key

const res = await fetch(`${API}/pharmacies`, { headers: { 'X-API-Key': KEY } });
if (!res.ok) throw new Error(`MediTrac returned ${res.status}`);
const { data, count } = await res.json();
```

---

## 3. Reading data (API key only, no login)

| Request | What you get |
|---|---|
| `GET /api/v2/pharmacies` | Pharmacies with a map pin, as `{ data, count }` |
| `GET /api/v2/pharmacies/{id}` | One pharmacy and the medicines it stocks |
| `GET /api/v2/medications` | Every listing across all pharmacies |
| `GET /api/v2/medications/search?name=` | "Where can I find this medicine?" (`name` is required) |
| `GET /api/v2/medications/by-pharmacy?name=` | The listings of one pharmacy (exact name) |

**Near me.** `/pharmacies` and `/medications/search` accept `lat` and `lng` (send both). Each result then includes `distance_km` (a straight line, not driving distance) and the list is sorted nearest first.

| Parameter | Meaning |
|---|---|
| `lat`, `lng` | The user's position |
| `radius_km` | Only results within this many km (needs `lat` and `lng`) |
| `limit` | Maximum results, 1 to 500 (default 100) |
| `in_stock=true` | Search only: hide anything with quantity 0 |

Example: amoxicillin in stock near central Nairobi.

```bash
curl -H "X-API-Key: <your-api-key>" \
  "https://meditrac-api.onrender.com/api/v2/medications/search?name=amoxicillin&lat=-1.2833&lng=36.8219&in_stock=true"
```

Each medication result already includes its pharmacy's name and location, so you can place a map marker straight from it. A pharmacy's `phone`, `address` and `opening_hours` are `null` if it hasn't provided them.

---

## 4. Writing data (for pharmacies and partners)

To change stock you need your pharmacy's **login token** as well as the API key.

**Log in** (or create your pharmacy: see [PARTNER_API.md](PARTNER_API.md)):

```bash
curl -X POST -H "X-API-Key: <your-api-key>" -H "Content-Type: application/json" \
  -d '{"accountType":"pharmacy","email":"<your-email>","password":"<your-password>"}' \
  "https://meditrac-api.onrender.com/api/v2/auth/login"
```

The response has a `token` and your `account.id`. Send the token as `Authorization: Bearer <token>` on later calls. It lasts 7 days, so log in again when it expires.

| Request | What it does | Success |
|---|---|---|
| `POST /api/v2/medications` | Create one medication | `201` |
| `PUT /api/v2/medications/{id}` | Replace a medication (send every field) | `200` |
| `PATCH /api/v2/medications/{id}/stock` | Change only the quantity | `200` |
| `DELETE /api/v2/medications/{id}` | Remove it | `204` (no body) |
| `POST /api/v2/medications/bulk` | Upload your whole stock list (safe to repeat) | `200` |
| `PATCH /api/v2/pharmacies/me` | Update your pharmacy's details | `200` |
| `PUT /api/v2/pharmacies/me/location` | Set your map pin | `200` |

**Create a medication.** `pharmacy_id` is required in the body, and must be your own id if you send your token:

```bash
curl -X POST \
  -H "X-API-Key: <your-api-key>" -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"name":"Amoxicillin 500mg","quantity":24,"price":180,"pharmacy_id":"<your-pharmacy-id>"}' \
  "https://meditrac-api.onrender.com/api/v2/medications"
```

**Change the stock** of a medication you created (use the `id` from the response above):

```bash
curl -X PATCH \
  -H "X-API-Key: <your-api-key>" -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"quantity":9}' \
  "https://meditrac-api.onrender.com/api/v2/medications/<medication-id>/stock"
```

`quantity` must be a whole number, 0 or more. A pharmacy can only change its own stock.

> By default the create, update and delete endpoints accept just an API key. The server owner can require a login for them (`REQUIRE_LOGIN_FOR_WRITES=true`). Always send your token anyway: it is the correct way to use them, and it will keep working if the owner turns the requirement on.

---

## 5. Versions: v2 and the old v1

The API is versioned in the URL.

| Address | Pharmacy list returns | Status |
|---|---|---|
| `/api/v2/pharmacies` | `{ "data": [ ... ], "count": N }` | **Current** |
| `/api/v1/pharmacies` and the old `/api/pharmacies` | A bare list `[ ... ]` | **Deprecated**: stops working on **18 November 2026** |

That is the only difference. Every other endpoint answers the same under `/api/v1`, `/api/v2` and `/api`.

If you still use v1, the response tells you: it carries `Deprecation: true`, `Sunset: <date>` and a `Link` header pointing at the replacement. To move to v2: change the URL to `/api/v2/pharmacies` and read the list from `body.data` instead of the body itself. See [DEPRECATION_NOTICE.md](DEPRECATION_NOTICE.md).

---

## 6. Status codes and errors

Check the status code of every response before you read the body.

| Status | Meaning | What to do |
|---|---|---|
| `200` / `201` / `204` | Success (read or update / created / deleted) | Carry on |
| `400` | Invalid input | Read `errors` in the body, fix the request |
| `401` | Missing or wrong API key (or login token) | Check the `X-API-Key` header and your token |
| `403` | You are logged in, but the item is another pharmacy's | Use your own id |
| `404` | No such id, name or path | Check the id and the URL |
| `409` | Conflict (for example that email is already registered) | Log in instead |
| `429` | Too many requests | Wait the number of seconds in the `Retry-After` header |
| `500` / `502` | Server problem | Retry once or twice after a short wait |

Error bodies look like one of these:

```json
{ "message": "Validation failed", "errors": ["quantity must be 0 or more"] }
```
```json
{ "error": "Pharmacy not found" }
```

## 7. Limits and good manners

- **Rate limit:** 100 requests per API key per minute. When you exceed it you get `429` and a `Retry-After` header. Wait that long, then continue. Your limit is separate from other consumers'.
- **Sign-up and login:** stricter per-IP limits apply (a limited number of sign-ups per hour and failed logins per 15 minutes).
- **Read once per page load** where you can, rather than on every keystroke. Cache results for a few seconds or minutes if the data doesn't need to be live.
- **Set a timeout** on your calls (for example 5 seconds, and longer for the very first call) and retry only reads (GET), never writes.
- **Browsers:** the read endpoints can be called from any website (CORS is open), but a key shipped in browser code is visible to everyone. For anything private, call the API from your own server.
- **Never commit a key or token.** If one is exposed, tell the API owner and ask for a new one.

## 8. Something not working?

| You see | Likely cause |
|---|---|
| Blank output or `curl: (7)` | The server is not reachable, or the URL is wrong |
| First call hangs for about a minute | The server was asleep and is waking up. Wait and retry |
| `401` on a call that should work | The key is missing, mistyped, or your login token expired |
| `404 Pharmacy not found` when creating | `pharmacy_id` doesn't match a pharmacy; use the `account.id` from login |
| `403` when changing stock | The medication belongs to another pharmacy |
| `429` | You are over 100 requests a minute. Slow down and honour `Retry-After` |
| An empty list from `/pharmacies` | Pharmacies only appear once they have a map pin |

## 9. Monitoring

`GET /stats` (the root path, no `/api`) returns running totals since the server started: requests, errors, response times and one row per route, including each version separately. It also needs your `X-API-Key`.

## 10. More

- [PUBLIC_API.md](PUBLIC_API.md): everything you can read, with examples
- [PARTNER_API.md](PARTNER_API.md): create your pharmacy and publish stock
- [openapi.yaml](openapi.yaml): the exact request and response contract
- [DEPRECATION_NOTICE.md](DEPRECATION_NOTICE.md): the v1 to v2 change
- `examples/`: runnable examples, including `partner-sync.js` and a map demo
