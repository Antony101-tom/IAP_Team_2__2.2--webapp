// Week 9: API-key authentication and per-key rate limiting.
//
// Covers: no key / wrong key -> 401 on EVERY endpoint, a valid key -> 200, one key per consumer,
// fail-closed behaviour, no Origin bypass, the open health check, and the 429 with Retry-After.
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const { request, rawRequest, TEST_API_KEY } = require('./helpers');

jest.mock('../db', () => ({ pool: { query: jest.fn() } }));

const { pool } = require('../db');
const app = require('../index');

const contract = YAML.parse(fs.readFileSync(path.join(__dirname, '../../openapi.yaml'), 'utf8'));
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(contract, 'contract');
const compile = (schema) =>
  ajv.compile(JSON.parse(JSON.stringify(schema).replace(/"#\/components\/schemas\//g, '"contract#/components/schemas/')));
const resolve = (raw) =>
  raw && raw.$ref ? raw.$ref.replace(/^#\//, '').split('/').reduce((node, key) => node[key], contract) : raw;

const ID = '1797cd3d-cd55-41bc-b791-ffbf1c0187b8';
let errorSpy;

beforeEach(() => {
  pool.query.mockReset();
  pool.query.mockResolvedValue([[]]);
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  process.env.API_KEYS = TEST_API_KEY;
  process.env.RATE_LIMIT_PER_MINUTE = '100000';
  errorSpy.mockRestore();
});

describe('authentication: no key or a wrong key gets 401', () => {
  it('a request with no key gets 401 (the deliverable check)', async () => {
    const res = await rawRequest(app).get('/api/pharmacies');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/API key/);
    expect(pool.query).not.toHaveBeenCalled(); // the handler never ran
  });

  it('a request with a wrong key gets 401', async () => {
    const res = await rawRequest(app).get('/api/pharmacies').set('X-API-Key', 'wrong');
    expect(res.status).toBe(401);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('a request with a valid key gets 200 (the deliverable check)', async () => {
    const res = await rawRequest(app).get('/api/pharmacies').set('X-API-Key', TEST_API_KEY);
    expect(res.status).toBe(200);
  });

  // Every route, every method: reads, writes, login, registration, tracking, profile, unknown paths.
  const ENDPOINTS = [
    ['get', '/api/medications'],
    ['get', '/api/medications/search?name=a'],
    ['get', '/api/medications/mine'],
    ['get', '/api/medications/by-pharmacy?name=a'],
    ['post', '/api/medications'],
    ['post', '/api/medications/bulk'],
    ['put', `/api/medications/${ID}`],
    ['patch', `/api/medications/${ID}/stock`],
    ['delete', `/api/medications/${ID}`],
    ['get', '/api/pharmacies'],
    ['get', `/api/pharmacies/${ID}`],
    ['get', '/api/pharmacies/me'],
    ['patch', '/api/pharmacies/me'],
    ['put', '/api/pharmacies/me/location'],
    ['post', '/api/auth/register'],
    ['post', '/api/auth/login'],
    ['get', '/api/tracking'],
    ['post', '/api/tracking'],
    ['delete', `/api/tracking/${ID}`],
    ['get', '/api/no-such-endpoint'],
    ['get', '/anything-outside-api'],
  ];

  it.each(ENDPOINTS)('%s %s without a key is 401, and the handler never runs', async (method, url) => {
    const res = await rawRequest(app)[method](url).send({});
    expect(res.status).toBe(401);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it.each(ENDPOINTS)('%s %s with a wrong key is 401', async (method, url) => {
    const res = await rawRequest(app)[method](url).set('X-API-Key', 'wrong').send({});
    expect(res.status).toBe(401);
  });

  it('a fake Origin header does not replace a key', async () => {
    // The old code let "our own website" skip the key by sending this header. Anyone can do that.
    const res = await rawRequest(app).get('/api/pharmacies').set('Origin', 'http://localhost:5173');
    expect(res.status).toBe(401);
  });

  it('fails closed: with no API_KEYS configured, nothing is authenticated', async () => {
    delete process.env.API_KEYS;
    expect((await rawRequest(app).get('/api/pharmacies')).status).toBe(401);
    expect((await rawRequest(app).get('/api/pharmacies').set('X-API-Key', '')).status).toBe(401);
    expect((await rawRequest(app).get('/api/pharmacies').set('X-API-Key', 'undefined')).status).toBe(401);
  });

  it('a 401 never echoes the key that was sent', async () => {
    const res = await rawRequest(app).get('/api/pharmacies').set('X-API-Key', 'super-secret-guess');
    expect(JSON.stringify(res.body) + JSON.stringify(res.headers)).not.toContain('super-secret-guess');
  });

  it('a 401 is JSON and leaks no stack trace or file path', async () => {
    const res = await rawRequest(app).get('/api/pharmacies');
    expect(res.headers['content-type']).toMatch(/json/);
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.js|node_modules|\/server\//);
  });

  it("every operation's documented 401 matches the contract's schema", async () => {
    for (const [p, ops] of Object.entries(contract.paths)) {
      for (const [method, op] of Object.entries(ops)) {
        const documented = resolve(op.responses['401']);
        expect(documented).toBeDefined();
        const url = `/api${p.replace('{id}', ID)}`;
        const res = await rawRequest(app)[method](url).send({});
        expect(res.status).toBe(401);
        const validate = compile(documented.content['application/json'].schema);
        expect({ valid: validate(res.body), body: res.body }).toMatchObject({ valid: true });
      }
    }
  });
});

describe('one key per consumer', () => {
  it('accepts any key on the list, and each consumer is told apart', async () => {
    process.env.API_KEYS = ' partner_key , team_key ,website_key';
    for (const key of ['partner_key', 'team_key', 'website_key']) {
      expect((await rawRequest(app).get('/api/pharmacies').set('X-API-Key', key)).status).toBe(200);
    }
  });

  it('revoking one key (removing it from the list) does not break the others', async () => {
    process.env.API_KEYS = 'partner_key,team_key';
    expect((await rawRequest(app).get('/api/pharmacies').set('X-API-Key', 'partner_key')).status).toBe(200);
    process.env.API_KEYS = 'team_key'; // partner_key revoked
    expect((await rawRequest(app).get('/api/pharmacies').set('X-API-Key', 'partner_key')).status).toBe(401);
    expect((await rawRequest(app).get('/api/pharmacies').set('X-API-Key', 'team_key')).status).toBe(200);
  });

  it('a key that merely starts with a valid key is not valid', async () => {
    process.env.API_KEYS = 'abc123';
    expect((await rawRequest(app).get('/api/pharmacies').set('X-API-Key', 'abc1234')).status).toBe(401);
    expect((await rawRequest(app).get('/api/pharmacies').set('X-API-Key', 'abc12')).status).toBe(401);
  });
});

describe('the health check is the only open door', () => {
  it('GET / needs no key and returns no data', async () => {
    const res = await rawRequest(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toBe('API is running');
  });

  it('a CORS preflight (OPTIONS) is answered without a key, and allows the X-API-Key header', async () => {
    const pre = await rawRequest(app)
      .options('/api/pharmacies')
      .set('Origin', 'https://x.example')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'x-api-key');
    expect(pre.status).toBeLessThan(400);
    expect(pre.headers['access-control-allow-headers'].toLowerCase()).toContain('x-api-key');
  });

  it('does not advertise the framework', async () => {
    const res = await rawRequest(app).get('/');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('rate limiting', () => {
  // Each test uses its OWN key, so one test's requests never count against another's.
  const statuses = async (key, n, url = '/api/pharmacies') => {
    const out = [];
    for (let i = 0; i < n; i++) out.push((await rawRequest(app).get(url).set('X-API-Key', key)).status);
    return out;
  };

  it('with the limit at 3, five requests give 200 200 200 429 429 (the lab demo)', async () => {
    process.env.API_KEYS = 'demo_key';
    process.env.RATE_LIMIT_PER_MINUTE = '3';
    expect(await statuses('demo_key', 5)).toEqual([200, 200, 200, 429, 429]);
  });

  it('the 429 has a Retry-After header and a JSON body telling the caller when to retry', async () => {
    process.env.API_KEYS = 'retry_key';
    process.env.RATE_LIMIT_PER_MINUTE = '1';
    await statuses('retry_key', 1);
    const res = await rawRequest(app).get('/api/pharmacies').set('X-API-Key', 'retry_key');
    expect(res.status).toBe(429);
    expect(res.headers['content-type']).toMatch(/json/);
    const header = Number(res.headers['retry-after']);
    expect(Number.isInteger(header)).toBe(true);
    expect(header).toBeGreaterThan(0);
    expect(header).toBeLessThanOrEqual(60);
    expect(res.body.error).toBe('Too many requests');
    expect(res.body.retryAfter).toBe(header);
  });

  it('limits are per key: one consumer hitting its limit does not block another', async () => {
    process.env.API_KEYS = 'noisy_key,quiet_key';
    process.env.RATE_LIMIT_PER_MINUTE = '2';
    expect(await statuses('noisy_key', 3)).toEqual([200, 200, 429]);
    expect(await statuses('quiet_key', 2)).toEqual([200, 200]);
  });

  it('applies to writes and every other route, not just the most-called one', async () => {
    process.env.API_KEYS = 'write_key';
    process.env.RATE_LIMIT_PER_MINUTE = '1';
    await rawRequest(app).post('/api/auth/login').set('X-API-Key', 'write_key').send({});
    const res = await rawRequest(app).delete(`/api/tracking/${ID}`).set('X-API-Key', 'write_key');
    expect(res.status).toBe(429);
  });

  it('a request with no key is rejected before it can use up anyone\'s allowance', async () => {
    process.env.API_KEYS = 'safe_key';
    process.env.RATE_LIMIT_PER_MINUTE = '2';
    for (let i = 0; i < 5; i++) await rawRequest(app).get('/api/pharmacies'); // 401s from a stranger
    expect(await statuses('safe_key', 2)).toEqual([200, 200]);
  });

  it("every operation's documented 429 matches the contract's schema", async () => {
    process.env.RATE_LIMIT_PER_MINUTE = '1';
    let n = 0;
    for (const [p, ops] of Object.entries(contract.paths)) {
      for (const [method, op] of Object.entries(ops)) {
        const documented = resolve(op.responses['429']);
        expect(documented).toBeDefined();
        const key = `contract_key_${n++}`;
        process.env.API_KEYS = key;
        const url = `/api${p.replace('{id}', ID)}`;
        await rawRequest(app)[method](url).set('X-API-Key', key).send({}); // uses the 1 allowed request
        const res = await rawRequest(app)[method](url).set('X-API-Key', key).send({});
        expect(res.status).toBe(429);
        expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
        const validate = compile(documented.content['application/json'].schema);
        expect({ valid: validate(res.body), body: res.body }).toMatchObject({ valid: true });
      }
    }
  });

  it('the default test helper still works (a request() without an explicit key carries the test key)', async () => {
    const res = await request(app).get('/api/pharmacies');
    expect(res.status).toBe(200);
  });
});
