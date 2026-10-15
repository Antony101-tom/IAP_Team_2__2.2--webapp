const request = require('supertest');
const { pharmacyToken, userToken } = require('./helpers');

jest.mock('../db', () => ({ pool: { query: jest.fn(), getConnection: jest.fn() } }));

const { pool } = require('../db');
const app = require('../index');

const AUTH = pharmacyToken('uuid-1');
const OTHER_SITE = 'https://partner-app.example';

let errorSpy;
beforeEach(() => {
  pool.query.mockReset();
  pool.getConnection.mockReset();
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => errorSpy.mockRestore());

// ---------------------------------------------------------------
describe('POST /api/auth/register: create a complete pharmacy in one call', () => {
  const body = {
    accountType: 'pharmacy',
    name: 'Partner Chemist',
    email: 'Owner@Partner.example',
    password: 'secret1',
    phone: ' 0712345678 ',
    address: 'Tom Mboya St, Nairobi',
    opening_hours: 'Mon-Sat 8am-8pm',
    latitude: -1.2833,
    longitude: 36.8219,
  };

  it('saves the details and the map pin and returns them with the token', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    const res = await request(app).post('/api/auth/register').send(body);

    expect(res.status).toBe(201);
    expect(res.body.account).toMatchObject({
      type: 'pharmacy',
      email: 'owner@partner.example',
      phone: '0712345678',
      address: 'Tom Mboya St, Nairobi',
      opening_hours: 'Mon-Sat 8am-8pm',
      latitude: -1.2833,
      longitude: 36.8219,
    });
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO pharmacies \(id, name, email, password_hash, phone, address, opening_hours, latitude, longitude\)/);
    expect(params.slice(4)).toEqual(['0712345678', 'Tom Mboya St, Nairobi', 'Mon-Sat 8am-8pm', -1.2833, 36.8219]);
  });

  it('still works with just name, email and password (details stay empty)', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    const res = await request(app)
      .post('/api/auth/register')
      .send({ accountType: 'pharmacy', name: 'Bare', email: 'b@x.com', password: 'secret1' });

    expect(res.status).toBe(201);
    expect(res.body.account).toMatchObject({ phone: null, address: null, opening_hours: null, latitude: null, longitude: null });
    expect(pool.query.mock.calls[0][0]).toMatch(/\(id, name, email, password_hash\) VALUES \(\?, \?, \?, \?\)/);
  });

  it('ignores pharmacy-only fields for a patient account', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...body, accountType: 'user' });

    expect(res.status).toBe(201);
    expect(pool.query.mock.calls[0][0]).toMatch(/INSERT INTO users \(id, name, email, password_hash\)/);
    expect(res.body.account).not.toHaveProperty('phone');
  });

  it.each([
    ['phone too long', { phone: '1'.repeat(31) }, /phone must be at most 30 characters/],
    ['address not a string', { address: 123 }, /address must be a string/],
    ['latitude without longitude', { longitude: undefined }, /latitude and longitude must be given together/],
    ['latitude out of range', { latitude: 95 }, /latitude must be a number between -90 and 90/],
    ['longitude as text', { longitude: 'east' }, /longitude must be a number between -180 and 180/],
  ])('returns 400 for %s', async (_label, override, message) => {
    const res = await request(app).post('/api/auth/register').send({ ...body, ...override });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------
describe('PATCH /api/pharmacies/me: update your own details', () => {
  const profile = { id: 'uuid-1', name: 'New Name', email: 'h@x.com', phone: '0700', address: 'A', opening_hours: 'H', latitude: -1.2, longitude: 36.8 };

  it('updates only the fields you send', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]).mockResolvedValueOnce([[profile]]);
    const res = await request(app)
      .patch('/api/pharmacies/me')
      .set('Authorization', AUTH)
      .send({ name: ' New Name ', phone: '0700', latitude: -1.2, longitude: 36.8 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'New Name', phone: '0700' });
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toBe('UPDATE pharmacies SET name = ?, phone = ?, latitude = ?, longitude = ? WHERE id = ?');
    expect(params).toEqual(['New Name', '0700', -1.2, 36.8, 'uuid-1']); // id comes from the login
  });

  it('an empty string clears an optional field', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]).mockResolvedValueOnce([[profile]]);
    await request(app).patch('/api/pharmacies/me').set('Authorization', AUTH).send({ address: '  ' });
    expect(pool.query.mock.calls[0][1]).toEqual([null, 'uuid-1']);
  });

  it('requires a pharmacy login', async () => {
    expect((await request(app).patch('/api/pharmacies/me').send({ phone: '1' })).status).toBe(401);
    expect((await request(app).patch('/api/pharmacies/me').set('Authorization', userToken()).send({ phone: '1' })).status).toBe(403);
  });

  it.each([
    ['nothing to update', {}, 'Send at least one of'],
    ['blank name', { name: '  ' }, 'name must be a non-empty string'],
    ['name too long', { name: 'x'.repeat(151) }, 'name must be at most 150 characters'],
    ['pin without longitude', { latitude: 1 }, 'latitude and longitude must be given together'],
    ['opening hours too long', { opening_hours: 'x'.repeat(101) }, 'opening_hours must be at most 100 characters'],
  ])('returns 400 for %s', async (_label, payload, message) => {
    const res = await request(app).patch('/api/pharmacies/me').set('Authorization', AUTH).send(payload);

    expect(res.status).toBe(400);
    expect(res.body.errors.join(' ')).toContain(message);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('never lets you change the email or password this way', async () => {
    const res = await request(app)
      .patch('/api/pharmacies/me')
      .set('Authorization', AUTH)
      .send({ email: 'hijack@x.com', password_hash: 'x', id: 'someone-else' });

    expect(res.status).toBe(400); // none of those are updatable fields, so nothing to update
    expect(pool.query).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------
describe('POST /api/medications/bulk: upload a whole stock list', () => {
  function fakeConnection(handler) {
    const conn = {
      beginTransaction: jest.fn(),
      commit: jest.fn(),
      rollback: jest.fn(),
      release: jest.fn(),
      query: jest.fn(handler),
    };
    pool.getConnection.mockResolvedValueOnce(conn);
    return conn;
  }

  const item = (over = {}) => ({ name: 'Paracetamol', quantity: 10, price: 50, ...over });

  it('creates new items and updates existing ones, all in one transaction', async () => {
    const conn = fakeConnection((sql) => {
      if (/SELECT id FROM medications WHERE pharmacy_id = \? AND sku = \?/.test(sql)) return Promise.resolve([[]]);
      if (/SELECT id FROM medications WHERE pharmacy_id = \? AND sku IS NULL/.test(sql)) return Promise.resolve([[{ id: 'existing-1' }]]);
      return Promise.resolve([{ affectedRows: 1 }]);
    });

    const res = await request(app)
      .post('/api/medications/bulk')
      .set('Authorization', AUTH)
      .send({
        medications: [
          item({ name: 'Amoxicillin', sku: 'AMX-500', form: 'Capsules' }), // new, matched by sku
          item({ name: 'Paracetamol', form: 'Tablets', quantity: 0 }), // no sku: matched by name + form
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: 1, updated: 1 });
    expect(res.body.results.map((r) => r.action)).toEqual(['created', 'updated']);
    expect(res.body.results[1].id).toBe('existing-1');
    expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);

    const insert = conn.query.mock.calls.find(([sql]) => /INSERT INTO medications/.test(sql));
    expect(insert[1].slice(1)).toEqual(['Amoxicillin', 'Capsules', null, 10, null, 50, null, 'AMX-500', 'uuid-1']);
  });

  it("ignores any pharmacy_id inside an item: stock always goes to the logged-in pharmacy", async () => {
    const conn = fakeConnection((sql) => Promise.resolve(/^SELECT/.test(sql) ? [[]] : [{ affectedRows: 1 }]));
    const res = await request(app)
      .post('/api/medications/bulk')
      .set('Authorization', AUTH)
      .send({ medications: [item({ pharmacy_id: 'someone-else' })] });

    expect(res.status).toBe(200);
    const insert = conn.query.mock.calls.find(([sql]) => /INSERT INTO medications/.test(sql));
    expect(insert[1].slice(-1)).toEqual(['uuid-1']);
    const lookups = conn.query.mock.calls.filter(([sql]) => /^SELECT/.test(sql));
    expect(lookups.every(([, params]) => params[0] === 'uuid-1')).toBe(true);
  });

  it('requires a pharmacy login', async () => {
    expect((await request(app).post('/api/medications/bulk').send({ medications: [item()] })).status).toBe(401);
    expect((await request(app).post('/api/medications/bulk').set('Authorization', userToken()).send({ medications: [item()] })).status).toBe(403);
    expect(pool.getConnection).not.toHaveBeenCalled();
  });

  it.each([
    ['no body', undefined],
    ['medications not an array', { medications: 'nope' }],
    ['an empty list', { medications: [] }],
  ])('returns 400 for %s', async (_label, payload) => {
    const res = await request(app).post('/api/medications/bulk').set('Authorization', AUTH).send(payload);
    expect(res.status).toBe(400);
    expect(res.body.errors[0]).toMatch(/non-empty array/);
    expect(pool.getConnection).not.toHaveBeenCalled();
  });

  it('returns 400 for more than 500 items', async () => {
    const res = await request(app)
      .post('/api/medications/bulk')
      .set('Authorization', AUTH)
      .send({ medications: Array.from({ length: 501 }, () => item()) });
    expect(res.status).toBe(400);
    expect(res.body.errors[0]).toMatch(/at most 500/);
  });

  it('accepts exactly 500 items', async () => {
    fakeConnection((sql) => Promise.resolve(/^SELECT/.test(sql) ? [[]] : [{ affectedRows: 1 }]));
    const res = await request(app)
      .post('/api/medications/bulk')
      .set('Authorization', AUTH)
      .send({ medications: Array.from({ length: 500 }, (_, i) => item({ sku: `S${i}` })) });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(500);
  });

  it('rejects the whole upload and points at each bad item, saving nothing', async () => {
    const res = await request(app)
      .post('/api/medications/bulk')
      .set('Authorization', AUTH)
      .send({
        medications: [
          item(),
          item({ quantity: -2 }),
          item({ name: undefined, price: 'free' }),
          'not an object',
          item({ sku: 'DUP' }),
          item({ sku: 'DUP' }),
          item({ unit: 'x'.repeat(31) }),
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Validation failed');
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        'medications[1]: quantity must be 0 or more',
        'medications[2]: name is required',
        'medications[2]: price must be a number',
        'medications[3] must be an object',
        'medications[5]: sku "DUP" appears more than once in this upload',
        'medications[6]: unit must be at most 30 characters',
      ])
    );
    expect(pool.getConnection).not.toHaveBeenCalled();
  });

  it('rolls everything back and says nothing was changed if the database fails midway', async () => {
    let calls = 0;
    const conn = fakeConnection(() => {
      calls += 1;
      return calls >= 3 ? Promise.reject(new Error('db failure')) : Promise.resolve([[]]);
    });

    const res = await request(app)
      .post('/api/medications/bulk')
      .set('Authorization', AUTH)
      .send({ medications: [item({ sku: 'A' }), item({ sku: 'B' })] });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Nothing was changed/);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------
describe('sku on single create / update', () => {
  const body = { name: 'X', quantity: 1, price: 1, pharmacy_id: 'uuid-1', sku: ' AMX-500 ' };

  it('POST saves the trimmed sku and returns 409 when you already use it', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]).mockResolvedValueOnce([[{ id: 'n1', ...body, sku: 'AMX-500' }]]);
    const ok = await request(app).post('/api/medications').set('Authorization', AUTH).send(body);
    expect(ok.status).toBe(201);
    expect(pool.query.mock.calls[0][1].slice(-2)).toEqual(['AMX-500', 'uuid-1']);

    pool.query.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    const dup = await request(app).post('/api/medications').set('Authorization', AUTH).send(body);
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatch(/sku/);
  });

  it('rejects a non-string or over-long sku', async () => {
    const res = await request(app)
      .post('/api/medications')
      .set('Authorization', AUTH)
      .send({ ...body, sku: 123 });
    expect(res.body.errors).toContain('sku must be a string');

    const long = await request(app)
      .post('/api/medications')
      .set('Authorization', AUTH)
      .send({ ...body, sku: 'x'.repeat(65) });
    expect(long.body.errors).toContain('sku must be at most 64 characters');
  });

  it('public by-pharmacy listing does not expose skus', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 'uuid-1' }]]).mockResolvedValueOnce([[]]);
    await request(app).get('/api/medications/by-pharmacy?name=X');
    expect(pool.query.mock.calls[1][0]).not.toMatch(/\bsku\b/);
  });
});

