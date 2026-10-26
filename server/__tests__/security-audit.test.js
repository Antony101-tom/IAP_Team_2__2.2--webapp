// Week 9, Part D: automated evidence for the self-audit in SECURITY_AUDIT.md.
// Each test is one question from the checklist: what could an attacker learn or change?
const bcrypt = require('bcrypt');
const { request } = require('./helpers');

jest.mock('../db', () => ({ pool: { query: jest.fn() } }));

const { pool } = require('../db');
const app = require('../index');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHARMACY = 'b3f1c2a0-1234-4a5b-9c3d-abcdef123456';
const ok = (rows) => [rows];

let errorSpy;
beforeEach(() => {
  pool.query.mockReset();
  pool.query.mockResolvedValue(ok([]));
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => errorSpy.mockRestore());

describe('sensitive fields', () => {
  it('login never returns the password hash, even though it reads it from the database', async () => {
    const hash = await bcrypt.hash('secret1', 4);
    pool.query.mockResolvedValueOnce(ok([{ id: 'u1', name: 'Jane', email: 'jane@example.com', password_hash: hash }]));
    const res = await request(app).post('/api/auth/login').send({ accountType: 'user', email: 'jane@example.com', password: 'secret1' });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/password|hash|\$2[aby]\$/i);
    expect(Object.keys(res.body.account).sort()).toEqual(['email', 'id', 'name', 'type']);
  });

  it('the public read endpoints never select an email or a password column', async () => {
    const urls = [
      '/api/medications',
      '/api/medications/search?name=a',
      '/api/medications/by-pharmacy?name=a',
      '/api/pharmacies',
      `/api/pharmacies/${PHARMACY}`,
    ];
    for (const url of urls) {
      pool.query.mockReset();
      pool.query.mockResolvedValue(ok([{ id: PHARMACY }]));
      await request(app).get(url);
      const sql = pool.query.mock.calls.map((c) => c[0]).join('\n');
      expect(sql).not.toMatch(/email|password|\bsku\b/i);
    }
  });
});

describe('write endpoints ignore extra fields', () => {
  it('POST /api/medications: an injected id, isAdmin or created_at is never stored', async () => {
    const row = { id: 'x', name: 'Drug', quantity: 1, price: 2, pharmacy_id: PHARMACY };
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]).mockResolvedValueOnce(ok([row]));
    const res = await request(app).post('/api/medications').send({
      name: 'Drug', quantity: 1, price: 2, pharmacy_id: PHARMACY,
      id: 'attacker-chosen-id', isAdmin: true, created_at: '1999-01-01', role: 'admin',
    });
    expect(res.status).toBe(201);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).not.toMatch(/isAdmin|role|created_at/i);
    expect(params).not.toContain('attacker-chosen-id');
    expect(params).not.toContain(true);
    expect(params).not.toContain('admin');
    expect(params).not.toContain('1999-01-01');
    expect(params[0]).toMatch(UUID_RE); // the server generates the id
  });

  it('POST /api/auth/register: id, isAdmin and password_hash in the body are ignored', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    const res = await request(app).post('/api/auth/register').send({
      accountType: 'user', name: 'Jane', email: 'jane@example.com', password: 'secret1',
      id: 'attacker-id', isAdmin: true, password_hash: 'known-hash',
    });
    expect(res.status).toBe(201);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/\(id, name, email, password_hash\)/); // only the fixed columns
    expect(params).not.toContain('attacker-id');
    expect(params).not.toContain('known-hash');
    expect(params).not.toContain(true);
    expect(res.body.account.id).toMatch(UUID_RE);
    expect(res.body.account).not.toHaveProperty('isAdmin');
  });

  it('PATCH /api/pharmacies/me: only the listed profile fields can be changed (not id or email)', async () => {
    const { pharmacyToken } = require('./helpers');
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]).mockResolvedValueOnce(ok([{ id: 'uuid-1', name: 'New' }]));
    await request(app).patch('/api/pharmacies/me').set('Authorization', pharmacyToken('uuid-1'))
      .send({ name: 'New', id: 'other', email: 'evil@example.com', password_hash: 'x', isAdmin: true });
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/^UPDATE pharmacies SET name = \? WHERE id = \?$/);
  });

  it('a logged-in pharmacy cannot write for another pharmacy by changing pharmacy_id', async () => {
    const { pharmacyToken } = require('./helpers');
    pool.query.mockResolvedValueOnce(ok([{ found: 1 }])); // the other pharmacy exists
    const res = await request(app).post('/api/medications').set('Authorization', pharmacyToken('uuid-1'))
      .send({ name: 'Drug', quantity: 1, price: 2, pharmacy_id: PHARMACY });
    expect(res.status).toBe(403);
  });
});

describe('error messages reveal nothing internal', () => {
  const LEAKY = /relation|column|syntax|select |insert |postgres|supabase|\/srv\/|\/home\/|node_modules|\.js:\d|\bat \w+/i;

  it('a database failure is a generic 500 with no query, table name, path or stack trace', async () => {
    pool.query.mockRejectedValue(new Error('relation "medications" does not exist at /srv/app/db.js:42:7 SELECT * FROM medications'));
    for (const url of ['/api/medications', '/api/pharmacies', `/api/pharmacies/${PHARMACY}`, '/api/medications/search?name=a']) {
      const res = await request(app).get(url);
      expect(res.status).toBe(500);
      expect(res.headers['content-type']).toMatch(/json/);
      expect(JSON.stringify(res.body)).not.toMatch(LEAKY);
    }
  });

  it('malformed JSON is a clean 400, not a stack trace', async () => {
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{ not json');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(LEAKY);
  });

  it('an oversized body is a clean 413', async () => {
    const res = await request(app).post('/api/medications/bulk').set('Content-Type', 'application/json')
      .send(JSON.stringify({ medications: [{ name: 'x'.repeat(1_200_000) }] }));
    expect(res.status).toBe(413);
  });

  it('an unknown endpoint is a JSON 404 that does not echo the query string', async () => {
    const res = await request(app).get('/api/nope?secret=abc');
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('abc');
  });

  it('login gives the same answer for an unknown email and a wrong password', async () => {
    pool.query.mockResolvedValueOnce(ok([]));
    const unknown = await request(app).post('/api/auth/login').send({ accountType: 'user', email: 'no@example.com', password: 'whatever' });
    pool.query.mockResolvedValueOnce(ok([{ id: 'u1', name: 'J', email: 'j@example.com', password_hash: await bcrypt.hash('right-one', 4) }]));
    const wrong = await request(app).post('/api/auth/login').send({ accountType: 'user', email: 'j@example.com', password: 'wrong-one' });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
  });
});

describe('keys in the wrong place', () => {
  it('requests and failures are not logged with the key', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    pool.query.mockRejectedValue(new Error('boom'));
    await request(app).get('/api/medications');
    await request(app).get('/api/medications').set('X-API-Key', 'some-wrong-key-12345');
    const printed = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().map(String).join('\n');
    expect(printed).not.toContain('some-wrong-key-12345');
    expect(printed).not.toContain(require('./helpers').TEST_API_KEY);
    logSpy.mockRestore();
  });
});
