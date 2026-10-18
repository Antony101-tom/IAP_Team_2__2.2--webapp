// Checks the running API against openapi.yaml, the contract the team agreed.
// It reads the contract file itself, calls every operation WITHOUT a login token (the
// contract has none), and checks each response's status code and body against the schema
// the contract gives for it. The last test fails if any documented response was never exercised.
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const YAML = require('yaml');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const { pharmacyToken } = require('./helpers');

jest.mock('../db', () => ({ pool: { query: jest.fn() } }));

const { pool } = require('../db');
const app = require('../index');

const contract = YAML.parse(fs.readFileSync(path.join(__dirname, '../../openapi.yaml'), 'utf8'));
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(contract, 'contract');

// "#/components/schemas/X" inside a response schema must point into the contract document
function compile(schema) {
  const rooted = JSON.parse(JSON.stringify(schema).replace(/"#\/components\/schemas\//g, '"contract#/components/schemas/'));
  return ajv.compile(rooted);
}

const exercised = new Set();

// A response in the contract may be a reference like '#/components/responses/ServerError'
const resolveResponse = (raw) =>
  raw && raw.$ref ? raw.$ref.replace(/^#\//, '').split('/').reduce((node, key) => node[key], contract) : raw;

// Asserts the response is one the contract documents for this operation, and that its body matches
function expectContract(method, pathTemplate, res) {
  const responses = contract.paths[pathTemplate][method].responses;
  const documented = resolveResponse(responses[String(res.status)]);
  expect([res.status, Object.keys(responses)]).toEqual([res.status, expect.arrayContaining([String(res.status)])]);
  exercised.add(`${method.toUpperCase()} ${pathTemplate} ${res.status}`);

  const jsonSchema = documented.content && documented.content['application/json'].schema;
  if (jsonSchema) {
    const validate = compile(jsonSchema);
    const ok = validate(res.body);
    expect({ valid: ok, errors: ok ? [] : validate.errors, body: res.body }).toMatchObject({ valid: true });
  } else {
    expect(res.text).toBe(''); // "No content returned"
  }
}

const ID = '1797cd3d-cd55-41bc-b791-ffbf1c0187b8';
const PHARMACY = 'b3f1c2a0-1234-4a5b-9c3d-abcdef123456';

// A database row as MySQL returns it: optional columns the pharmacy left blank are NULL
const fullRow = { id: ID, name: 'Paracetamol 500mg', form: 'Tablet', category: 'Analgesic', quantity: 120, unit: 'box', price: 50, branch: 'Kilimani Branch', sku: null, pharmacy_id: PHARMACY, created_at: new Date('2026-10-12T11:29:11.492Z') };
const sparseRow = { id: ID, name: 'Bare', form: null, category: null, quantity: 0, unit: null, price: 9.5, branch: null, sku: null, pharmacy_id: PHARMACY };

const input = { name: 'Paracetamol 500mg', form: 'Tablet', category: 'Analgesic', quantity: 120, unit: 'box', price: 50.0, branch: 'Kilimani Branch', pharmacy_id: PHARMACY };
const ok = (rows) => [rows];
const affected = (n) => [{ affectedRows: n }];

let errorSpy;
beforeEach(() => {
  pool.query.mockReset();
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => errorSpy.mockRestore());

describe('GET /medications', () => {
  it('200: an array of Medication', async () => {
    pool.query.mockResolvedValueOnce(ok([{ ...fullRow, pharmacy: 'Halisi', latitude: -1.29, longitude: 36.78 }, { ...sparseRow, pharmacy: 'X', latitude: null, longitude: null }]));
    expectContract('get', '/medications', await request(app).get('/api/medications'));
  });

  it('empty optional fields are left out rather than sent as null (the contract says they are strings)', async () => {
    pool.query.mockResolvedValueOnce(ok([{ ...sparseRow, pharmacy: 'X', latitude: null, longitude: null }]));
    const res = await request(app).get('/api/medications');
    for (const field of ['form', 'category', 'unit', 'branch', 'sku']) expect(res.body[0]).not.toHaveProperty(field);
    expect(res.body[0]).toMatchObject({ name: 'Bare', quantity: 0, price: 9.5 });
  });
});

describe('POST /medications', () => {
  it('201: the created Medication (no login token)', async () => {
    pool.query.mockResolvedValueOnce(affected(1)).mockResolvedValueOnce(ok([fullRow]));
    const res = await request(app).post('/api/medications').send(input);
    expectContract('post', '/medications', res);
    expect(pool.query.mock.calls[0][1].slice(-1)).toEqual([PHARMACY]); // saved against the pharmacy_id in the body
  });

  it('201: a record with only the required fields', async () => {
    pool.query.mockResolvedValueOnce(affected(1)).mockResolvedValueOnce(ok([sparseRow]));
    expectContract('post', '/medications', await request(app).post('/api/medications').send({ name: 'Bare', quantity: 0, price: 9.5, pharmacy_id: PHARMACY }));
  });

  it.each([
    ['empty body', {}],
    ['wrong types', { ...input, name: 5, quantity: 'ten', price: '5', pharmacy_id: 7 }],
    ['non-integer quantity', { ...input, quantity: 1.5 }],
  ])('400: ValidationError for %s', async (_label, body) => {
    const res = await request(app).post('/api/medications').send(body);
    expectContract('post', '/medications', res);
    expect(res.body.message).toBe('Validation failed');
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('404: Error "Pharmacy not found" when pharmacy_id matches no pharmacy', async () => {
    pool.query.mockRejectedValueOnce(Object.assign(new Error('fk'), { code: '23503' }));
    const res = await request(app).post('/api/medications').send(input);
    expect(res.status).toBe(404);
    expectContract('post', '/medications', res);
    expect(res.body).toEqual({ error: 'Pharmacy not found' });
  });
});

describe('GET /medications/by-pharmacy', () => {
  it('200: an array of Medication', async () => {
    pool.query.mockResolvedValueOnce(ok([{ id: PHARMACY }])).mockResolvedValueOnce(ok([fullRow, sparseRow]));
    expectContract('get', '/medications/by-pharmacy', await request(app).get('/api/medications/by-pharmacy?name=Halisi%20Pharmaceuticals'));
  });
  it('400: Error when "name" is missing', async () => {
    expectContract('get', '/medications/by-pharmacy', await request(app).get('/api/medications/by-pharmacy'));
  });
  it('404: Error when no pharmacy has that name', async () => {
    pool.query.mockResolvedValueOnce(ok([]));
    expectContract('get', '/medications/by-pharmacy', await request(app).get('/api/medications/by-pharmacy?name=Nowhere'));
  });
});

describe('PUT /medications/{id}', () => {
  it('200: the full updated Medication (no login token)', async () => {
    pool.query.mockResolvedValueOnce(affected(1)).mockResolvedValueOnce(ok([fullRow]));
    const res = await request(app).put(`/api/medications/${ID}`).send(input);
    expectContract('put', '/medications/{id}', res);
    expect(pool.query.mock.calls[0][0]).not.toMatch(/AND pharmacy_id = \?/); // no login, so no ownership filter
  });
  it('400: ValidationError for missing fields', async () => {
    const res = await request(app).put(`/api/medications/${ID}`).send({ name: 'Only a name' });
    expectContract('put', '/medications/{id}', res);
    expect(res.body.errors).toEqual(expect.arrayContaining(['quantity is required', 'price is required', 'pharmacy_id is required']));
  });
  it('404: "Pharmacy not found" when the pharmacy_id in the body matches no pharmacy', async () => {
    pool.query.mockRejectedValueOnce(Object.assign(new Error('fk'), { code: '23503' }));
    const res = await request(app).put(`/api/medications/${ID}`).send(input);
    expect(res.status).toBe(404);
    expectContract('put', '/medications/{id}', res);
    expect(res.body).toEqual({ error: 'Pharmacy not found' });
  });
  it('404: "Medication not found" when the id in the URL does not exist', async () => {
    pool.query.mockResolvedValueOnce(affected(0));
    const res = await request(app).put('/api/medications/9999').send(input);
    expect(res.status).toBe(404);
    expectContract('put', '/medications/{id}', res);
    expect(res.body).toEqual({ error: 'Medication not found' });
  });
});

describe('DELETE /medications/{id}', () => {
  it('204: no content (no login token)', async () => {
    pool.query.mockResolvedValueOnce(affected(1));
    expectContract('delete', '/medications/{id}', await request(app).delete(`/api/medications/${ID}`));
  });
  it('404: Error when the id does not exist', async () => {
    pool.query.mockResolvedValueOnce(affected(0));
    expectContract('delete', '/medications/{id}', await request(app).delete('/api/medications/9999'));
  });
});

describe('PATCH /medications/{id}/stock', () => {
  it('200: the updated Medication (no login token)', async () => {
    pool.query.mockResolvedValueOnce(affected(1)).mockResolvedValueOnce(ok([{ ...fullRow, quantity: 85 }]));
    const res = await request(app).patch(`/api/medications/${ID}/stock`).send({ quantity: 85 });
    expectContract('patch', '/medications/{id}/stock', res);
    expect(res.body.quantity).toBe(85);
  });
  it.each([
    ['quantity missing', {}],
    ['quantity not an integer', { quantity: 'lots' }],
    ['quantity negative', { quantity: -3 }],
  ])('400: an Error body ({ error }), not { message }, when %s', async (_label, body) => {
    const res = await request(app).patch(`/api/medications/${ID}/stock`).send(body);
    expectContract('patch', '/medications/{id}/stock', res);
    expect(typeof res.body.error).toBe('string');
  });
  it('404: Error when the id does not exist', async () => {
    pool.query.mockResolvedValueOnce(affected(0));
    expectContract('patch', '/medications/{id}/stock', await request(app).patch('/api/medications/9999/stock').send({ quantity: 5 }));
  });
});

describe('500: an unexpected failure is the contract\'s ServerError, { error: "..." }', () => {
  const boom = () => pool.query.mockRejectedValueOnce(new Error('database down'));
  const check = (method, template, res) => {
    expect(res.status).toBe(500);
    expectContract(method, template, res);
    expect(typeof res.body.error).toBe('string');
    expect(JSON.stringify(res.body)).not.toMatch(/database down/); // internals are not leaked
  };

  it('GET /medications', async () => {
    boom();
    check('get', '/medications', await request(app).get('/api/medications'));
  });
  it('POST /medications', async () => {
    boom();
    check('post', '/medications', await request(app).post('/api/medications').send(input));
  });
  it('GET /medications/by-pharmacy', async () => {
    boom();
    check('get', '/medications/by-pharmacy', await request(app).get('/api/medications/by-pharmacy?name=X'));
  });
  it('PUT /medications/{id}', async () => {
    boom();
    check('put', '/medications/{id}', await request(app).put(`/api/medications/${ID}`).send(input));
  });
  it('DELETE /medications/{id}', async () => {
    boom();
    check('delete', '/medications/{id}', await request(app).delete(`/api/medications/${ID}`));
  });
  it('PATCH /medications/{id}/stock', async () => {
    boom();
    check('patch', '/medications/{id}/stock', await request(app).patch(`/api/medications/${ID}/stock`).send({ quantity: 1 }));
  });
});

describe('details the contract spells out', () => {
  it('by-pharmacy matches the name exactly and case-sensitively', async () => {
    pool.query.mockResolvedValueOnce(ok([]));
    await request(app).get('/api/medications/by-pharmacy?name=Jadeezy%20Pharmacy');
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/WHERE name = \?/);
    expect(sql).not.toMatch(/LOWER|ILIKE/i);
    expect(params).toEqual(['Jadeezy Pharmacy']);
  });

  it('created_at is returned as a date-time string', async () => {
    pool.query.mockResolvedValueOnce(ok([fullRow]));
    const res = await request(app).get('/api/medications');
    expect(res.body[0].created_at).toBe('2026-10-12T11:29:11.492Z');
    expectContract('get', '/medications', res);
  });
});

describe('login tokens are optional for these operations', () => {
  const AUTH = pharmacyToken(PHARMACY);

  it('with a pharmacy token the same calls still follow the contract, and are limited to that pharmacy', async () => {
    pool.query.mockResolvedValueOnce(affected(1)).mockResolvedValueOnce(ok([fullRow]));
    const res = await request(app).put(`/api/medications/${ID}`).set('Authorization', AUTH).send(input);
    expectContract('put', '/medications/{id}', res);
    expect(pool.query.mock.calls[0][0]).toMatch(/WHERE id = \? AND pharmacy_id = \?/);
    expect(pool.query.mock.calls[0][1].slice(-2)).toEqual([ID, PHARMACY]);

    pool.query.mockResolvedValueOnce(affected(0)); // someone else's medication
    expectContract('patch', '/medications/{id}/stock', await request(app).patch(`/api/medications/${ID}/stock`).set('Authorization', AUTH).send({ quantity: 1 }));
  });

  it("with a token, writing for someone else's real pharmacy is refused (403)", async () => {
    pool.query.mockResolvedValueOnce(ok([{ found: 1 }])); // that pharmacy exists, it just isn't yours
    const res = await request(app).post('/api/medications').set('Authorization', AUTH).send({ ...input, pharmacy_id: 'someone-else' });
    expect(res.status).toBe(403);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('with a token, a pharmacy_id that does not exist is still the contract\'s 404 "Pharmacy not found"', async () => {
    pool.query.mockResolvedValueOnce(ok([])); // no such pharmacy
    const res = await request(app).post('/api/medications').set('Authorization', AUTH).send({ ...input, pharmacy_id: 'no-such-pharmacy' });
    expect(res.status).toBe(404);
    expectContract('post', '/medications', res);
    expect(res.body).toEqual({ error: 'Pharmacy not found' });
  });

  it('an invalid token is rejected (401) rather than ignored', async () => {
    const res = await request(app).delete(`/api/medications/${ID}`).set('Authorization', 'Bearer garbage');
    expect(res.status).toBe(401);
  });

  it('REQUIRE_LOGIN_FOR_WRITES=true turns the token into a requirement', async () => {
    process.env.REQUIRE_LOGIN_FOR_WRITES = 'true';
    try {
      expect((await request(app).post('/api/medications').send(input)).status).toBe(401);
      expect((await request(app).put(`/api/medications/${ID}`).send(input)).status).toBe(401);
      expect((await request(app).patch(`/api/medications/${ID}/stock`).send({ quantity: 1 })).status).toBe(401);
      expect((await request(app).delete(`/api/medications/${ID}`)).status).toBe(401);
      expect(pool.query).not.toHaveBeenCalled();
      // reads stay open
      pool.query.mockResolvedValueOnce(ok([]));
      expect((await request(app).get('/api/medications')).status).toBe(200);
    } finally {
      delete process.env.REQUIRE_LOGIN_FOR_WRITES;
    }
  });
});

// Keep this test last: it fails if the contract gains a response nobody tests
describe('coverage of the contract', () => {
  it('every response documented in openapi.yaml was exercised above', () => {
    const documented = [];
    for (const [p, ops] of Object.entries(contract.paths)) {
      for (const [method, op] of Object.entries(ops)) {
        for (const status of Object.keys(op.responses)) documented.push(`${method.toUpperCase()} ${p} ${status}`);
      }
    }
    expect(documented.filter((d) => !exercised.has(d))).toEqual([]);
    expect(documented.length).toBe(21);
  });
});
