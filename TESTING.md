# Testing the API

Three levels, from quick to thorough. Replace `localhost:5000` with your API's address if it is hosted.

## 1. Automated checks (no database needed)

```bash
cd server
npm test
```

Runs every endpoint against a fake database, including a test that reads `openapi.yaml` (the agreed contract) and checks
every response against it.

## 2. Test a RUNNING server, endpoint by endpoint

Start the API (`npm start` in `server/`), then in a second terminal:

```bash
cd server
npm run test:live
```

It walks through every operation in the contract one by one and prints `PASS` or `FAIL` for each. It checks the status
code and the shape of the response against the contract. It creates one medication called "ENDPOINT TEST" and deletes
it again. A good run ends with:

```
18 of 18 checks passed.
14 of 14 responses documented in the contract were produced by the server and matched it.
RESULT: READY. Another application can use these endpoints as the contract describes.
```

Anything else ends with `NOT READY` and a line saying exactly what was wrong. The commonest cause is testing a server that is running
OLDER code than your folder, for example a Render service that has not redeployed yet: lines such as `expected 404, got 400` on the
unknown-pharmacy checks and on the different-letter-case by-pharmacy check mean exactly that. Push your latest commit and wait for Render
to say "Your service is live" (or restart `npm start` from this folder), then run the test again. The exit code is non-zero, so it can also run in automation.

Settings (environment variables), for example in PowerShell: `$env:API_URL="https://your-api.example.com/api"; npm run test:live`

| Name | Meaning |
|---|---|
| `API_URL` | The API's address, ending in `/api`. Default `http://localhost:5000/api` |
| `PHARMACY_ID` | Which pharmacy to create the test medication for. Default: any existing one |
| `TOKEN` | A pharmacy's login token. Needed only if the server has `REQUIRE_LOGIN_FOR_WRITES=true`. Then `PHARMACY_ID` must be that pharmacy's id |

To get a token: `POST /api/auth/login` with `{"accountType":"pharmacy","email":"...","password":"..."}`.

## Testing through ngrok (or any public address)

Use the REAL address ngrok shows on its Forwarding line, not an example one. The tester wants it ending in `/api`:

```powershell
cd server
$env:API_URL="https://YOUR-REAL-ADDRESS.ngrok-free.app/api"
npm run test:live
```

Teammates can run exactly the same on their own computers (they need `npm install` in `server`, but no database or `.env`). It ends in
`READY` when the contract holds for everything they will call. The tester adds the `ngrok-skip-browser-warning` header by itself
when the address contains "ngrok".

If you test by hand with PowerShell, ngrok's free plan can answer with its warning page instead of data, because PowerShell announces itself
like a browser. Send the skip header:

```powershell
$h = @{ 'ngrok-skip-browser-warning' = 'true' }
Invoke-RestMethod https://YOUR-REAL-ADDRESS.ngrok-free.app/api/medications -Headers $h
```

(Postman and curl do not need it.) The extra example script takes the address WITHOUT `/api`:
`node examples/partner-sync.js https://YOUR-REAL-ADDRESS.ngrok-free.app`. It creates a pharmacy called "Partner Demo Pharmacy"; remove
it afterwards in the Supabase SQL Editor with `delete from pharmacies where email = 'partner-demo@example.com';` (its medications go with it).

The test also creates and deletes one medication called "ENDPOINT TEST". If the server has `REQUIRE_LOGIN_FOR_WRITES=true`, set
`TOKEN` and `PHARMACY_ID` as described above.

## POST, PUT and DELETE on a hosted server (login required)

The contract (`openapi.yaml`) takes no login, and by default the server follows it. A hosted server should have
`REQUIRE_LOGIN_FOR_WRITES=true` (see `RENDER.md`), and then `POST`, `PUT`, `PATCH` and `DELETE` on medications answer
`401 { "error": "Please log in as a pharmacy first." }` unless you send a pharmacy's login token. Reading (`GET`) never needs one.
That 401 is the server doing its job, not the endpoint being broken. To test with a login:

```powershell
$api = "https://meditrac-api.onrender.com/api"
$login = Invoke-RestMethod -Method Post -Uri "$api/auth/login" -ContentType 'application/json' -Body '{"accountType":"pharmacy","email":"YOUR-PHARMACY-EMAIL","password":"YOUR-PASSWORD"}'
$h = @{ Authorization = "Bearer $($login.token)" }
$pharmacyId = $login.account.id

# POST: the pharmacy_id must be YOUR pharmacy's id (from the login)
$body = @{ name='Test drug'; quantity=10; price=25.5; pharmacy_id=$pharmacyId } | ConvertTo-Json
$m = Invoke-RestMethod -Method Post -Uri "$api/medications" -Headers $h -ContentType 'application/json' -Body $body
# PUT replaces the whole record
$put = @{ name='Test drug v2'; quantity=7; price=30; pharmacy_id=$pharmacyId } | ConvertTo-Json
Invoke-RestMethod -Method Put -Uri "$api/medications/$($m.id)" -Headers $h -ContentType 'application/json' -Body $put
# DELETE
Invoke-RestMethod -Method Delete -Uri "$api/medications/$($m.id)" -Headers $h
```

A free Render API may need up to a minute to wake before the first call answers. The login token lasts 7 days. A pharmacy can only
change its own medications: someone else's id answers `404 Medication not found`, and a different `pharmacy_id` in the body answers `403`
(or `404 Pharmacy not found` if that pharmacy does not exist).

To run the whole check against the hosted API with that login:

```powershell
cd server
$env:API_URL = $api; $env:TOKEN = $login.token; $env:PHARMACY_ID = $login.account.id
npm run test:live
```

## Can't reach the database?

```bash
cd server
npm run check:db
```

Checks `DATABASE_URL`, finds the host, opens a connection from Node, logs in over an encrypted connection, and looks for the
tables, stopping at the first step that fails and saying what to do about it.

## 3. By hand (PowerShell)

```powershell
# 1. List everything
Invoke-RestMethod http://localhost:5000/api/medications

# 2. Create (use a real pharmacy id from step 1's pharmacy_id field)
$body = @{ name='Test'; quantity=10; price=25.5; pharmacy_id='a1000000-0000-4000-8000-000000000002' } | ConvertTo-Json
$m = Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/medications -ContentType 'application/json' -Body $body

# 3. Change its stock, then delete it
Invoke-RestMethod -Method Patch -Uri "http://localhost:5000/api/medications/$($m.id)/stock" -ContentType 'application/json' -Body '{"quantity":85}'
Invoke-RestMethod -Method Delete -Uri "http://localhost:5000/api/medications/$($m.id)"

# To see an error body (400, 404), PowerShell hides it unless you catch it:
try { Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/medications -ContentType 'application/json' -Body '{}' }
catch { $_.ErrorDetails.Message }
```

Or import `openapi.yaml` (and `openapi-extensions.yaml` for the extra endpoints) into Postman.

## Giving another application access

- Share the API's address and the contract file (`openapi.yaml`). The public read endpoints are described in `PUBLIC_API.md`,
  creating a pharmacy and uploading stock in `PARTNER_API.md`.
- When the API is hosted, nothing else is needed. On your own network they use `http://YOUR-IP:5000`, and Windows Firewall must
  allow Node.
- Ask them to run `npm run test:live` (or the same steps in Postman) against your address first: if it ends in `READY`, the
  contract holds for their calls.
