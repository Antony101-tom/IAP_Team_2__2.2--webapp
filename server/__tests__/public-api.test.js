const request = require('supertest');
require('./helpers');

jest.mock('../db', () => ({ pool: { query: jest.fn() } }));

const { pool } = require('../db');
const app = require('../index');

const OTHER_SITE = 'https://some-other-app.example';
const PHARMACY_ID = 'a1000000-0000-4000-8000-000000000002';

let errorSpy;
beforeEach(() => {
  pool.query.mockReset();
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => errorSpy.mockRestore());

describe('GET /api/pharmacies (public)', () => {
  const rows = [{ id: PHARMACY_ID, name: 'Wellness', latitude: -1.28, longitude: 36.82, in_stock_count: 3 }];

  it('lists pinned pharmacies and never selects emails or password hashes', async () => {
    pool.query.mockResolvedValueOnce([rows]);
    const res = await request(app).get('/api/pharmacies');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(rows);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).not.toMatch(/email|password/i);
    expect(sql).toMatch(/latitude IS NOT NULL/);
    expect(params).toEqual([100]); // default limit
  });

  it('with lat/lng adds distance and sorts nearest first', async () => {
    pool.query.mockResolvedValueOnce([[{ ...rows[0], distance_km: 1.2 }]]);
    const res = await request(app).get('/api/pharmacies?lat=-1.2833&lng=36.8219');

    expect(res.status).toBe(200);
    expect(res.body[0].distance_km).toBe(1.2);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/ORDER BY distance_km ASC/);
    expect(sql).not.toMatch(/HAVING/);
    expect(params).toEqual([-1.2833, -1.2833, 36.8219, 100]);
  });

  it('radius_km keeps only pharmacies within that distance', async () => {
    pool.query.mockResolvedValueOnce([[]]);
    const res = await request(app).get('/api/pharmacies?lat=-1.28&lng=36.82&radius_km=5&limit=10');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/WHERE distance_km <= \?/);
    expect(params).toEqual([-1.28, -1.28, 36.82, 5, 10]);
  });

  it.each([
    ['lat without lng', 'lat=1', 'lat and lng must be given together'],
    ['out-of-range lat', 'lat=95&lng=1', 'lat must be a number between -90 and 90'],
    ['out-of-range lng', 'lat=1&lng=200', 'lng must be a number between -180 and 180'],
    ['radius without a position', 'radius_km=5', 'radius_km needs lat and lng'],
    ['negative radius', 'lat=1&lng=1&radius_km=-2', 'radius_km must be a number greater than 0 and at most 500'],
    ['limit of 0', 'limit=0', 'limit must be a whole number from 1 to 500'],
    ['huge limit', 'limit=100000', 'limit must be a whole number from 1 to 500'],
  ])('returns 400 for %s', async (_label, qs, message) => {
    const res = await request(app).get(`/api/pharmacies?${qs}`);

    expect(res.status).toBe(400);
    expect(res.body.errors).toContain(message);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('returns 500 when the database fails', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/pharmacies');
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });
});

