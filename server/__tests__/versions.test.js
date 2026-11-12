// Week 13: v1 is frozen, v2 has the new shape, and the old URLs announce their sunset.
const { request, rawRequest, TEST_API_KEY } = require('./helpers');

jest.mock('../db', () => ({ pool: { query: jest.fn() } }));
const { pool } = require('../db');
const app = require('../index');
const { resetStats } = require('../monitoring');

const ROWS = [
  { id: 'a1', name: 'Wellness Pharmacy', phone: '0722000002', address: 'Tom Mboya Street, Nairobi', opening_hours: 'Daily 7am-10pm', latitude: -1.2833, longitude: 36.8219, in_stock_count: 3 },
  { id: 'b2', name: 'CityCare Chemist', phone: null, address: null, opening_hours: null, latitude: -1.29, longitude: 36.82, in_stock_count: 0 },
];
const FIELDS = ['address', 'id', 'in_stock_count', 'latitude', 'longitude', 'name', 'opening_hours', 'phone'];

beforeEach(() => {
  resetStats();
  pool.query.mockReset();
  pool.query.mockResolvedValue([ROWS]);
});

describe('v1 is frozen', () => {
  test('GET /api/v1/pharmacies keeps its original shape: a bare list', async () => {
    const res = await request(app).get('/api/v1/pharmacies');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(Object.keys(res.body[0]).sort()).toEqual(FIELDS);
  });

  test('the old unversioned /api/pharmacies answers exactly like /api/v1/pharmacies', async () => {
    const a = await request(app).get('/api/pharmacies');
    const b = await request(app).get('/api/v1/pharmacies');
    expect(a.status).toBe(200);
    expect(a.body).toEqual(b.body);
  });

  test('v1 validation errors keep their shape', async () => {
    const res = await request(app).get('/api/v1/pharmacies?lat=abc&lng=1');
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Validation failed');
    expect(Array.isArray(res.body.errors)).toBe(true);
  });

  test('v1 "not found" keeps its shape', async () => {
    pool.query.mockResolvedValue([[]]);
    const res = await request(app).get('/api/v1/pharmacies/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Pharmacy not found' });
  });
});

describe('v2 has the new shape', () => {
  test('the list is wrapped as { data, count } with the same fields inside', async () => {
    const res = await request(app).get('/api/v2/pharmacies');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(false);
    expect(res.body.count).toBe(2);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(FIELDS);
  });

  test('v2 data is the same data as v1', async () => {
    const v1 = await request(app).get('/api/v1/pharmacies');
    const v2 = await request(app).get('/api/v2/pharmacies');
    expect(v2.body.data).toEqual(v1.body);
  });

  test('an empty list is { data: [], count: 0 }, not an error', async () => {
    pool.query.mockResolvedValue([[]]);
    const res = await request(app).get('/api/v2/pharmacies');
    expect(res.body).toEqual({ data: [], count: 0 });
  });

  test('the same query parameters still work (lat/lng/radius_km)', async () => {
    const res = await request(app).get('/api/v2/pharmacies?lat=-1.2833&lng=36.8219&radius_km=5');
    expect(res.status).toBe(200);
    expect(pool.query.mock.calls[0][1]).toEqual(expect.arrayContaining([-1.2833, 36.8219, 5]));
  });

  test('the same validation error as v1', async () => {
    const res = await request(app).get('/api/v2/pharmacies?lat=abc&lng=1');
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Validation failed');
  });

  test('endpoints that did not change work under /api/v2 too (single pharmacy)', async () => {
    pool.query
      .mockResolvedValueOnce([[ROWS[0]]])
      .mockResolvedValueOnce([[{ id: 'm1', name: 'Paracetamol', quantity: 5, pharmacy_id: 'a1' }]]);
    const res = await request(app).get('/api/v2/pharmacies/a1');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Wellness Pharmacy');
    expect(res.body.medications).toHaveLength(1);
  });
});

describe('deprecation headers', () => {
  test('the old list URLs announce the sunset', async () => {
    for (const path of ['/api/v1/pharmacies', '/api/pharmacies']) {
      const res = await request(app).get(path);
      expect(res.headers.deprecation).toBe('true');
      expect(res.headers.sunset).toMatch(/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} 00:00:00 GMT$/);
      expect(res.headers.link).toBe('</api/v2/pharmacies>; rel="successor-version"');
    }
  });

  test('v2 and unchanged endpoints do not carry them', async () => {
    pool.query.mockResolvedValue([[]]);
    for (const path of ['/api/v2/pharmacies', '/api/pharmacies/nope', '/api/medications', '/api/nope']) {
      const res = await request(app).get(path);
      expect(res.headers.deprecation).toBeUndefined();
      expect(res.headers.sunset).toBeUndefined();
    }
  });
});

describe('v2 is as protected as v1', () => {
  test('/api/v2/pharmacies needs an API key', async () => {
    expect((await rawRequest(app).get('/api/v2/pharmacies')).status).toBe(401);
    expect((await rawRequest(app).get('/api/v2/pharmacies').set('X-API-Key', 'wrong')).status).toBe(401);
    expect((await rawRequest(app).get('/api/v2/pharmacies').set('X-API-Key', TEST_API_KEY)).status).toBe(200);
  });

  test('public read endpoints are open to browsers on every version', async () => {
    for (const path of ['/api/pharmacies', '/api/v1/pharmacies', '/api/v2/pharmacies']) {
      const res = await rawRequest(app).get(path).set('X-API-Key', TEST_API_KEY).set('Origin', 'http://some-other-site.example');
      expect(res.headers['access-control-allow-origin']).toBe('*');
    }
  });

  test('the login brute-force limiter is NOT bypassed by adding a version prefix', async () => {
    // 20 failed logins per IP per 15 minutes, counted across /api/auth, /api/v1/auth and /api/v2/auth together.
    pool.query.mockResolvedValue([[]]);
    const paths = ['/api/auth/login', '/api/v1/auth/login', '/api/v2/auth/login'];
    let last;
    for (let i = 0; i < 21; i++) {
      last = await request(app).post(paths[i % 3]).send({ email: 'x@example.com', password: 'wrong' });
    }
    expect(last.status).toBe(429);
  });
});

describe('/stats shows the version in each row', () => {
  test('the three URLs are three separate rows', async () => {
    await request(app).get('/api/v1/pharmacies');
    await request(app).get('/api/pharmacies');
    await request(app).get('/api/v2/pharmacies');
    const res = await request(app).get('/stats');
    const rows = Object.keys(res.body.routes);
    expect(rows).toEqual(expect.arrayContaining(['GET /api/v1/pharmacies', 'GET /api/pharmacies', 'GET /api/v2/pharmacies']));
  });
});
