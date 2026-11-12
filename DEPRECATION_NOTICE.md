# Deprecation notice: MediTrac API, pharmacy list v1

To: Team 3  From: <your name>  Date: 12 November 2026

## Summary
`GET /api/pharmacies` (v1) is deprecated. v2 is live now at `GET /api/v2/pharmacies`. v1 will stop working on **18 November 2026**. Please move before then.

## What is changing
- The list is wrapped: `[ ... ]` becomes `{ "data": [ ... ], "count": N }`
- Nothing else changes: the fields inside each pharmacy (`id`, `name`, `phone`, `address`, `opening_hours`, `latitude`, `longitude`, `in_stock_count`, and `distance_km` when you send `lat`/`lng`), the query parameters (`lat`, `lng`, `radius_km`, `limit`), your API key, and the error responses.
- Every other endpoint (`/api/pharmacies/{id}`, `/api/medications/...`) is unchanged and also works under `/api/v2/...`.

## Why
Wrapping the list lets us add paging later without another breaking change.

## Before and after
v1 `GET /api/pharmacies`
```json
[ { "id": "a1", "name": "Wellness Pharmacy", "opening_hours": "Daily 7am-10pm",
    "latitude": -1.2833, "longitude": 36.8219, "in_stock_count": 3 } ]
```

v2 `GET /api/v2/pharmacies`
```json
{ "data": [ { "id": "a1", "name": "Wellness Pharmacy", "opening_hours": "Daily 7am-10pm",
              "latitude": -1.2833, "longitude": 36.8219, "in_stock_count": 3 } ],
  "count": 1 }
```

## How to migrate
1. Call `/api/v2/pharmacies` instead of `/api/pharmacies`. Same key, same query parameters.
2. Read the list from `body.data` instead of from the body itself. (If you loop with `.map`, that is the line to change.)
3. Test it, then tell me, so I can see your calls on `GET /api/v2/pharmacies` in my `/stats`.

## Timeline
- Today (12 Nov): v2 is live. v1 and the old `/api/pharmacies` URL still work and now send `Deprecation`, `Sunset` and `Link` headers.
- 18 Nov: v1 of the pharmacy list stops working.

## Questions
Message me any time. I will reply within <time>. Please reply once you have read this.