// ---------------------------------------------------------------
describe('JSON error handling', () => {
  it('answers an unknown API address with a JSON 404 (not an HTML page)', async () => {
    const res = await request(app).get('/api/nope/at-all');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.error).toBe('No such endpoint: GET /api/nope/at-all');
  });

  it('answers a malformed JSON body with a JSON 400 (not an HTML error page)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"accountType": "pharmacy", ');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.error).toMatch(/not valid JSON/);
  });

  it('answers an oversized body with a JSON 413', async () => {
    const res = await request(app)
      .post('/api/medications/bulk')
      .set('Authorization', AUTH)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ medications: [{ name: 'x'.repeat(1_200_000) }] }));
    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/too large/);
  });
});

// ---------------------------------------------------------------
describe('settings read from the environment', () => {
  function freshApp(env) {
    const saved = {};
    for (const k of Object.keys(env)) saved[k] = process.env[k];
    Object.assign(process.env, env);
    let fresh;
    jest.isolateModules(() => {
      fresh = require('../index');
    });
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    return fresh;
  }

  it('PARTNER_ORIGINS can limit browser access to named sites', async () => {
    const limited = freshApp({ PARTNER_ORIGINS: OTHER_SITE });
    const allowed = await request(limited).options('/api/auth/register').set('Origin', OTHER_SITE).set('Access-Control-Request-Method', 'POST');
    expect(allowed.headers['access-control-allow-origin']).toBe(OTHER_SITE);

    const blocked = await request(limited).options('/api/auth/register').set('Origin', 'https://stranger.example').set('Access-Control-Request-Method', 'POST');
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();

    const own = await request(limited).options('/api/auth/register').set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'POST');
    expect(own.headers['access-control-allow-origin']).toBe('http://localhost:5173');

    // public reads stay open to everyone
    pool.query.mockResolvedValue([[]]);
    const pub = await request(limited).get('/api/pharmacies').set('Origin', 'https://stranger.example');
    expect(pub.headers['access-control-allow-origin']).toBe('*');
  });

  it('REGISTER_LIMIT_PER_HOUR caps successful sign-ups only; failed attempts are not counted', async () => {
    const limited = freshApp({ REGISTER_LIMIT_PER_HOUR: '2' });
    const signup = (n) => request(limited).post('/api/auth/register').send({ accountType: 'user', name: 'N', email: `u${n}@x.com`, password: 'secret1' });
    pool.query.mockResolvedValue([{ affectedRows: 1 }]);

    for (let i = 0; i < 5; i += 1) {
      const bad = await request(limited).post('/api/auth/register').send({ accountType: 'user', name: 'N', email: 'bad', password: 'secret1' });
      expect(bad.status).toBe(400); // never reaches the limit
    }
    expect((await signup(1)).status).toBe(201);
    expect((await signup(2)).status).toBe(201);
    const third = await signup(3);
    expect(third.status).toBe(429);
    expect(third.body.error).toMatch(/Too many accounts/);
  });
});
