# MediTrac Partner API

Create your pharmacy on MediTrac, publish your stock, and keep both up to date from your
own app. Once your pharmacy has a map pin, it shows up in the public search and on every
app that uses the [Public API](PUBLIC_API.md).

All requests and responses are JSON. Replace `API` with the address of the MediTrac server
(for example `http://localhost:5000`). A complete runnable example is in
`examples/partner-sync.js` (`node examples/partner-sync.js`).

## 1. Create your pharmacy

```
POST /api/auth/register
```

```json
{
  "accountType": "pharmacy",
  "name": "Partner Chemist",
  "email": "owner@partner.example",
  "password": "at-least-6-characters",
  "phone": "0712345678",
  "address": "Tom Mboya St, Nairobi",
  "opening_hours": "Mon-Sat 8am-8pm",
  "latitude": -1.2833,
  "longitude": 36.8219
}
```

Only `accountType`, `name`, `email` and `password` are required. `latitude` and `longitude`
(your map pin) go together. You can add the rest later with step 3. The response contains
your **token** and your account:

```json
{ "token": "eyJhbGciOi...", "account": { "id": "07307942-...", "type": "pharmacy", "name": "Partner Chemist", "...": "..." } }
```

Send the token with every request that needs a login: `Authorization: Bearer <token>`.
It lasts 7 days. Keep it secret, like a password.

An email can be used for one pharmacy: registering it again returns `409`. Log in instead:

```
POST /api/auth/login      { "accountType": "pharmacy", "email": "...", "password": "..." }
```

## 2. Pin your location

Either send `latitude` and `longitude` when you register, or later via step 3. Pharmacies
without a pin are not listed in the public map or in distance searches.

## 3. Update your own details

```
PATCH /api/pharmacies/me          (needs your token)
```

```json
{ "opening_hours": "Daily 8am-10pm", "phone": "0733000000" }
```

Send only what you want to change. You can update `name`, `phone`, `address`,
`opening_hours`, and `latitude` + `longitude` together. An empty string clears an optional
field. `GET /api/pharmacies/me` returns your current details. Your email and password
cannot be changed through the API.

## 4. Upload your stock

```
POST /api/medications/bulk        (needs your token)
```

```json
{
  "medications": [
    { "sku": "AMX-500", "name": "Amoxicillin 500mg", "form": "Capsules", "category": "Antibiotic",
      "quantity": 40, "unit": "Boxes", "price": 640, "branch": "CBD" },
    { "sku": "PCM-500", "name": "Paracetamol 500mg", "form": "Tablets", "category": "Analgesic / Pain Relief",
      "quantity": 100, "unit": "Boxes", "price": 50 }
  ]
}
```

| Field | Rule |
|---|---|
| `name`, `quantity`, `price` | Required. `quantity` is a whole number 0 or more (0 = out of stock). `price` is 0 or more |
| `sku` | Your own product code (up to 64 characters). **Include it.** See below |
| `form`, `category`, `unit`, `branch` | Optional text |

The response says what happened:

```json
{ "created": 1, "updated": 1,
  "results": [ { "id": "...", "sku": "AMX-500", "name": "Amoxicillin 500mg", "action": "created" },
               { "id": "...", "sku": "PCM-500", "name": "Paracetamol 500mg", "action": "updated" } ] }
```

- **Safe to repeat.** Send your whole list again whenever stock changes. Each item is matched
  to one of *your* existing listings and updated; otherwise it is created. Items with a `sku`
  are matched by `sku`; items without one are matched by exact `name` + `form`. Without a
  `sku`, renaming a medicine creates a new listing instead of updating the old one.
- **All or nothing.** If any item is invalid, nothing is saved, and the `400` response lists
  every problem with its position, for example `medications[3]: quantity must be 0 or more`.
- **Limits.** 1 to 500 items and 1 MB per request. Send several requests for bigger lists.
- Uploading never deletes anything. To remove a medicine, use `DELETE` below, or upload it
  with `quantity: 0` to show it as out of stock.

## 5. Small changes

These follow the agreed API contract (`openapi.yaml`), which has **no login token**, so they
work without one. If you do send your token (`Authorization: Bearer <token>`), you can only
change your own listings: a different `pharmacy_id` returns `403`, and someone else's listing
returns `404`. If the server's owner has set `REQUIRE_LOGIN_FOR_WRITES=true`, the token is
required (`401` without it).

| Request | Does |
|---|---|
| `GET /api/medications/mine` | Your listings, with their `id` and `sku` (needs your token) |
| `PATCH /api/medications/{id}/stock` with `{ "quantity": 12 }` | Change just the quantity |
| `PUT /api/medications/{id}` | Replace a listing's details (send the whole record, including `pharmacy_id`) |
| `POST /api/medications` | Add one listing (`409` if you already use that `sku`) |
| `DELETE /api/medications/{id}` | Remove a listing |

## What becomes public

Anyone can read, through the Public API: your pharmacy's **name, phone, address, opening
hours and map pin**, and every listing's **name, form, category, quantity, unit, price and
branch**. Your **email, password and `sku` values are never public.**

## Limits and errors

| Limit | Value |
|---|---|
| Token lifetime | 7 days (log in again to get a new one) |
| New accounts | 20 successful sign-ups per IP address per hour |
| Failed logins | 20 per IP address per 15 minutes |
| Public read endpoints | 120 requests per minute per IP address |
| Stock upload | 500 items and 1 MB per request |

| Status | Meaning |
|---|---|
| `400` | Invalid input. `errors` (or `error`) says exactly what to fix |
| `401` | No token where one is needed, or it is invalid or expired. Log in again |
| `403` | The token is for a patient account, or `pharmacy_id` is not yours |
| `404` | Not found, or it belongs to another pharmacy |
| `409` | Email or `sku` already in use |
| `413` | Request body over 1 MB |
| `429` | Too many requests. Wait and retry |

## Calling it from a website

Server-to-server calls (Node, Python, PHP, curl...) always work. Calls made from a web page
in a browser are allowed from any website by default. The server's owner can restrict this to
named sites with `PARTNER_ORIGINS` in `server/.env`. Since your login is a token you send in a
header (not a cookie), another website cannot act as you without that token.

## Good to know

- There is no review step: a pharmacy appears publicly as soon as it has a pin. The server's
  owner can remove one directly in the database.
- There is no endpoint to delete a pharmacy account or to change its email or password.
