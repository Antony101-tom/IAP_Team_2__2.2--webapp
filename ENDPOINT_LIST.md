# Endpoint List

| Method | Path | Purpose | Maps to Need |
|--------|------|---------|---------------|
| GET | `/pharmacies/{id}/location` | Return a pharmacy's location details for map/directions display | Need 4 |
| GET | `/pharmacies?fields=stock,name,location` | Return current stock levels, medication names, and store locations for catalog display | Need 3 |
| PATCH | `/pharmacies/{id}/stock` | Update stock counts for a pharmacy without touching other fields | Need 2 |
| POST | `/pharmacies` | Create a new pharmacy record with name, meds, stock, price | Need 1 |
| PUT | `/pharmacies/{id}` | Update an existing pharmacy's name, medications, stock, prices | Need 1 |

## Peer Review

**Comments from Team 4**

> GET `/pharmacies?fields=stock,name,location` — Is it for specific pharmacies or all the pharmacy records? Might use: GET `/pharmacies/{id}?fields=stock,location,name`

**Reply to Team 4 comments**

> Row kept as `/pharmacies?fields=...` (collection-level): scoping to `/{id}` would require one request per pharmacy, contradicting the need's "avoid excessive server requests" requirement for populating the full catalog.