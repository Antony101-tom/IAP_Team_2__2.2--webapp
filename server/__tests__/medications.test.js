const request = require('supertest');
const app = require('../app');
const supabase = require('../supabaseClient');

const FAKE_ID = '00000000-0000-0000-0000-000000000000';
let pharmacy;
const createdIds = [];

const validMed = () => ({
  name: 'Test Paracetamol 500mg',
  form: 'Tablet',
  category: 'Analgesic',
  quantity: 120,
  unit: 'box',
  price: 50,
  branch: 'Kilimani Branch',
  pharmacy_id: pharmacy.id,
});

async function createMed(overrides = {}) {
  const res = await request(app).post('/api/medications').send({ ...validMed(), ...overrides });
  if (res.body.id) createdIds.push(res.body.id);
  return res;
}

beforeAll(async () => {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name')
    .eq('type', 'pharmacy')
    .limit(1);

  if (error) throw new Error('Cannot read profiles: ' + error.message);
  if (!data || data.length === 0) throw new Error('No pharmacy found in profiles');

  pharmacy = data[0];
});

afterAll(async () => {
  for (const id of createdIds) {
    await supabase.from('medications').delete().eq('id', id);
  }
});

describe('GET /api/medications', () => {
  it('returns an array of medications with the right fields', async () => {
    await createMed();
    const res = await request(app).get('/api/medications');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    const m = res.body[0];
    expect(m).toHaveProperty('id');
    expect(typeof m.name).toBe('string');
    expect(typeof m.quantity).toBe('number');
    expect(m).toHaveProperty('pharmacy_id');
  });
});

describe('GET /api/medications/by-pharmacy', () => {
  it('returns medications for a real pharmacy', async () => {
    await createMed();
    const res = await request(app).get('/api/medications/by-pharmacy').query({ name: pharmacy.name });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    res.body.forEach((m) => expect(m.pharmacy_id).toBe(pharmacy.id));
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app).get('/api/medications/by-pharmacy');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 404 for a pharmacy that does not exist', async () => {
    const res = await request(app).get('/api/medications/by-pharmacy').query({ name: 'No Such Pharmacy XYZ' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Pharmacy not found');
  });
});

describe('POST /api/medications', () => {
  it('creates a medication (happy path)', async () => {
    const res = await createMed();
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.name).toBe('Test Paracetamol 500mg');
    expect(res.body.quantity).toBe(120);
    expect(typeof res.body.price).toBe('number');
    expect(res.body.pharmacy_id).toBe(pharmacy.id);
  });

  it('rejects a missing name', async () => {
    const { name, ...bad } = validMed();
    const res = await request(app).post('/api/medications').send(bad);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Validation failed');
    expect(res.body.errors).toContain('name is required');
  });

  it('rejects a wrong type for price', async () => {
    const res = await request(app).post('/api/medications').send({ ...validMed(), price: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.errors).toContain('price must be a number');
  });

  it('rejects a non-integer quantity (edge case)', async () => {
    const res = await request(app).post('/api/medications').send({ ...validMed(), quantity: 1.5 });
    expect(res.status).toBe(400);
    expect(res.body.errors).toContain('quantity must be an integer');
  });

  it('returns 404 for a pharmacy_id that does not exist', async () => {
    const res = await request(app).post('/api/medications').send({ ...validMed(), pharmacy_id: FAKE_ID });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Pharmacy not found');
  });
});

describe('PUT /api/medications/:id', () => {
  it('replaces a medication (happy path)', async () => {
    const created = await createMed();
    const res = await request(app)
      .put(`/api/medications/${created.body.id}`)
      .send({ ...validMed(), name: 'Updated Name', price: 75 });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Name');
    expect(res.body.price).toBe(75);
  });

  it('rejects a missing required field', async () => {
    const created = await createMed();
    const { price, ...bad } = validMed();
    const res = await request(app).put(`/api/medications/${created.body.id}`).send(bad);
    expect(res.status).toBe(400);
    expect(res.body.errors).toContain('price is required');
  });

  it('returns 404 for an id that does not exist', async () => {
    const res = await request(app).put(`/api/medications/${FAKE_ID}`).send(validMed());
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Medication not found');
  });
});

describe('PATCH /api/medications/:id/stock', () => {
  it('updates quantity (happy path)', async () => {
    const created = await createMed();
    const res = await request(app).patch(`/api/medications/${created.body.id}/stock`).send({ quantity: 10 });
    expect(res.status).toBe(200);
    expect(res.body.quantity).toBe(10);
  });

  it('accepts 0 as a boundary value', async () => {
    const created = await createMed();
    const res = await request(app).patch(`/api/medications/${created.body.id}/stock`).send({ quantity: 0 });
    expect(res.status).toBe(200);
    expect(res.body.quantity).toBe(0);
  });

  it('rejects a missing quantity', async () => {
    const created = await createMed();
    const res = await request(app).patch(`/api/medications/${created.body.id}/stock`).send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('quantity is required');
  });

  it('rejects a string quantity', async () => {
    const created = await createMed();
    const res = await request(app).patch(`/api/medications/${created.body.id}/stock`).send({ quantity: 'ten' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('quantity must be an integer');
  });

  it('returns 404 for an id that does not exist', async () => {
    const res = await request(app).patch(`/api/medications/${FAKE_ID}/stock`).send({ quantity: 5 });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/medications/:id', () => {
  it('deletes a medication (happy path)', async () => {
    const created = await createMed();
    const res = await request(app).delete(`/api/medications/${created.body.id}`);
    expect(res.status).toBe(204);
    const again = await request(app).delete(`/api/medications/${created.body.id}`);
    expect(again.status).toBe(404);
  });

  it('returns 404 for an id that does not exist', async () => {
    const res = await request(app).delete(`/api/medications/${FAKE_ID}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Medication not found');
  });
});