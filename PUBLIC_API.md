# MediTrac Public API

Read pharmacy data from another app and build your own pharmacy map or "find this
medicine near me" feature. The public endpoints are **read-only, need no login or API
key**, and can be called from any website (CORS is open for them).

Base URL: wherever the MediTrac server runs, for example `http://localhost:5000` or
`http://192.168.1.20:5000` (see "Making it reachable" below).

## What you can read

| Endpoint | Returns |
|---|---|
| `GET /api/pharmacies` | Pharmacies that have pinned their location, optionally nearest first |
| `GET /api/pharmacies/{id}` | One pharmacy and everything it stocks |
| `GET /api/medications/search` | "Where can I find this medicine?", nearest first |
| `GET /api/medications` | Every listing across all pharmacies (with pharmacy name and pin) |
| `GET /api/medications/by-pharmacy?name=` | Listings for one pharmacy, by name |

To create a pharmacy and upload your own stock, see the [Partner API](PARTNER_API.md).
Emails, passwords and patient data are never returned by the public endpoints. A
pharmacy's `phone`, `address` and `opening_hours` are `null` unless it has provided them.

### Near-me parameters (`/api/pharmacies` and `/api/medications/search`)

| Parameter | Meaning |
|---|---|
| `lat`, `lng` | Where the user is. Give both. Adds `distance_km` and sorts nearest first |
| `radius_km` | Only results within this many km (0 to 500). Needs `lat` and `lng` |
| `limit` | Maximum results, 1 to 500 (default 100) |

Search also takes `name` (required: matches the medicine's name or category) and
`in_stock=true` (hide anything with quantity 0).

`distance_km` is a straight line ("as the crow flies"), not driving distance.

## Examples

### Pharmacies within 5 km of a point

```
GET /api/pharmacies?lat=-1.2833&lng=36.8219&radius_km=5
```

```json
[
  { "id": "a1000000-0000-4000-8000-000000000002", "name": "Wellness Pharmacy",
    "phone": "0722000002", "address": "Tom Mboya Street, Nairobi", "opening_hours": "Daily 7am-10pm",
    "latitude": -1.2833, "longitude": 36.8219, "in_stock_count": 3, "distance_km": 0 },
  { "id": "a1000000-0000-4000-8000-000000000001", "name": "Halisi Pharmaceuticals",
    "phone": "0722000001", "address": "Kilimani, Nairobi", "opening_hours": "Mon-Sat 8am-9pm",
    "latitude": -1.2921, "longitude": 36.7872, "in_stock_count": 4, "distance_km": 3.98 }
]
```

### Where can I get amoxicillin near me?

```
GET /api/medications/search?name=amoxicillin&lat=-1.2833&lng=36.8219&in_stock=true
```

```json
[
  { "id": "c3000000-0000-4000-8000-000000000007", "name": "Amoxicillin 500mg",
    "form": "Capsules • 10x10 pack", "category": "Antibiotic", "quantity": 12,
    "unit": "Boxes", "price": 620, "branch": "CBD Branch",
    "pharmacy_id": "a1000000-0000-4000-8000-000000000002", "pharmacy": "Wellness Pharmacy",
    "latitude": -1.2833, "longitude": 36.8219, "distance_km": 0 }
]
```

Each result already has the pharmacy's `latitude` and `longitude`, so you can drop a
marker straight from it. Results are one row per listing, so group by `pharmacy_id` if
you want one pin per pharmacy.

### From JavaScript

```js
const API = 'http://localhost:5000';

async function findMedicine(name, lat, lng) {
  const url = `${API}/api/medications/search?` + new URLSearchParams({ name, lat, lng, radius_km: 10, in_stock: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json()).errors?.join(', ') || res.status);
  return res.json();   // nearest first
}
```

`examples/map-demo.html` is a complete working map built only on these endpoints
(Leaflet and OpenStreetMap, no framework). Open it in a browser while the MediTrac server
is running, and copy whatever you need. If you use OpenStreetMap's map tiles in your own
app, follow their tile usage policy.

## Errors

Bad input returns `400` with `{ "message": "Validation failed", "errors": ["..."] }`.
An unknown pharmacy id returns `404`. More than 120 requests per minute from one IP
returns `429`. Responses are always JSON.

## Good to know

- Stock and prices change whenever a pharmacy updates them, so treat results as "as of now".
- Only pharmacies that have pinned their location on the map appear in `/api/pharmacies`
  and in distance-based results.
- These endpoints are read-only: nothing you call here can change MediTrac's data.

## Making it reachable

- **Same Wi-Fi:** start the server (`npm start` in `server/`), allow Node through the
  Windows Firewall for port 5000, then share `http://YOUR-IP:5000` (find it with
  `ipconfig`).
- **Over the internet, quickly:** a tunnel such as `ngrok http 5000` gives a temporary
  public address.
- **Permanently:** deploy the server and database to a host. Keep MySQL itself private:
  only the server should connect to it. Remove the demo accounts from `seed_data.sql` first.
