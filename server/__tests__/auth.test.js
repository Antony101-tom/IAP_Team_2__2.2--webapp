const request = require('supertest');
const bcrypt = require('bcrypt');
require('./helpers');

jest.mock('../db', () => ({ pool: { query: jest.fn() } }));

const { pool } = require('../db');
const app = require('../index');

let errorSpy;
beforeEach(() => {
  pool.query.mockReset();
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => errorSpy.mockRestore());

describe('POST /api/auth/register', () => {
  const body = { accountType: 'user', name: 'Jane Doe', email: ' Jane@Example.com ', password: 'secret1' };

  it('creates an account, stores a bcrypt hash (not the password) and returns a token', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    const res = await request(app).post('/api/auth/register').send(body);

    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.account).toMatchObject({ type: 'user', name: 'Jane Doe', email: 'jane@example.com' });
    expect(res.body.account).not.toHaveProperty('password_hash');

    const [id, name, email, hash] = pool.query.mock.calls[0][1];
    expect(email).toBe('jane@example.com');
    expect(hash).not.toBe('secret1');
    expect(await bcrypt.compare('secret1', hash)).toBe(true);
    expect(res.body.account.id).toBe(id);
    expect(name).toBe('Jane Doe');
  });

  it('registers a pharmacy with no map pin yet', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...body, accountType: 'pharmacy', name: 'Halisi' });

    expect(res.status).toBe(201);
    expect(res.body.account).toMatchObject({ type: 'pharmacy', latitude: null, longitude: null });
  });

  it('returns 409 when the email is already registered', async () => {
    pool.query.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    const res = await request(app).post('/api/auth/register').send(body);

    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty('error');
  });

  it.each([
    ['unknown accountType', { accountType: 'admin' }],
    ['missing name', { name: '  ' }],
    ['bad email', { email: 'not-an-email' }],
    ['short password', { password: '123' }],
    ['password over 72 bytes', { password: 'x'.repeat(80) }],
  ])('returns 400 for %s', async (_label, override) => {
    const res = await request(app).post('/api/auth/register').send({ ...body, ...override });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/login', () => {
  it('logs in with the right password', async () => {
    const hash = await bcrypt.hash('secret1', 4);
    pool.query.mockResolvedValueOnce([[{ id: 'u1', name: 'Jane', email: 'jane@example.com', password_hash: hash }]]);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ accountType: 'user', email: 'JANE@example.com', password: 'secret1' });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.account).toMatchObject({ id: 'u1', type: 'user', name: 'Jane' });
    expect(pool.query.mock.calls[0][1]).toEqual(['jane@example.com']);
  });

  it('returns pharmacy coordinates on pharmacy login', async () => {
    const hash = await bcrypt.hash('secret1', 4);
    pool.query.mockResolvedValueOnce([
      [{ id: 'p1', name: 'Halisi', email: 'h@x.com', latitude: -1.29, longitude: 36.82, password_hash: hash }],
    ]);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ accountType: 'pharmacy', email: 'h@x.com', password: 'secret1' });

    expect(res.status).toBe(200);
    expect(res.body.account).toMatchObject({ type: 'pharmacy', latitude: -1.29, longitude: 36.82 });
  });

  it('gives the same 401 for a wrong password and an unknown email', async () => {
    const hash = await bcrypt.hash('secret1', 4);
    pool.query.mockResolvedValueOnce([[{ id: 'u1', name: 'J', email: 'j@x.com', password_hash: hash }]]);
    const wrongPw = await request(app)
      .post('/api/auth/login')
      .send({ accountType: 'user', email: 'j@x.com', password: 'nope' });

    pool.query.mockResolvedValueOnce([[]]);
    const noUser = await request(app)
      .post('/api/auth/login')
      .send({ accountType: 'user', email: 'ghost@x.com', password: 'nope' });

    expect(wrongPw.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(wrongPw.body).toEqual(noUser.body);
  });

  it('returns 400 when email or password is missing', async () => {
    const res = await request(app).post('/api/auth/login').send({ accountType: 'user', email: 'a@b.co' });
    expect(res.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
