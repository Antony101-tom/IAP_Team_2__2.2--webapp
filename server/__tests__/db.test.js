// The database layer: turns ? into $1.. and gives the routes the [rows] / [{ affectedRows }] shapes
const mockQuery = jest.fn();
const mockClient = { query: jest.fn(), release: jest.fn() };

jest.mock('pg', () => {
  const setTypeParser = jest.fn();
  class Pool {
    constructor(options) {
      Pool.options = options;
    }
    on() {}
    query(...args) {
      return mockQuery(...args);
    }
    connect() {
      return Promise.resolve(mockClient);
    }
  }
  return { Pool, types: { setTypeParser } };
});

describe('db.js', () => {
  let db;
  let pg;
  beforeAll(() => {
    process.env.DATABASE_URL = 'postgresql://postgres.abc:pw@aws-0-eu.pooler.supabase.com:5432/postgres';
    pg = require('pg');
    db = require('../db');
  });
  beforeEach(() => {
    mockQuery.mockReset();
    mockClient.query.mockReset();
    mockClient.release.mockReset();
  });

  it('numbers each ? as $1, $2, ...', () => {
    expect(db.toPostgres('SELECT * FROM t WHERE a = ? AND b = ? LIMIT ?')).toBe('SELECT * FROM t WHERE a = $1 AND b = $2 LIMIT $3');
    expect(db.toPostgres('SELECT 1')).toBe('SELECT 1');
  });

  it('returns [rows] for a SELECT', async () => {
    mockQuery.mockResolvedValueOnce({ command: 'SELECT', rows: [{ id: 1 }], rowCount: 1 });
    expect(await db.pool.query('SELECT * FROM t WHERE id = ?', [1])).toEqual([[{ id: 1 }]]);
    expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM t WHERE id = $1', [1]);
  });

  it.each(['UPDATE', 'DELETE', 'INSERT'])('returns [{ affectedRows }] for %s', async (command) => {
    mockQuery.mockResolvedValueOnce({ command, rows: [], rowCount: 3 });
    expect(await db.pool.query('x', [])).toEqual([{ affectedRows: 3 }]);
  });

  it('a transaction uses ONE connection and releases it', async () => {
    mockClient.query.mockResolvedValue({ command: 'SELECT', rows: [], rowCount: 0 });
    const conn = await db.pool.getConnection();
    await conn.beginTransaction();
    await conn.query('SELECT ?', [1]);
    await conn.commit();
    conn.release();
    expect(mockClient.query.mock.calls.map((c) => c[0])).toEqual(['BEGIN', 'SELECT $1', 'COMMIT']);
    expect(mockClient.release).toHaveBeenCalledTimes(1);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rollback is available', async () => {
    mockClient.query.mockResolvedValue({ command: 'ROLLBACK', rows: [], rowCount: null });
    const conn = await db.pool.getConnection();
    await conn.rollback();
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('reads prices and counts as numbers, not strings', () => {
    const calls = pg.types.setTypeParser.mock.calls;
    const numeric = calls.find(([oid]) => oid === 1700)[1];
    const bigint = calls.find(([oid]) => oid === 20)[1];
    expect(numeric('650.00')).toBe(650);
    expect(numeric('50.50')).toBe(50.5);
    expect(bigint('42')).toBe(42);
  });

  it('turns SSL on for a Supabase address', () => {
    expect(pg.Pool.options.ssl).toEqual({ rejectUnauthorized: false });
  });
});

describe('db.js SSL choice', () => {
  const load = (env) => {
    jest.resetModules();
    const saved = { ...process.env };
    Object.assign(process.env, env);
    jest.doMock('pg', () => {
      class Pool {
        constructor(o) {
          Pool.options = o;
        }
        on() {}
      }
      return { Pool, types: { setTypeParser: () => {} } };
    });
    require('../db');
    const { Pool } = require('pg');
    process.env = saved;
    return Pool.options.ssl;
  };

  it('is off for a database on this computer', () => {
    expect(load({ DATABASE_URL: 'postgresql://u:p@localhost:5432/meditrac' })).toBe(false);
    expect(load({ DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/meditrac' })).toBe(false);
  });
  it('can be forced either way with DB_SSL', () => {
    expect(load({ DATABASE_URL: 'postgresql://u:p@localhost/x', DB_SSL: 'true' })).toEqual({ rejectUnauthorized: false });
    expect(load({ DATABASE_URL: 'postgresql://u:p@db.example.com/x', DB_SSL: 'false' })).toBe(false);
  });
});

describe('db.js IPv4 preference', () => {
  it('asks Node to try IPv4 addresses first (a broken IPv6 route otherwise causes connection timeouts)', () => {
    jest.resetModules();
    const dns = require('dns');
    const spy = jest.spyOn(dns, 'setDefaultResultOrder').mockImplementation(() => {});
    jest.doMock('pg', () => ({
      Pool: class {
        on() {}
      },
      types: { setTypeParser: () => {} },
    }));
    require('../db');
    expect(spy).toHaveBeenCalledWith('ipv4first');
    spy.mockRestore();
  });
});
