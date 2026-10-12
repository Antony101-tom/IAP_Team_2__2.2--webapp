jest.mock('../db', () => ({ pool: { query: jest.fn() } }));

const { pool } = require('../db');
const { checkDatabase } = require('../dbCheck');

const columnsFor = (spec) => spec.flatMap(([t, cols]) => cols.map((c) => ({ t, c })));
const FULL = columnsFor([
  ['users', ['id', 'name', 'email', 'password_hash']],
  ['pharmacies', ['id', 'name', 'email', 'password_hash', 'phone', 'address', 'opening_hours', 'latitude', 'longitude']],
  ['medications', ['id', 'name', 'sku', 'pharmacy_id']],
  ['tracked_medications', ['user_id', 'medication_id']],
]);

let logSpy;
let errSpy;
const printed = () => errSpy.mock.calls.map((c) => c.join(' ')).join('\n');

beforeEach(() => {
  pool.query.mockReset();
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  logSpy.mockRestore();
  errSpy.mockRestore();
});

describe('startup database check', () => {
  it('says the database is ready when every table and column is there', async () => {
    pool.query.mockResolvedValueOnce([[{ 1: 1 }]]).mockResolvedValueOnce([FULL]);
    expect(await checkDatabase()).toBe(true);
    expect(logSpy.mock.calls.flat().join(' ')).toMatch(/is ready/);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['ECONNREFUSED', /MySQL is not running/],
    ['ER_ACCESS_DENIED_ERROR', /DB_PASSWORD/],
    ['ER_BAD_DB_ERROR', /does not exist/],
    ['ENOTFOUND', /DB_HOST/],
  ])('explains a %s connection problem in plain words', async (code, hint) => {
    pool.query.mockRejectedValueOnce(Object.assign(new Error('boom'), { code }));
    expect(await checkDatabase()).toBe(false);
    expect(printed()).toMatch(hint);
  });

  it('points at schema.sql when a table is missing', async () => {
    pool.query.mockResolvedValueOnce([[{ 1: 1 }]]).mockResolvedValueOnce([FULL.filter((r) => r.t !== 'users')]);
    expect(await checkDatabase()).toBe(false);
    expect(printed()).toMatch(/table "users" is missing.*schema\.sql/);
  });

  it('points at the migration when columns added later are missing', async () => {
    const old = FULL.filter((r) => !['phone', 'address', 'opening_hours', 'sku'].includes(r.c));
    pool.query.mockResolvedValueOnce([[{ 1: 1 }]]).mockResolvedValueOnce([old]);
    expect(await checkDatabase()).toBe(false);
    expect(printed()).toMatch(/"pharmacies" has no "phone", "address", "opening_hours" column.*migration_partner_api\.sql/);
    expect(printed()).toMatch(/"medications" has no "sku" column/);
  });
});

describe('connection errors with an empty message', () => {
  // What Node produces when MySQL is down and "localhost" resolves to both ::1 and 127.0.0.1
  const refused = () => {
    const err = new AggregateError(
      [
        Object.assign(new Error('connect ECONNREFUSED ::1:3306'), { code: 'ECONNREFUSED' }),
        Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3306'), { code: 'ECONNREFUSED' }),
      ],
      ''
    );
    err.code = 'ECONNREFUSED';
    return err;
  };

  it('prints the real reasons and the "MySQL is not running" fix instead of a blank', async () => {
    const err = refused();
    expect(err.message).toBe(''); // this is why the terminal used to show nothing
    pool.query.mockRejectedValueOnce(err);

    expect(await checkDatabase()).toBe(false);
    expect(printed()).toMatch(/connect ECONNREFUSED ::1:3306/);
    expect(printed()).toMatch(/connect ECONNREFUSED 127\.0\.0\.1:3306/);
    expect(printed()).toMatch(/MySQL is not running/);
  });

  it('finds the cause even when the outer error has no code', async () => {
    const err = refused();
    delete err.code;
    pool.query.mockRejectedValueOnce(err);
    await checkDatabase();
    expect(printed()).toMatch(/MySQL is not running/);
  });
});

describe('describeError', () => {
  const { describeError } = require('../errors');

  it('uses the message when there is one', () => {
    expect(describeError(Object.assign(new Error('Access denied'), { code: 'ER_ACCESS_DENIED_ERROR' }))).toBe('ER_ACCESS_DENIED_ERROR: Access denied');
  });
  it('never returns an empty string', () => {
    expect(describeError(new AggregateError([], ''))).not.toBe('');
    expect(describeError(undefined)).toBe('unknown error');
  });
});
