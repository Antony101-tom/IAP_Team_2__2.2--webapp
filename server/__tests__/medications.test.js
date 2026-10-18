const request = require('supertest');
const { pharmacyToken, userToken } = require('./helpers');

// Replace the real MySQL pool so tests never touch a live database.
// pool.query resolves to [rows] (SELECT) or [{ affectedRows }] (UPDATE/DELETE),
// the same shape mysql2 returns.
jest.mock('../db', () => ({ pool: { query: jest.fn() } }));

const { pool } = require('../db');
const app = require('../index');

const ok = (rows) => [rows];
const affected = (n) => [{ affectedRows: n }];

const med = {
  id: 'm1',
  name: 'Paracetamol',
  form: 'Tablet',
  category: 'Pain relief',
  quantity: 50,
  unit: 'box',
  price: 120.5,
  branch: 'CBD',
  pharmacy_id: 'uuid-1',
};

const validBody = {
  name: 'Paracetamol',
  form: 'Tablet',
  category: 'Pain relief',
  quantity: 50,
  unit: 'box',
  price: 120.5,
  branch: 'CBD',
  pharmacy_id: 'uuid-1',
};

const AUTH = pharmacyToken('uuid-1');


// The contract has no login token for these calls, so they work without one unless
// REQUIRE_LOGIN_FOR_WRITES=true (then a missing token is a 401).
async function expectLoginOnlyWhenRequired(send, okRows) {
  pool.query.mockResolvedValue(okRows);
  expect((await send()).status).not.toBe(401);
  process.env.REQUIRE_LOGIN_FOR_WRITES = 'true';
  try {
    expect((await send()).status).toBe(401);
  } finally {
    delete process.env.REQUIRE_LOGIN_FOR_WRITES;
  }
}

let errorSpy;
beforeEach(() => {
  pool.query.mockReset();
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  errorSpy.mockRestore();
});

// ---------------------------------------------------------------
describe('GET /api/medications', () => {
  it('returns 200 and a list with the expected fields', async () => {
    pool.query.mockResolvedValueOnce(ok([{ ...med, pharmacy: 'Goodlife', latitude: -1.29, longitude: 36.82 }]));
    const res = await request(app).get('/api/medications');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toHaveProperty('id');
    expect(typeof res.body[0].name).toBe('string');
    expect(typeof res.body[0].quantity).toBe('number');
    expect(typeof res.body[0].price).toBe('number');
    expect(res.body[0]).toHaveProperty('pharmacy_id');
    expect(res.body[0].pharmacy).toBe('Goodlife');
  });

  it('edge case: returns an empty array when there are no medications', async () => {
    pool.query.mockResolvedValueOnce(ok([]));
    const res = await request(app).get('/api/medications');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns 500 with an error message when the database fails', async () => {
    pool.query.mockRejectedValueOnce(new Error('db failure'));
    const res = await request(app).get('/api/medications');

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });
});

