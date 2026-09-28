const request = require('supertest');

// Replace the real Supabase client so tests never touch your live database
jest.mock('../supabaseClient', () => ({ from: jest.fn() }));

const supabase = require('../supabaseClient');
const app = require('../index');

// Fake query builder: every chained call returns itself, and the
// result you pass in is what the route gets back from Supabase
function builder(result) {
  const b = {};
  ['select', 'ilike', 'eq', 'insert', 'update', 'delete'].forEach((m) => {
    b[m] = jest.fn(() => b);
  });
  b.single = jest.fn(() => Promise.resolve(result));
  b.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return b;
}

const ok = (data) => ({ data, error: null });
const fail = () => ({ data: null, error: { message: 'db failure' } });

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

let errorSpy;
beforeEach(() => {
  supabase.from.mockReset();
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  errorSpy.mockRestore();
});

// ---------------------------------------------------------------
describe('GET /api/medications', () => {
  it('returns 200 and a list with the expected fields', async () => {
    supabase.from.mockReturnValueOnce(builder(ok([med])));
    const res = await request(app).get('/api/medications');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toHaveProperty('id');
    expect(typeof res.body[0].name).toBe('string');
    expect(typeof res.body[0].quantity).toBe('number');
    expect(typeof res.body[0].price).toBe('number');
    expect(res.body[0]).toHaveProperty('pharmacy_id');
  });

  it('edge case: returns an empty array when there are no medications', async () => {
    supabase.from.mockReturnValueOnce(builder(ok([])));
    const res = await request(app).get('/api/medications');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns 500 with an error message when the database fails', async () => {
    supabase.from.mockReturnValueOnce(builder(fail()));
    const res = await request(app).get('/api/medications');

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });
});

