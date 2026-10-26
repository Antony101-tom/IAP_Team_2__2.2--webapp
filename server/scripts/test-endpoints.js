#!/usr/bin/env node
// Tests every endpoint in the API contract (openapi.yaml), one by one, against a RUNNING server.
// Each step prints PASS or FAIL. The status code and the body are checked against the schema the
// contract gives for that response, so a pass means another application can rely on it.
//
//   npm run test:live                                   (server on http://localhost:5000)
//   API_URL=http://192.168.1.20:5000/api npm run test:live
//
// Optional settings (environment variables):
//   API_URL        base address of the API (default http://localhost:5000/api)
//   PHARMACY_ID    the pharmacy to create the test medication for (default: any existing one)
//   PHARMACY_NAME  that pharmacy's name, used for /medications/by-pharmacy (default: looked up)
//   API_KEY        an API key from the server's API_KEYS list (required: every endpoint needs one)
//   TOKEN          a pharmacy login token, only needed if the server has REQUIRE_LOGIN_FOR_WRITES=true
//
// The test creates one medication named "ENDPOINT TEST" and deletes it again before it ends.

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const API = (process.env.API_URL || 'http://localhost:5000/api').replace(/\/$/, '');
const TOKEN = process.env.TOKEN || '';
const API_KEY = process.env.API_KEY || '';
if (!API_KEY) {
  console.error('Set API_KEY to one of the server\'s API keys, e.g.  API_KEY=<your-api-key> npm run test:live');
  process.exit(1);
}
const CONTRACT_FILE = process.env.CONTRACT || path.join(__dirname, '../../openapi.yaml');
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'; // a well-formed id nothing uses
const UNKNOWN_PHARMACY_ID = '00000000-0000-4000-8000-0000000000aa'; // a well-formed pharmacy id nothing uses

