jest.mock('../db', () => ({ pool: { query: jest.fn() } }));

const { pool } = require('../db');
const { checkDatabase } = require('../dbCheck');
const { describeError } = require('../errors');

const columnsFor = (spec) => spec.flatMap(([t, cols]) => cols.map((c) => ({ t, c })));
const FULL = columnsFor([
  ['users', ['id', 'name', 'email', 'password_hash']],
  ['pharmacies', ['id', 'name', 'email', 'password_hash', 'phone', 'address', 'opening_hours', 'latitude', 'longitude']],
  ['medications', ['id', 'name', 'form', 'category', 'quantity', 'unit', 'price', 'branch', 'sku', 'pharmacy_id']],
  ['tracked_medications', ['user_id', 'medication_id']],
]);

let logSpy;
let errSpy;
let savedUrl;
const printed = () => errSpy.mock.calls.map((c) => c.join(' ')).join('\n');

beforeEach(() => {
  pool.query.mockReset();
  savedUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://postgres.abc:pw@aws-0-eu.pooler.supabase.com:5432/postgres';
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  logSpy.mockRestore();
  errSpy.mockRestore();
  if (savedUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedUrl;
});

describe('startup database check', () => {
  it('says the tables are ready when every table and column is there', async () => {
    pool.query.mockResolvedValueOnce([[{ 1: 1 }]]).mockResolvedValueOnce([FULL]);
    expect(await checkDatabase()).toBe(true);
    expect(logSpy.mock.calls.flat().join(' ')).toMatch(/Connected\. The tables are ready/);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['28P01', 'password authentication failed', /Wrong database password.*Reset database password/],
    ['ENOTFOUND', 'getaddrinfo ENOTFOUND db.example', /address in DATABASE_URL was not found/],
    ['ECONNREFUSED', 'connect ECONNREFUSED', /not accepting connections/],
    ['ETIMEDOUT', 'timeout', /did not answer within 10 seconds/],
    ['3D000', 'database "x" does not exist', /database name in DATABASE_URL does not exist/],
  ])('explains a %s connection problem in plain words', async (code, message, hint) => {
    pool.query.mockRejectedValueOnce(Object.assign(new Error(message), { code }));
    expect(await checkDatabase()).toBe(false);
    expect(printed()).toMatch(hint);
  });

  it("recognises Supabase's 'Tenant or user not found' (wrong pooler username)", async () => {
    pool.query.mockRejectedValueOnce(new Error('Tenant or user not found'));
    await checkDatabase();
    expect(printed()).toMatch(/username in DATABASE_URL is wrong.*postgres\.YOUR-PROJECT-REF/);
  });

  it("explains pg's 'connection timeout' (no error code) with the exact test command for your host and port", async () => {
    pool.query.mockRejectedValueOnce(new Error('Connection terminated due to connection timeout'));
    expect(await checkDatabase()).toBe(false);
    expect(printed()).toMatch(/Connection terminated due to connection timeout/);
    expect(printed()).toMatch(/blocks port 5432/);
    expect(printed()).toMatch(/Test-NetConnection aws-0-eu\.pooler\.supabase\.com -Port 5432/);
    expect(printed()).toMatch(/try port 6543/);
  });

  it('suggests port 5432 instead when the URL already uses the transaction pooler port 6543', async () => {
    process.env.DATABASE_URL = 'postgresql://postgres.abc:pw@aws-0-eu.pooler.supabase.com:6543/postgres';
    pool.query.mockRejectedValueOnce(new Error('Connection terminated due to connection timeout'));
    await checkDatabase();
    expect(printed()).toMatch(/blocks port 6543/);
    expect(printed()).toMatch(/try port 5432/);
  });

  it('tells you when DATABASE_URL is not set at all', async () => {
    delete process.env.DATABASE_URL;
    pool.query.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'ECONNREFUSED' }));
    await checkDatabase();
    expect(printed()).toMatch(/DATABASE_URL is not set/);
  });

  it('points at schema.sql in the SQL Editor when a table is missing', async () => {
    pool.query.mockResolvedValueOnce([[{ 1: 1 }]]).mockResolvedValueOnce([FULL.filter((r) => r.t !== 'users')]);
    expect(await checkDatabase()).toBe(false);
    expect(printed()).toMatch(/table "users" is missing.*schema\.sql.*SQL Editor/);
  });

  it('names the missing columns when a table comes from an older schema.sql', async () => {
    const old = FULL.filter((r) => !['phone', 'address', 'opening_hours', 'sku'].includes(r.c));
    pool.query.mockResolvedValueOnce([[{ 1: 1 }]]).mockResolvedValueOnce([old]);
    expect(await checkDatabase()).toBe(false);
    expect(printed()).toMatch(/"pharmacies" has no "phone", "address", "opening_hours" column/);
    expect(printed()).toMatch(/"medications" has no "sku" column/);
  });
});

describe('connection errors with an empty message', () => {
  // What Node produces when the database is unreachable and "localhost" resolves to both ::1 and 127.0.0.1
  const refused = () => {
    const err = new AggregateError(
      [
        Object.assign(new Error('connect ECONNREFUSED ::1:5432'), { code: 'ECONNREFUSED' }),
        Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' }),
      ],
      ''
    );
    err.code = 'ECONNREFUSED';
    return err;
  };

  it('prints the real reasons instead of a blank', async () => {
    const err = refused();
    expect(err.message).toBe(''); // this is why the terminal used to show nothing
    pool.query.mockRejectedValueOnce(err);

    expect(await checkDatabase()).toBe(false);
    expect(printed()).toMatch(/connect ECONNREFUSED ::1:5432/);
    expect(printed()).toMatch(/connect ECONNREFUSED 127\.0\.0\.1:5432/);
    expect(printed()).toMatch(/not accepting connections/);
  });

  it('finds the cause even when the outer error has no code', async () => {
    const err = refused();
    delete err.code;
    pool.query.mockRejectedValueOnce(err);
    await checkDatabase();
    expect(printed()).toMatch(/not accepting connections/);
  });
});

describe('describeError', () => {
  it('uses the message when there is one', () => {
    expect(describeError(Object.assign(new Error('bad password'), { code: '28P01' }))).toBe('28P01: bad password');
  });
  it('never returns an empty string', () => {
    expect(describeError(new AggregateError([], ''))).not.toBe('');
    expect(describeError(undefined)).toBe('unknown error');
  });
});