// ---------------------------------------------------------------
describe('GET /api/medications/by-pharmacy', () => {
  it('returns 400 when the name query is missing', async () => {
    const res = await request(app).get('/api/medications/by-pharmacy');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('returns 404 when the pharmacy does not exist', async () => {
    supabase.from.mockReturnValueOnce(builder(fail()));
    const res = await request(app).get('/api/medications/by-pharmacy?name=Nowhere');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 200 and that pharmacy\'s medications', async () => {
    supabase.from
      .mockReturnValueOnce(builder(ok({ id: 'uuid-1' })))
      .mockReturnValueOnce(builder(ok([med])));
    const res = await request(app).get('/api/medications/by-pharmacy?name=Goodlife');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].pharmacy_id).toBe('uuid-1');
  });

  it('edge case: returns an empty array for a pharmacy with no stock', async () => {
    supabase.from
      .mockReturnValueOnce(builder(ok({ id: 'uuid-1' })))
      .mockReturnValueOnce(builder(ok([])));
    const res = await request(app).get('/api/medications/by-pharmacy?name=Goodlife');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ---------------------------------------------------------------
describe('POST /api/medications', () => {
  it('creates a medication and returns 201 with the new record', async () => {
    const insertBuilder = builder(ok({ id: 'new1', ...validBody }));
    supabase.from.mockReturnValueOnce(insertBuilder);
    const res = await request(app).post('/api/medications').send(validBody);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.name).toBe('Paracetamol');
    expect(res.body.quantity).toBe(50);
    expect(insertBuilder.insert).toHaveBeenCalledWith(validBody);
  });

  it('rejects an empty body and lists every missing required field', async () => {
    const res = await request(app).post('/api/medications').send({});

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
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('rejects wrong field types', async () => {
    const res = await request(app)
      .post('/api/medications')
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
      .send({ ...validBody, quantity: 1.5 });

    expect(res.status).toBe(400);
    expect(res.body.errors).toContain('quantity must be an integer');
  });

  it('edge case: accepts a quantity of 0 (out of stock)', async () => {
    supabase.from.mockReturnValueOnce(builder(ok({ id: 'new2', ...validBody, quantity: 0 })));
    const res = await request(app)
      .post('/api/medications')
      .send({ ...validBody, quantity: 0 });

    expect(res.status).toBe(201);
    expect(res.body.quantity).toBe(0);
  });

  it('returns 500 when the insert fails', async () => {
    supabase.from.mockReturnValueOnce(builder(fail()));
    const res = await request(app).post('/api/medications').send(validBody);

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });
});

// ---------------------------------------------------------------
describe('PUT /api/medications/:id', () => {
  it('replaces a medication and returns 200 with the updated record', async () => {
    const updated = { id: 'm1', ...validBody, price: 99 };
    const updateBuilder = builder(ok(updated));
    supabase.from
      .mockReturnValueOnce(builder(ok({ id: 'm1' })))
      .mockReturnValueOnce(updateBuilder);
    const res = await request(app)
      .put('/api/medications/m1')
      .send({ ...validBody, price: 99 });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('m1');
    expect(res.body.price).toBe(99);
    expect(updateBuilder.update).toHaveBeenCalledWith({ ...validBody, price: 99 });
  });

  it('rejects a body with missing required fields', async () => {
    const res = await request(app).put('/api/medications/m1').send({ name: 'Only name' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Validation failed');
    expect(res.body.errors).toEqual(
      expect.arrayContaining(['quantity is required', 'price is required', 'pharmacy_id is required'])
    );
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('returns 404 when the medication does not exist', async () => {
    supabase.from.mockReturnValueOnce(builder(fail()));
    const res = await request(app).put('/api/medications/9999').send(validBody);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 500 when the update fails', async () => {
    supabase.from
      .mockReturnValueOnce(builder(ok({ id: 'm1' })))
      .mockReturnValueOnce(builder(fail()));
    const res = await request(app).put('/api/medications/m1').send(validBody);

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });
});

// ---------------------------------------------------------------
describe('PATCH /api/medications/:id/stock', () => {
  it('updates only the quantity and returns 200', async () => {
    const updateBuilder = builder(ok({ ...med, quantity: 10 }));
    supabase.from
      .mockReturnValueOnce(builder(ok({ id: 'm1' })))
      .mockReturnValueOnce(updateBuilder);
    const res = await request(app).patch('/api/medications/m1/stock').send({ quantity: 10 });

    expect(res.status).toBe(200);
    expect(res.body.quantity).toBe(10);
    expect(updateBuilder.update).toHaveBeenCalledWith({ quantity: 10 });
  });

  it('returns 400 when quantity is missing', async () => {
    const res = await request(app).patch('/api/medications/m1/stock').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('quantity is required');
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('returns 400 when quantity is not an integer', async () => {
    const res = await request(app).patch('/api/medications/m1/stock').send({ quantity: 'lots' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('quantity must be an integer');
  });

  it('returns 404 when the medication does not exist', async () => {
    supabase.from.mockReturnValueOnce(builder(fail()));
    const res = await request(app).patch('/api/medications/9999/stock').send({ quantity: 5 });

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('edge case: accepts a quantity of 0', async () => {
    supabase.from
      .mockReturnValueOnce(builder(ok({ id: 'm1' })))
      .mockReturnValueOnce(builder(ok({ ...med, quantity: 0 })));
    const res = await request(app).patch('/api/medications/m1/stock').send({ quantity: 0 });

    expect(res.status).toBe(200);
    expect(res.body.quantity).toBe(0);
  });
});

// ---------------------------------------------------------------
describe('DELETE /api/medications/:id', () => {
  it('deletes the medication and returns 204 with no body', async () => {
    supabase.from
      .mockReturnValueOnce(builder(ok({ id: 'm1' })))
      .mockReturnValueOnce(builder({ error: null }));
    const res = await request(app).delete('/api/medications/m1');

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
  });

  it('returns 404 when the medication does not exist', async () => {
    supabase.from.mockReturnValueOnce(builder(fail()));
    const res = await request(app).delete('/api/medications/9999');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 500 when the delete fails', async () => {
    supabase.from
      .mockReturnValueOnce(builder(ok({ id: 'm1' })))
      .mockReturnValueOnce(builder({ error: { message: 'db failure' } }));
    const res = await request(app).delete('/api/medications/m1');

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });
});