// ---------------------------------------------------------------
describe('GET /api/medications/mine', () => {
  it('requires a login', async () => {
    const res = await request(app).get('/api/medications/mine');
    expect(res.status).toBe(401);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('rejects a patient token', async () => {
    const res = await request(app).get('/api/medications/mine').set('Authorization', userToken());
    expect(res.status).toBe(403);
  });

  it("returns only the logged-in pharmacy's medications", async () => {
    pool.query.mockResolvedValueOnce(ok([med]));
    const res = await request(app).get('/api/medications/mine').set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body[0].pharmacy_id).toBe('uuid-1');
    expect(pool.query.mock.calls[0][1]).toEqual(['uuid-1']);
  });
});

// ---------------------------------------------------------------
describe('GET /api/medications/by-pharmacy', () => {
  it('returns 400 when the name query is missing', async () => {
    const res = await request(app).get('/api/medications/by-pharmacy');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('returns 404 when the pharmacy does not exist', async () => {
    pool.query.mockResolvedValueOnce(ok([]));
    const res = await request(app).get('/api/medications/by-pharmacy?name=Nowhere');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it("returns 200 and that pharmacy's medications", async () => {
    pool.query.mockResolvedValueOnce(ok([{ id: 'uuid-1' }])).mockResolvedValueOnce(ok([med]));
    const res = await request(app).get('/api/medications/by-pharmacy?name=Goodlife');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].pharmacy_id).toBe('uuid-1');
  });

  it('edge case: returns an empty array for a pharmacy with no stock', async () => {
    pool.query.mockResolvedValueOnce(ok([{ id: 'uuid-1' }])).mockResolvedValueOnce(ok([]));
    const res = await request(app).get('/api/medications/by-pharmacy?name=Goodlife');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ---------------------------------------------------------------
describe('POST /api/medications', () => {
  it('creates a medication and returns 201 with the new record', async () => {
    pool.query
      .mockResolvedValueOnce(affected(1))
      .mockResolvedValueOnce(ok([{ id: 'new1', ...validBody }]));
    const res = await request(app).post('/api/medications').set('Authorization', AUTH).send(validBody);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.name).toBe('Paracetamol');
    expect(res.body.quantity).toBe(50);
    // INSERT params: [id, name, form, category, quantity, unit, price, branch, sku, pharmacy_id]
    expect(pool.query.mock.calls[0][1].slice(1)).toEqual([
      'Paracetamol', 'Tablet', 'Pain relief', 50, 'box', 120.5, 'CBD', null, 'uuid-1',
    ]);
  });

  it('works without a login token (the contract has none); required only if REQUIRE_LOGIN_FOR_WRITES=true', async () => {
    await expectLoginOnlyWhenRequired(() => request(app).post('/api/medications').send(validBody), [{ affectedRows: 1 }]);
  });

  it('rejects a patient token', async () => {
    const res = await request(app).post('/api/medications').set('Authorization', userToken()).send(validBody);
    expect(res.status).toBe(403);
  });

  it("refuses to add stock to a different pharmacy's shelf", async () => {
    pool.query.mockResolvedValueOnce(ok([{ found: 1 }])); // that pharmacy exists, it just is not yours
    const res = await request(app)
      .post('/api/medications')
      .set('Authorization', AUTH)
      .send({ ...validBody, pharmacy_id: 'someone-else' });

    expect(res.status).toBe(403);
    expect(pool.query).toHaveBeenCalledTimes(1); // only the lookup, never an insert
  });

  it('rejects an empty body and lists every missing required field', async () => {
    const res = await request(app).post('/api/medications').set('Authorization', AUTH).send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Validation failed');
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        'name is required',
        'quantity is required',
        'price is required',
        'pharmacy_id is required',
      ])
    );
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('rejects wrong field types', async () => {
    const res = await request(app)
      .post('/api/medications')
      .set('Authorization', AUTH)
      .send({ ...validBody, name: 123, quantity: 'ten', price: '5', pharmacy_id: 42 });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        'name must be a string',
        'quantity must be an integer',
        'price must be a number',
        'pharmacy_id must be a string (uuid)',
      ])
    );
  });

  it('edge case: rejects a non-integer quantity like 1.5', async () => {
    const res = await request(app)
      .post('/api/medications')
      .set('Authorization', AUTH)
      .send({ ...validBody, quantity: 1.5 });

    expect(res.status).toBe(400);
    expect(res.body.errors).toContain('quantity must be an integer');
  });

  it('edge case: rejects a negative quantity or price', async () => {
    const res = await request(app)
      .post('/api/medications')
      .set('Authorization', AUTH)
      .send({ ...validBody, quantity: -1, price: -5 });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining(['quantity must be 0 or more', 'price must be 0 or more'])
    );
  });

  it('edge case: rejects numbers too big for the database columns (a clear 400, not a 500)', async () => {
    const res = await request(app)
      .post('/api/medications')
      .set('Authorization', AUTH)
      .send({ ...validBody, quantity: 2147483648, price: 100000000 });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining(['quantity must be 2147483647 or less', 'price must be 99999999.99 or less'])
    );
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('edge case: rejects text longer than its column allows', async () => {
    const res = await request(app)
      .post('/api/medications')
      .set('Authorization', AUTH)
      .send({ ...validBody, unit: 'x'.repeat(31) });

    expect(res.status).toBe(400);
    expect(res.body.errors).toContain('unit must be at most 30 characters');
  });

  it('edge case: accepts a quantity of 0 (out of stock)', async () => {
    pool.query
      .mockResolvedValueOnce(affected(1))
      .mockResolvedValueOnce(ok([{ id: 'new2', ...validBody, quantity: 0 }]));
    const res = await request(app)
      .post('/api/medications')
      .set('Authorization', AUTH)
      .send({ ...validBody, quantity: 0 });

    expect(res.status).toBe(201);
    expect(res.body.quantity).toBe(0);
  });

  it('returns 500 when the insert fails', async () => {
    pool.query.mockRejectedValueOnce(new Error('db failure'));
    const res = await request(app).post('/api/medications').set('Authorization', AUTH).send(validBody);

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });
});

// ---------------------------------------------------------------
describe('PUT /api/medications/:id', () => {
  it('replaces a medication and returns 200 with the updated record', async () => {
    pool.query
      .mockResolvedValueOnce(affected(1))
      .mockResolvedValueOnce(ok([{ id: 'm1', ...validBody, price: 99 }]));
    const res = await request(app)
      .put('/api/medications/m1')
      .set('Authorization', AUTH)
      .send({ ...validBody, price: 99 });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('m1');
    expect(res.body.price).toBe(99);
    // the UPDATE is scoped to the logged-in pharmacy: [..., id, pharmacy_id]
    expect(pool.query.mock.calls[0][1].slice(-2)).toEqual(['m1', 'uuid-1']);
  });

  it('works without a login token (the contract has none); required only if REQUIRE_LOGIN_FOR_WRITES=true', async () => {
    await expectLoginOnlyWhenRequired(() => request(app).put('/api/medications/m1').send(validBody), [{ affectedRows: 1 }]);
  });

  it('rejects a body with missing required fields', async () => {
    const res = await request(app).put('/api/medications/m1').set('Authorization', AUTH).send({ name: 'Only name' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Validation failed');
    expect(res.body.errors).toEqual(
      expect.arrayContaining(['quantity is required', 'price is required', 'pharmacy_id is required'])
    );
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('returns 404 when the medication does not exist (or belongs to another pharmacy)', async () => {
    pool.query.mockResolvedValueOnce(affected(0));
    const res = await request(app).put('/api/medications/9999').set('Authorization', AUTH).send(validBody);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 500 when the update fails', async () => {
    pool.query.mockRejectedValueOnce(new Error('db failure'));
    const res = await request(app).put('/api/medications/m1').set('Authorization', AUTH).send(validBody);

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });
});

// ---------------------------------------------------------------
describe('PATCH /api/medications/:id/stock', () => {
  it('updates only the quantity and returns 200', async () => {
    pool.query
      .mockResolvedValueOnce(affected(1))
      .mockResolvedValueOnce(ok([{ ...med, quantity: 10 }]));
    const res = await request(app)
      .patch('/api/medications/m1/stock')
      .set('Authorization', AUTH)
      .send({ quantity: 10 });

    expect(res.status).toBe(200);
    expect(res.body.quantity).toBe(10);
    expect(pool.query.mock.calls[0][1]).toEqual([10, 'm1', 'uuid-1']);
  });

  it('works without a login token (the contract has none); required only if REQUIRE_LOGIN_FOR_WRITES=true', async () => {
    await expectLoginOnlyWhenRequired(() => request(app).patch('/api/medications/m1/stock').send({ quantity: 10 }), [{ affectedRows: 1 }]);
  });

  it('returns 400 when quantity is missing', async () => {
    const res = await request(app).patch('/api/medications/m1/stock').set('Authorization', AUTH).send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('quantity is required');
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('returns 400 when quantity is not an integer', async () => {
    const res = await request(app)
      .patch('/api/medications/m1/stock')
      .set('Authorization', AUTH)
      .send({ quantity: 'lots' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('quantity must be an integer');
  });

  it('returns 400 when quantity is negative', async () => {
    const res = await request(app)
      .patch('/api/medications/m1/stock')
      .set('Authorization', AUTH)
      .send({ quantity: -3 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('quantity must be 0 or more');
  });

  it('returns 404 when the medication does not exist', async () => {
    pool.query.mockResolvedValueOnce(affected(0));
    const res = await request(app)
      .patch('/api/medications/9999/stock')
      .set('Authorization', AUTH)
      .send({ quantity: 5 });

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('edge case: accepts a quantity of 0', async () => {
    pool.query
      .mockResolvedValueOnce(affected(1))
      .mockResolvedValueOnce(ok([{ ...med, quantity: 0 }]));
    const res = await request(app)
      .patch('/api/medications/m1/stock')
      .set('Authorization', AUTH)
      .send({ quantity: 0 });

    expect(res.status).toBe(200);
    expect(res.body.quantity).toBe(0);
  });
});

// ---------------------------------------------------------------
describe('DELETE /api/medications/:id', () => {
  it('deletes the medication and returns 204 with no body', async () => {
    pool.query.mockResolvedValueOnce(affected(1));
    const res = await request(app).delete('/api/medications/m1').set('Authorization', AUTH);

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(pool.query.mock.calls[0][1]).toEqual(['m1', 'uuid-1']);
  });

  it('works without a login token (the contract has none); required only if REQUIRE_LOGIN_FOR_WRITES=true', async () => {
    await expectLoginOnlyWhenRequired(() => request(app).delete('/api/medications/m1'), [{ affectedRows: 1 }]);
  });

  it('returns 404 when the medication does not exist', async () => {
    pool.query.mockResolvedValueOnce(affected(0));
    const res = await request(app).delete('/api/medications/9999').set('Authorization', AUTH);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 500 when the delete fails', async () => {
    pool.query.mockRejectedValueOnce(new Error('db failure'));
    const res = await request(app).delete('/api/medications/m1').set('Authorization', AUTH);

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });
});
