// Example: another app creating its pharmacy on MediTrac and keeping its stock up to date.
// Needs Node 18+ (built-in fetch) and no packages:
//
//   node examples/partner-sync.js                       (talks to http://localhost:5000)
//   node examples/partner-sync.js http://192.168.1.20:5000
//
// Needs your MediTrac API key (ask the API owner): MEDITRAC_API_KEY=<your-api-key> node examples/partner-sync.js
//
// Run it twice: the second run logs in instead of registering and UPDATES the same stock
// rows instead of duplicating them. Full reference: PARTNER_API.md

const API = (process.argv[2] || 'http://localhost:5000').replace(/\/$/, '');
const API_KEY = process.env.MEDITRAC_API_KEY; // never hard-code a key in a file you share
if (!API_KEY) {
  console.error('Set MEDITRAC_API_KEY to the API key you were given.');
  process.exit(1);
}
const ACCOUNT = {
  name: 'Partner Demo Pharmacy',
  email: process.env.PHARMACY_EMAIL || 'partner-demo@example.com',
  password: process.env.PHARMACY_PASSWORD || 'a-strong-password',
};

async function call(method, path, { body, token } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'X-API-Key': API_KEY,
      ...(API.includes('ngrok') ? { 'ngrok-skip-browser-warning': 'true' } : {}), // skip ngrok's free-plan warning page
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, data };
}

function fail(step, { status, data }) {
  console.error(`${step} failed (HTTP ${status}):`, data?.errors?.join('; ') || data?.error || data?.message);
  process.exit(1);
}

(async () => {
  // 1. Create the pharmacy: name, login and (optionally) all its public details in one call.
  //    If it already exists (409), log in instead. Either way you get a token.
  let res = await call('POST', '/api/auth/register', {
    body: {
      accountType: 'pharmacy',
      ...ACCOUNT,
      phone: '0733000000',
      address: 'Ngong Road, Nairobi',
      opening_hours: 'Mon-Sat 8am-8pm',
      latitude: -1.3006,
      longitude: 36.7848,
    },
  });
  if (res.status === 409) {
    res = await call('POST', '/api/auth/login', { body: { accountType: 'pharmacy', email: ACCOUNT.email, password: ACCOUNT.password } });
    if (res.status !== 200) fail('Login', res);
    console.log(`Logged in as "${res.data.account.name}" (already registered)`);
  } else if (res.status === 201) {
    console.log(`Created pharmacy "${res.data.account.name}" with id ${res.data.account.id}`);
  } else {
    fail('Register', res);
  }
  const token = res.data.token; // send as "Authorization: Bearer <token>"; valid for 7 days

  // 2. Change your own details any time. Send only what changed.
  res = await call('PATCH', '/api/pharmacies/me', { token, body: { opening_hours: 'Daily 8am-10pm' } });
  if (res.status !== 200) fail('Update details', res);
  console.log(`Details: ${res.data.address}, ${res.data.opening_hours}`);

  // 3. Upload your stock. Include your own product code as "sku" so that uploading again
  //    updates these rows instead of creating duplicates. (1 to 500 items per request.)
  const stock = (n) => ({
    medications: [
      { sku: 'AMX-500', name: 'Amoxicillin 500mg', form: 'Capsules', category: 'Antibiotic', quantity: 40 - n, unit: 'Boxes', price: 640 },
      { sku: 'PCM-500', name: 'Paracetamol 500mg', form: 'Tablets', category: 'Analgesic / Pain Relief', quantity: 100 - n, unit: 'Boxes', price: 50 },
      { sku: 'VNT-INH', name: 'Ventolin Inhaler', form: 'Inhaler', category: 'Respiratory', quantity: n === 0 ? 8 : 0, unit: 'Inhalers', price: 950 },
    ],
  });
  res = await call('POST', '/api/medications/bulk', { token, body: stock(0) });
  if (res.status !== 200) fail('Stock upload', res);
  console.log(`Stock upload: ${res.data.created} created, ${res.data.updated} updated`);

  // 4. Later, send the changed list again (here: some sold, the inhaler sold out).
  res = await call('POST', '/api/medications/bulk', { token, body: stock(5) });
  if (res.status !== 200) fail('Stock refresh', res);
  console.log(`Stock refresh: ${res.data.created} created, ${res.data.updated} updated`);

  // 5. Anyone, including your own app's customers, can now find you through the public API.
  res = await call('GET', '/api/medications/search?name=amoxicillin&lat=-1.3&lng=36.78&radius_km=5&in_stock=true');
  const mine = res.data.find((m) => m.pharmacy === ACCOUNT.name);
  console.log(mine
    ? `Public search finds it: ${mine.pharmacy} sells ${mine.name}, ${mine.quantity} left at KES ${mine.price}, ${mine.distance_km} km away`
    : 'Not found in public search yet');
})();
