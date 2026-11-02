const { request, rawRequest, TEST_API_KEY } = require('./helpers');

jest.mock('../db', () => ({ pool: { query: jest.fn() } }));
const { pool } = require('../db');
const app = require('../index');
const { resetStats, who } = require('../monitoring');

let logSpy;
const logged = () => logSpy.mock.calls.map((c) => c[0]).filter((l) => typeof l === 'string' && l.startsWith('{')).map((l) => JSON.parse(l));

beforeEach(() => {
  process.env.MONITOR_LOG = 'true'; // monitoring is silent under Jest unless asked
  resetStats();
  pool.query.mockReset();
  pool.query.mockResolvedValue([[]]);
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  logSpy.mockRestore();
  delete process.env.MONITOR_LOG;
});

describe('request log', () => {
  test('one JSON line per request with time, method, FULL path, status, ms and caller', async () => {
    await request(app).get('/api/pharmacies/abc');
    const lines = logged();
    expect(lines).toHaveLength(1);
    expect(Object.keys(lines[0]).sort()).toEqual(['caller', 'method', 'ms', 'path', 'status', 'time']);
    expect(lines[0]).toMatchObject({ method: 'GET', path: '/api/pharmacies/abc', status: 404 });
    expect(typeof lines[0].ms).toBe('number');
    expect(lines[0].ms).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(lines[0].time))).toBe(false);
  });

  test('a valid key is logged as a short key-xxxxxx label, never the key itself', async () => {
    await request(app).get('/api/pharmacies/abc');
    const out = logSpy.mock.calls.flat().join('\n');
    expect(logged()[0].caller).toMatch(/^key-[0-9a-f]{6}$/);
    expect(out).not.toContain(TEST_API_KEY);
  });

  test('rejected requests are logged too (monitor runs before the key check): wrong key and no key are "none"', async () => {
    await request(app).get('/api/pharmacies').set('X-API-Key', 'wrong');
    await rawRequest(app).get('/api/pharmacies');
    const lines = logged();
    expect(lines.map((l) => [l.status, l.caller])).toEqual([[401, 'none'], [401, 'none']]);
    expect(logSpy.mock.calls.flat().join('\n')).not.toContain('wrong');
  });

  test('the query string is never logged', async () => {
    await request(app).get('/api/pharmacies?email=a@b.com&token=secret123');
    const out = logSpy.mock.calls.flat().join('\n');
    expect(logged()[0].path).toBe('/api/pharmacies');
    expect(out).not.toContain('secret123');
    expect(out).not.toContain('a@b.com');
  });

  test('request bodies and passwords are never logged', async () => {
    await request(app).post('/api/auth/login').send({ accountType: 'user', email: 'x@y.com', password: 'hunter2hunter2' });
    expect(logSpy.mock.calls.flat().join('\n')).not.toMatch(/hunter2|x@y\.com/);
  });

  test('who() uses the hashed id the API-key middleware stores, and "none" without one', () => {
    expect(who({})).toBe('none');
    expect(who({ apiKeyId: 'abcdef123456' })).toBe('key-abcdef');
  });
});

describe('/stats', () => {
  test('needs an API key', async () => {
    expect((await rawRequest(app).get('/stats')).status).toBe(401);
    expect((await request(app).get('/stats')).status).toBe(200);
  });

  test('counts requests, 4xx vs 5xx, error rate and average time', async () => {
    await request(app).get('/api/pharmacies/a');                       // 404 (client error)
    await request(app).get('/api/pharmacies/b');                       // 404
    await rawRequest(app).get('/api/pharmacies');                      // 401, no key
    pool.query.mockRejectedValueOnce(new Error('db down'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await request(app).get('/api/pharmacies');                         // 500 (our fault)
    console.error.mockRestore();

    const { body } = await request(app).get('/stats');
    expect(body.total).toBe(4);
    expect(body.clientErrors).toBe(3);
    expect(body.serverErrors).toBe(1);
    expect(body.errorRatePercent).toBe(25); // 5xx only: 1 of 4
    expect(body.avgMs).toBeGreaterThan(0);
    expect(typeof body.uptimeSeconds).toBe('number');
    expect(body.startedAt).toBeTruthy();
  });

  test('groups by route pattern, not by raw path; unrouted requests go to (no route)', async () => {
    await request(app).get('/api/pharmacies/a');
    await request(app).get('/api/pharmacies/b');
    await request(app).get('/api/pharmacies/c');
    await rawRequest(app).get('/api/pharmacies'); // 401 before any route
    await request(app).get('/not-a-route');       // 404, no route
    const { body } = await request(app).get('/stats');

    expect(body.routes['GET /api/pharmacies/:id']).toMatchObject({ count: 3, clientErrors: 3, serverErrors: 0 });
    expect(body.routes['GET /api/pharmacies/:id'].maxMs).toBeGreaterThanOrEqual(body.routes['GET /api/pharmacies/:id'].avgMs);
    // the label is "<METHOD> (no route)": the 401 and the unknown path both land here
    expect(body.routes['GET (no route)']).toMatchObject({ count: 2, clientErrors: 2 });
    expect(Object.keys(body.routes).some((k) => /\/(a|b|c)$/.test(k))).toBe(false);
  });

  test('/stats does not count itself in its own reply, but shows up in the next one', async () => {
    const first = await request(app).get('/stats');
    expect(first.body.total).toBe(0);
    const second = await request(app).get('/stats');
    expect(second.body.total).toBe(1);
    expect(second.body.routes['GET /stats'].count).toBe(1);
  });
});

describe('partner failures are counted', () => {
  test('partner counters start at zero', async () => {
    const { body } = await request(app).get('/stats');
    expect(body.partner).toEqual({ calls: 0, failures: 0, failureRatePercent: 0 });
  });
});