describe('GET /api/pharmacies/:id (public)', () => {
  it('returns the pharmacy with everything it stocks', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: PHARMACY_ID, name: 'Wellness', latitude: -1.28, longitude: 36.82 }]])
      .mockResolvedValueOnce([[{ id: 'm1', name: 'Paracetamol', quantity: 5 }]]);
    const res = await request(app).get(`/api/pharmacies/${PHARMACY_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Wellness');
    expect(res.body.medications).toHaveLength(1);
    expect(Object.keys(res.body)).not.toContain('email');
  });

  it('returns 404 for an unknown pharmacy', async () => {
    pool.query.mockResolvedValueOnce([[]]);
    const res = await request(app).get('/api/pharmacies/nope');
    expect(res.status).toBe(404);
  });

  it('does not treat "me" as a public pharmacy id (it needs a login)', async () => {
    const res = await request(app).get('/api/pharmacies/me');
    expect(res.status).toBe(401);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('GET /api/medications/search (public)', () => {
  it('requires a name', async () => {
    const res = await request(app).get('/api/medications/search');
    expect(res.status).toBe(400);
    expect(res.body.errors).toContain('name is required');
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('finds medicines by name or category, nearest first, with pharmacy name and pin', async () => {
    const row = { id: 'm1', name: 'Amoxicillin', pharmacy: 'Wellness', latitude: -1.28, longitude: 36.82, distance_km: 0.4 };
    pool.query.mockResolvedValueOnce([[row]]);
    const res = await request(app).get('/api/medications/search?name=amox&lat=-1.28&lng=36.82&radius_km=3&in_stock=true');

    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ pharmacy: 'Wellness', distance_km: 0.4 });
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/m\.name ILIKE \? OR m\.category ILIKE \?/);
    expect(sql).toMatch(/m\.quantity > 0/);
    expect(sql).toMatch(/WHERE distance_km <= \?/);
    expect(sql).not.toMatch(/email|password/i);
    expect(params).toEqual([-1.28, -1.28, 36.82, '%amox%', '%amox%', 3, 100]);
  });

  it('works without a position (no distance, sorted by name)', async () => {
    pool.query.mockResolvedValueOnce([[]]);
    const res = await request(app).get('/api/medications/search?name=paracetamol');

    expect(res.status).toBe(200);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).not.toMatch(/distance_km/);
    expect(params).toEqual(['%paracetamol%', '%paracetamol%', 100]);
  });

  it('searches for % and _ literally instead of treating them as wildcards', async () => {
    pool.query.mockResolvedValueOnce([[]]);
    await request(app).get('/api/medications/search?name=50%25_x');
    expect(pool.query.mock.calls[0][1][0]).toBe('%50\\%\\_x%');
  });

  it('validates the position and limit like /api/pharmacies', async () => {
    const res = await request(app).get('/api/medications/search?name=a&lat=1&limit=0');
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining(['lat and lng must be given together', 'limit must be a whole number from 1 to 500'])
    );
  });
});

describe('CORS', () => {
  it.each([
    '/api/medications',
    '/api/medications/search?name=a',
    '/api/medications/by-pharmacy?name=a',
    '/api/pharmacies',
    `/api/pharmacies/${PHARMACY_ID}`,
  ])('public: allows any origin on GET %s', async (path) => {
    pool.query.mockResolvedValue([[]]);
    const res = await request(app).get(path).set('Origin', OTHER_SITE);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('public: answers a browser preflight for a GET', async () => {
    const res = await request(app)
      .options('/api/pharmacies')
      .set('Origin', OTHER_SITE)
      .set('Access-Control-Request-Method', 'GET');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  // Partner endpoints (create a pharmacy, log in, manage own details and stock) are open to
  // any website by default (PARTNER_ORIGINS=*); they are protected by a bearer token.
  it.each([
    ['POST', '/api/auth/register'],
    ['POST', '/api/auth/login'],
    ['GET', '/api/pharmacies/me'],
    ['PATCH', '/api/pharmacies/me'],
    ['PUT', '/api/pharmacies/me/location'],
    ['GET', '/api/medications/mine'],
    ['POST', '/api/medications'],
    ['POST', '/api/medications/bulk'],
    ['PUT', '/api/medications/m1'],
    ['PATCH', '/api/medications/m1/stock'],
    ['DELETE', '/api/medications/m1'],
  ])('partner: allows other websites to %s %s (preflight and request)', async (method, path) => {
    const pre = await request(app)
      .options(path)
      .set('Origin', OTHER_SITE)
      .set('Access-Control-Request-Method', method)
      .set('Access-Control-Request-Headers', 'authorization,content-type');
    expect(pre.status).toBe(204);
    expect(pre.headers['access-control-allow-origin']).toBe('*');
    expect(pre.headers['access-control-allow-headers']).toMatch(/authorization/i);

    const res = await request(app)[method.toLowerCase()](path).set('Origin', OTHER_SITE);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it.each([
    ['GET', '/api/tracking'],
    ['POST', '/api/tracking'],
    ['DELETE', '/api/tracking/abc'],
  ])('private: does NOT open patient trackers (%s %s) to other websites', async (method, path) => {
    const pre = await request(app)
      .options(path)
      .set('Origin', OTHER_SITE)
      .set('Access-Control-Request-Method', method);
    expect(pre.headers['access-control-allow-origin']).toBeUndefined();

    const res = await request(app)[method.toLowerCase()](path).set('Origin', OTHER_SITE);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it("private: the app's own frontend can still use patient trackers", async () => {
    const res = await request(app)
      .options('/api/tracking')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });
});
