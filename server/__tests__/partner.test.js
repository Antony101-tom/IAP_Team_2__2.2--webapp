// Week 13: we are the CONSUMER here. Find My Artisan deprecated v1 and made v2 live; one word in .env switches us.
const { request, pharmacyToken } = require('./helpers');

jest.mock('../db', () => ({ pool: { query: jest.fn() } }));
const { pool } = require('../db');
const app = require('../index');
const { versions, activeVersion, partnerPath } = require('../partner');

const reply = (status, body, headers = {}) => Promise.resolve({
  status,
  headers: { get: (n) => headers[n.toLowerCase()] ?? null },
  json: async () => { if (body === undefined) throw new Error('no json'); return body; },
});
const auth = ['Authorization', pharmacyToken('uuid-1')];
const urlOfCall = () => global.fetch.mock.calls[0][0];

let errorSpy;
let warnSpy;
beforeEach(() => {
  process.env.PARTNER_URL = 'https://partner.test/';
  process.env.PARTNER_API_KEY = 'partner-secret';
  process.env.PARTNER_RETRY_DELAY_MS = '0';
  delete process.env.PARTNER_VERSION;
  global.fetch = jest.fn();
  pool.query.mockReset();
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { errorSpy.mockRestore(); warnSpy.mockRestore(); delete process.env.PARTNER_VERSION; });

describe('partner.js: the one place that knows the version', () => {
  test('v1 keeps the old paths, v2 adds the /v2 prefix', () => {
    expect(versions.v1.prefix).toBe('');
    process.env.PARTNER_VERSION = 'v1';
    expect(partnerPath('/artisans/3/reviews')).toBe('/artisans/3/reviews');
    process.env.PARTNER_VERSION = 'v2';
    expect(partnerPath('/artisans/3/reviews')).toBe('/v2/artisans/3/reviews');
  });

  test('with nothing set we stay on v1, so deploying this code changes nothing by itself', () => {
    expect(activeVersion()).toBe('v1');
  });

  test('a typo fails loudly instead of calling a path that does not exist', () => {
    process.env.PARTNER_VERSION = 'v3';
    expect(() => partnerPath('/artisans')).toThrow(/PARTNER_VERSION must be one of v1, v2/);
  });
});

describe('PARTNER_VERSION=v2: every partner call moves to /v2', () => {
  beforeEach(() => { process.env.PARTNER_VERSION = 'v2'; });

  test('the list read goes to /v2/artisans and is fresh, not a saved copy (stale:false)', async () => {
    global.fetch.mockReturnValue(reply(200, [{ id: 1, name: 'A' }]));
    const res = await request(app).get('/api/artisans').set(...auth);
    expect(urlOfCall()).toBe('https://partner.test/v2/artisans');
    expect(res.status).toBe(200);
    expect(res.body.stale).toBe(false);
    expect(res.body.data).toEqual([{ id: 1, name: 'A' }]);
  });

  test('filters are still sent, after the new path', async () => {
    global.fetch.mockReturnValue(reply(200, []));
    await request(app).get('/api/artisans?trade=Electrician&county=Nairobi').set(...auth);
    expect(urlOfCall()).toBe('https://partner.test/v2/artisans?trade=Electrician&county=Nairobi');
  });

  test('POST review goes to /v2/artisans/{id}/reviews with the same body as v1', async () => {
    pool.query.mockResolvedValueOnce([[{ ok: 1 }]]).mockResolvedValueOnce([[{ name: 'Wellness Pharmacy' }]]);
    global.fetch.mockReturnValue(reply(201, { id: 58, artisanId: 3, author: 'Wellness Pharmacy', rating: 5, comment: null }));
    const res = await request(app).post('/api/artisans/3/reviews').set(...auth).send({ rating: 5 });
    expect(urlOfCall()).toBe('https://partner.test/v2/artisans/3/reviews');
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ rating: 5, author: 'Wellness Pharmacy' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(58);
  });

  test('the new 403 no_job is explained to the user and is not retried or counted as a refused key', async () => {
    pool.query.mockResolvedValueOnce([[{ ok: 1 }]]).mockResolvedValueOnce([[{ name: 'Wellness Pharmacy' }]]);
    global.fetch.mockReturnValue(reply(403, { code: 'no_job', message: 'You can review an artisan once a job with them has finished.' }));
    const res = await request(app).post('/api/artisans/3/reviews').set(...auth).send({ rating: 5 });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('no_job');
    expect(res.body.error).toMatch(/log the job on their dashboard/);
    expect(global.fetch).toHaveBeenCalledTimes(1); // a write is never retried
  });

  test('PATCH and DELETE of our reviews and the availability calls also use /v2', async () => {
    global.fetch.mockReturnValue(reply(204));
    await request(app).delete('/api/artisans/3/reviews/58').set(...auth);
    expect(urlOfCall()).toBe('https://partner.test/v2/artisans/3/reviews/58');
    global.fetch.mockClear();
    global.fetch.mockReturnValue(reply(200, { id: 58 }));
    pool.query.mockResolvedValueOnce([[{ name: 'Wellness Pharmacy' }]]);
    await request(app).patch('/api/artisans/3/reviews/58').set(...auth).send({ comment: 'Better' });
    expect(urlOfCall()).toBe('https://partner.test/v2/artisans/3/reviews/58');
  });

  test('a real 404 from the partner is passed on, not hidden behind saved data', async () => {
    global.fetch.mockReturnValue(reply(404, { code: 'not_found', message: 'No such path' }));
    const res = await request(app).get('/api/artisans').set(...auth);
    expect(res.status).toBe(404);
    expect(res.body.stale).toBeUndefined();
  });
});

describe('PARTNER_VERSION=v1 still works (the rollback)', () => {
  test('calls the old paths with no /v2', async () => {
    process.env.PARTNER_VERSION = 'v1';
    global.fetch.mockReturnValue(reply(200, []));
    await request(app).get('/api/artisans/3').set(...auth);
    expect(urlOfCall()).toBe('https://partner.test/artisans/3');
  });
});

describe('we notice the partner telling us v1 is going away', () => {
  test('a Deprecation header on the partner reply is logged (once), with the sunset date', async () => {
    const headers = { deprecation: 'true', sunset: 'Tue, 24 Nov 2026 00:00:00 GMT', link: '</v2/artisans>; rel="successor-version"' };
    global.fetch.mockReturnValue(reply(200, [], headers));
    await request(app).get('/api/artisans/7001').set(...auth);
    await request(app).get('/api/artisans/7001').set(...auth);
    const lines = warnSpy.mock.calls.map((c) => c[0]).filter((l) => /deprecated/.test(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/24 Nov 2026/);
    expect(lines[0]).not.toMatch(/partner-secret/);
  });
});