const contract = YAML.parse(fs.readFileSync(CONTRACT_FILE, 'utf8'));
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(contract, 'contract');
// A response in the contract may be a reference like '#/components/responses/ServerError'
const resolveResponse = (raw) => (raw && raw.$ref ? raw.$ref.replace(/^#\//, '').split('/').reduce((node, key) => node[key], contract) : raw);
const compile = (schema) =>
  ajv.compile(JSON.parse(JSON.stringify(schema).replace(/"#\/components\/schemas\//g, '"contract#/components/schemas/')));

async function call(method, urlPath, body) {
  const headers = { 'X-API-Key': API_KEY };
  if (API.includes('ngrok')) headers['ngrok-skip-browser-warning'] = 'true'; // skip ngrok's free-plan warning page
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (TOKEN && method !== 'GET') headers.Authorization = `Bearer ${TOKEN}`;
  const res = await fetch(API + urlPath, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000), // never hang forever on a server that does not answer
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* empty or non-JSON body */ }
  return { status: res.status, text, data };
}

const results = [];
const covered = new Set();
let stepNo = 0;

// One step: send the request, check status + body against the contract, then run `extra` checks
async function step({ title, method, template, url, body, expect: expectedStatus, extra }) {
  stepNo += 1;
  const label = `${String(stepNo).padStart(2)}. ${method.padEnd(6)} ${url.length > 52 ? url.slice(0, 49) + '...' : url}`.padEnd(66);
  let res;
  try {
    res = await call(method, url, body);
  } catch (err) {
    console.log(`${label} FAIL  ${err.name === 'TimeoutError' ? 'no answer from the server after 15 seconds' : `could not reach the server (${err.cause?.code || err.message})`}`);
    results.push(false);
    return null;
  }

  const problems = [];
  const documented = resolveResponse(contract.paths[template][method.toLowerCase()].responses[String(res.status)]);
  if (res.status !== expectedStatus) problems.push(`expected ${expectedStatus}, got ${res.status}${res.data?.error ? ` (${res.data.error})` : ''}`);
  if (!documented) {
    problems.push(`status ${res.status} is not one the contract documents for this call`);
  } else {
    const jsonSchema = documented.content && documented.content['application/json'].schema;
    if (jsonSchema) {
      const validate = compile(jsonSchema);
      if (!validate(res.data)) problems.push('body does not match the contract: ' + validate.errors.map((e) => `${e.instancePath || '(body)'} ${e.message}`).join('; '));
    } else if (res.text !== '') {
      problems.push('the contract says no content, but a body came back');
    }
  }
  if (problems.length === 0 && extra) {
    const message = extra(res.data, res);
    if (message) problems.push(message);
  }

  const ok = problems.length === 0;
  if (ok) covered.add(`${method} ${template} ${res.status}`);
  results.push(ok);
  console.log(`${label} ${ok ? 'PASS' : 'FAIL'}  ${res.status}  ${ok ? title : problems.join(' | ')}`);
  if (!ok && res.status === 401 && !TOKEN) {
    console.log('      This server requires a login for changes (REQUIRE_LOGIN_FOR_WRITES=true). Run again with TOKEN=<pharmacy token> and PHARMACY_ID=<that pharmacy\'s id>.');
  }
  return res.data;
}

(async () => {
  console.log(`\nMediTrac endpoint test\nAPI: ${API}\nContract: ${path.relative(process.cwd(), CONTRACT_FILE) || CONTRACT_FILE}\n`);

  // ---- Setup (not part of the contract): pick the pharmacy the test medication belongs to ----
  let pharmacyId = process.env.PHARMACY_ID || '';
  let pharmacyName = process.env.PHARMACY_NAME || '';
  try {
    if (!pharmacyId || !pharmacyName) {
      const all = await call('GET', '/medications');
      const first = Array.isArray(all.data) ? all.data.find((m) => !pharmacyId || m.pharmacy_id === pharmacyId) : null;
      if (first) {
        pharmacyId = pharmacyId || first.pharmacy_id;
        pharmacyName = pharmacyName || first.pharmacy || '';
      }
    }
    if (pharmacyId && !pharmacyName) {
      const p = await call('GET', `/pharmacies/${pharmacyId}`);
      pharmacyName = (p.data && p.data.name) || '';
    }
  } catch {
    console.log(`Could not reach the server at ${API}. Is it running? (npm start in the server folder)\n`);
    process.exit(1);
  }
  if (!pharmacyId) {
    console.log('The database has no medications yet, so there is no pharmacy to test with.\nSet PHARMACY_ID (and PHARMACY_NAME) to an existing pharmacy and run again.\n');
    process.exit(1);
  }
  console.log(`Using pharmacy "${pharmacyName || '(name unknown)'}" (${pharmacyId})\n`);

  const input = { name: 'ENDPOINT TEST', form: 'Tablet', category: 'Analgesic', quantity: 120, unit: 'box', price: 50.5, branch: 'Test Branch', pharmacy_id: pharmacyId };
  let id = null;

  await step({ title: 'list of medications', method: 'GET', template: '/medications', url: '/medications', expect: 200,
    extra: (d) => (Array.isArray(d) ? null : 'expected a list') });

  const created = await step({ title: 'created; returned the new record', method: 'POST', template: '/medications', url: '/medications', body: input, expect: 201,
    extra: (d) => (d.name !== input.name || d.quantity !== 120 || d.price !== 50.5 || d.pharmacy_id !== pharmacyId ? 'the record does not match what was sent' : null) });
  id = created && created.id;

  await step({ title: 'rejected an empty body, listing what is missing', method: 'POST', template: '/medications', url: '/medications', body: {}, expect: 400,
    extra: (d) => (['name', 'quantity', 'price', 'pharmacy_id'].every((f) => d.errors.some((e) => e.includes(f))) ? null : 'errors should name every missing field') });
  await step({ title: 'rejected wrong types', method: 'POST', template: '/medications', url: '/medications', body: { ...input, quantity: 'ten', price: '5' }, expect: 400 });

  await step({ title: 'no pharmacy with that pharmacy_id', method: 'POST', template: '/medications', url: '/medications', body: { ...input, pharmacy_id: UNKNOWN_PHARMACY_ID }, expect: 404,
    extra: (d) => (d.error === 'Pharmacy not found' ? null : `expected "Pharmacy not found", got "${d.error}"`) });

  if (!id) {
    console.log('\nStopping: the medication could not be created, so the remaining steps cannot run.\n');
    process.exit(1);
  }

  await step({ title: `found the test medication under "${pharmacyName}"`, method: 'GET', template: '/medications/by-pharmacy', url: `/medications/by-pharmacy?name=${encodeURIComponent(pharmacyName)}`, expect: 200,
    extra: (d) => (d.some((m) => m.id === id) ? null : 'the new medication is not in this pharmacy\'s list') });
  // The contract says the name match is exact and case-sensitive: the same name in other letter-case must not match
  const swapped = pharmacyName.replace(/[a-z]/gi, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
  if (swapped !== pharmacyName) {
    await step({ title: 'the name match is case-sensitive, so different letter-case finds nothing', method: 'GET', template: '/medications/by-pharmacy', url: `/medications/by-pharmacy?name=${encodeURIComponent(swapped)}`, expect: 404 });
  }
  await step({ title: 'asked for a name', method: 'GET', template: '/medications/by-pharmacy', url: '/medications/by-pharmacy', expect: 400 });
  await step({ title: 'no pharmacy with that name', method: 'GET', template: '/medications/by-pharmacy', url: '/medications/by-pharmacy?name=No%20Such%20Pharmacy%20Anywhere', expect: 404 });

  await step({ title: 'replaced the record', method: 'PUT', template: '/medications/{id}', url: `/medications/${id}`, body: { ...input, name: 'ENDPOINT TEST v2', price: 75 }, expect: 200,
    extra: (d) => (d.id !== id || d.name !== 'ENDPOINT TEST v2' || d.price !== 75 ? 'the update was not applied' : null) });
  await step({ title: 'rejected missing fields', method: 'PUT', template: '/medications/{id}', url: `/medications/${id}`, body: { name: 'only a name' }, expect: 400 });
  await step({ title: 'no medication with that id', method: 'PUT', template: '/medications/{id}', url: `/medications/${UNKNOWN_ID}`, body: input, expect: 404,
    extra: (d) => (d.error === 'Medication not found' ? null : `expected "Medication not found", got "${d.error}"`) });
  await step({ title: 'no pharmacy with that pharmacy_id', method: 'PUT', template: '/medications/{id}', url: `/medications/${id}`, body: { ...input, pharmacy_id: UNKNOWN_PHARMACY_ID }, expect: 404,
    extra: (d) => (d.error === 'Pharmacy not found' ? null : `expected "Pharmacy not found", got "${d.error}"`) });

  await step({ title: 'stock changed to 85', method: 'PATCH', template: '/medications/{id}/stock', url: `/medications/${id}/stock`, body: { quantity: 85 }, expect: 200,
    extra: (d) => (d.quantity === 85 ? null : `quantity is ${d.quantity}, expected 85`) });
  await step({ title: 'rejected a missing quantity', method: 'PATCH', template: '/medications/{id}/stock', url: `/medications/${id}/stock`, body: {}, expect: 400 });
  await step({ title: 'rejected a non-number quantity', method: 'PATCH', template: '/medications/{id}/stock', url: `/medications/${id}/stock`, body: { quantity: 'lots' }, expect: 400 });
  await step({ title: 'no medication with that id', method: 'PATCH', template: '/medications/{id}/stock', url: `/medications/${UNKNOWN_ID}/stock`, body: { quantity: 5 }, expect: 404 });

  await step({ title: 'the change is visible in the full list', method: 'GET', template: '/medications', url: '/medications', expect: 200,
    extra: (d) => { const m = d.find((x) => x.id === id); return m && m.quantity === 85 ? null : 'the updated stock is not in the list'; } });

  await step({ title: 'deleted, no content', method: 'DELETE', template: '/medications/{id}', url: `/medications/${id}`, expect: 204 });
  await step({ title: 'already gone', method: 'DELETE', template: '/medications/{id}', url: `/medications/${id}`, expect: 404 });

  await step({ title: 'and it is no longer in the list', method: 'GET', template: '/medications', url: '/medications', expect: 200,
    extra: (d) => (d.some((x) => x.id === id) ? 'the deleted medication is still listed' : null) });

  // ---- Summary ----
  const documented = [];
  for (const [p, ops] of Object.entries(contract.paths)) {
    for (const [m, op] of Object.entries(ops)) for (const s of Object.keys(op.responses)) documented.push(`${m.toUpperCase()} ${p} ${s}`);
  }
  // A 500 (unexpected server or database failure) cannot be provoked on demand, so it is not required here.
  // The automated tests (npm test) check that every 500 has the contract's { error } shape.
  const serverFailures = documented.filter((d) => /\s5\d\d$/.test(d));
  const notSeen = documented.filter((d) => !serverFailures.includes(d) && !covered.has(d));
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed} of ${results.length} checks passed.`);
  const testable = documented.length - serverFailures.length;
  console.log(`${testable - notSeen.length} of ${testable} responses documented in the contract were produced by the server and matched it (${serverFailures.length} server-failure responses can't be provoked live; npm test covers them).`);
  if (notSeen.length) console.log(`Not confirmed: ${notSeen.join(', ')}`);
  if (failed || notSeen.length) {
    console.log('\nTip: if lines like "expected 404, got 400" appear, the server you are testing is probably running OLDER code than this folder.');
    console.log('  - Render: open the service > Deploys, check the commit it built, push your latest commit and wait for "Your service is live".');
    console.log('  - Your computer: stop the server (Ctrl+C) and start it again with npm start from THIS folder.');
  }
  console.log(failed || notSeen.length ? '\nRESULT: NOT READY. Fix the FAIL lines above.\n' : '\nRESULT: READY. Another application can use these endpoints as the contract describes.\n');
  process.exit(failed || notSeen.length ? 1 : 0);
})();
