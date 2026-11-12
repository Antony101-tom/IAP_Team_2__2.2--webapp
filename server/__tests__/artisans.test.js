const { request, pharmacyToken, userToken } = require('./helpers');

jest.mock('../db', () => ({ pool: { query: jest.fn() } }));
const { pool } = require('../db');
const app = require('../index');

const reply = (status, body) => Promise.resolve({
  status,
  headers: { get: () => null },
  json: async () => { if (body === undefined) throw new Error('no json'); return body; },
});

let errorSpy;
beforeEach(() => {
  process.env.PARTNER_URL = 'https://partner.test/';
  process.env.PARTNER_API_KEY = 'partner-secret';
  process.env.PARTNER_RETRY_DELAY_MS = '0';
  global.fetch = jest.fn();
  pool.query.mockReset();
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => errorSpy.mockRestore());

const auth = (id) => ['Authorization', pharmacyToken(id)];
const WINDOW = { start: '2030-11-05T08:00:00Z', end: '2030-11-05T12:00:00Z' };

describe('/api/artisans: artisans and reviews', () => {
  test('needs a pharmacy login', async () => {
    expect((await request(app).get('/api/artisans')).status).toBe(401);
    expect((await request(app).get('/api/artisans').set('Authorization', userToken())).status).toBe(403);
    expect((await request(app).get('/api/artisans/bookings/mine')).status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('lists artisans, forwards only trade/county and the partner key', async () => {
    global.fetch.mockReturnValue(reply(200, [{ id: 1, name: 'A' }]));
    const res = await request(app).get('/api/artisans?trade=Plumbing&county=Nairobi&evil=1').set(...auth());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ data: [{ id: 1, name: 'A' }], stale: false });
    expect(Number.isNaN(Date.parse(res.body.asOf))).toBe(false);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://partner.test/artisans?trade=Plumbing&county=Nairobi');
    expect(opts.headers['X-API-Key']).toBe('partner-secret');
  });

  test('a review is sent with the pharmacy name as author (never one supplied by the browser)', async () => {
    pool.query.mockResolvedValueOnce([[{ ok: 1 }]]); // has a job marked done with this artisan
    pool.query.mockResolvedValueOnce([[{ name: 'Wellness Pharmacy' }]]);
    global.fetch.mockReturnValue(reply(201, { id: 5 }));
    const res = await request(app).post('/api/artisans/3/reviews').set(...auth('pharm-A'))
      .send({ rating: 5, comment: 'Great', author: 'Someone Else', extra: 'x' });
    expect(res.status).toBe(201);
    expect(pool.query.mock.calls[0][1]).toEqual(['pharm-A', '3']);
    expect(pool.query.mock.calls[1][1]).toEqual(['pharm-A']);
    expect(global.fetch.mock.calls[0][0]).toBe('https://partner.test/artisans/3/reviews');
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ rating: 5, comment: 'Great', author: 'Wellness Pharmacy' });
  });

  test('no review without a job marked done with that artisan (403, partner not called)', async () => {
    pool.query.mockResolvedValueOnce([[]]);
    const res = await request(app).post('/api/artisans/3/reviews').set(...auth()).send({ rating: 5, comment: 'x' });
    expect(res.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('partner 403 no_job is explained, not reported as a refused key', async () => {
    pool.query.mockResolvedValueOnce([[{ ok: 1 }]]);
    pool.query.mockResolvedValueOnce([[{ name: 'Wellness Pharmacy' }]]);
    global.fetch.mockReturnValue(reply(403, { code: 'no_job', message: 'No past job' }));
    const res = await request(app).post('/api/artisans/9/reviews').set(...auth()).send({ rating: 5, comment: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('no_job');
    expect(res.body.error).toMatch(/no past Meditrac job logged/);
  });

  test('any OTHER partner 403 is still treated as our credentials being refused (502)', async () => {
    global.fetch.mockReturnValue(reply(403, { code: 'forbidden', message: 'nope' }));
    expect((await request(app).get('/api/artisans').set(...auth())).status).toBe(502);
  });

  test('author is cut to the partner limit of 100 characters; an empty comment is left out', async () => {
    pool.query.mockResolvedValueOnce([[{ ok: 1 }]]);
    pool.query.mockResolvedValueOnce([[{ name: 'P'.repeat(150) }]]);
    global.fetch.mockReturnValue(reply(201, { id: 312 }));
    const res = await request(app).post('/api/artisans/3/reviews').set(...auth()).send({ rating: 4, comment: '   ' });
    expect(res.status).toBe(201);
    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.author).toHaveLength(100);
    expect(sent).toEqual({ rating: 4, author: 'P'.repeat(100) }); // rating is a number, no comment key
  });

  test('a review needs a rating from 1 to 5 (partner not called)', async () => {
    for (const rating of [undefined, 0, 6, 2.5, 'abc']) {
      const res = await request(app).post('/api/artisans/3/reviews').set(...auth()).send({ rating, comment: 'x' });
      expect(res.status).toBe(400);
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('editing and deleting a review', async () => {
    pool.query.mockResolvedValueOnce([[{ name: 'Wellness Pharmacy' }]]);
    global.fetch.mockReturnValue(reply(200, { id: 7 }));
    const patch = await request(app).patch('/api/artisans/3/reviews/7').set(...auth()).send({ comment: 'Better' });
    expect(patch.status).toBe(200);
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ comment: 'Better', author: 'Wellness Pharmacy' });
    expect((await request(app).patch('/api/artisans/3/reviews/7').set(...auth()).send({})).status).toBe(400);

    global.fetch.mockReturnValue(reply(204));
    expect((await request(app).delete('/api/artisans/3/reviews/7').set(...auth())).status).toBe(204);
  });

  test('rejects ids that could change the partner path', async () => {
    expect((await request(app).get('/api/artisans/..%2Fadmin').set(...auth())).status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('passes the partner 404 through', async () => {
    global.fetch.mockReturnValue(reply(404, { error: 'Not found' }));
    expect((await request(app).get('/api/artisans/99999').set(...auth())).status).toBe(404);
  });

  test('partner refusing our key is a 502, never a 401 (that would log the pharmacy out)', async () => {
    global.fetch.mockReturnValue(reply(401, { code: 'unauthorized' }));
    expect((await request(app).get('/api/artisans').set(...auth())).status).toBe(502);
  });

  test('unreachable partner is a 502; not configured is a 503', async () => {
    global.fetch.mockRejectedValue(Object.assign(new Error('boom'), { cause: { code: 'ECONNREFUSED' } }));
    expect((await request(app).get('/api/artisans').set(...auth())).status).toBe(502);
    delete process.env.PARTNER_API_KEY;
    expect((await request(app).get('/api/artisans').set(...auth())).status).toBe(503);
  });

  test('the partner availability endpoints are NOT exposed directly', async () => {
    expect((await request(app).patch('/api/artisans/3/availability/9').set(...auth()).send(WINDOW)).status).toBe(404);
    expect((await request(app).delete('/api/artisans/3/availability/9').set(...auth())).status).toBe(404);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('bookings', () => {
  test('POST books at the partner (only start/end sent), then records it for THIS pharmacy', async () => {
    global.fetch.mockReturnValue(reply(201, { id: 'blk-9' }));
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    const res = await request(app).post('/api/artisans/3/availability').set(...auth('pharm-A')).send({
      ...WINDOW, note: 'Fix leaking sink', artisan: { name: 'Achieng', trade: 'Plumbing', area: 'Embakasi', county: 'Nairobi' },
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'blk-9', recorded: true });

    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(Object.keys(sent).sort()).toEqual(['end', 'start']); // note/artisan are ours, not forwarded

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO artisan_bookings/);
    expect(params.slice(0, 7)).toEqual(['pharm-A', '3', 'blk-9', 'Achieng', 'Plumbing', 'Embakasi', 'Nairobi']);
    expect(params[9]).toBe('Fix leaking sink');
  });

  test('POST validates the window before calling the partner', async () => {
    const res = await request(app).post('/api/artisans/3/availability').set(...auth())
      .send({ start: WINDOW.end, end: WINDOW.start });
    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('POST does not record anything when the partner refuses (e.g. clash)', async () => {
    global.fetch.mockReturnValue(reply(409, { error: 'Already booked' }));
    const res = await request(app).post('/api/artisans/3/availability').set(...auth()).send(WINDOW);
    expect(res.status).toBe(409);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('POST still reports success (recorded:false) if only our database write fails', async () => {
    global.fetch.mockReturnValue(reply(201, { id: 'b1' }));
    pool.query.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).post('/api/artisans/3/availability').set(...auth()).send(WINDOW);
    expect(res.status).toBe(201);
    expect(res.body.recorded).toBe(false);
  });

  test('GET /bookings/mine only asks for the logged-in pharmacy', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 'bk1', artisan_name: 'Achieng' }]]);
    const res = await request(app).get('/api/artisans/bookings/mine').set(...auth('pharm-A'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'bk1', artisan_name: 'Achieng' }]);
    expect(pool.query.mock.calls[0][1]).toEqual(['pharm-A']);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("cannot cancel another pharmacy's booking (404, partner never called)", async () => {
    pool.query.mockResolvedValueOnce([[]]); // lookup scoped to pharmacy_id finds nothing
    const res = await request(app).delete('/api/artisans/bookings/bk1').set(...auth('pharm-B'));
    expect(res.status).toBe(404);
    expect(pool.query.mock.calls[0][1]).toEqual(['bk1', 'pharm-B']);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('DELETE frees the time at the partner, then deletes our record', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 'bk1', artisan_id: '3', block_id: 'blk-9', status: 'booked' }]]);
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    global.fetch.mockReturnValue(reply(204));
    const res = await request(app).delete('/api/artisans/bookings/bk1').set(...auth('pharm-A'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true, released: true });
    expect(global.fetch.mock.calls[0][0]).toBe('https://partner.test/artisans/3/availability/blk-9');
    expect(global.fetch.mock.calls[0][1].method).toBe('DELETE');
    expect(pool.query.mock.calls[1][0]).toMatch(/DELETE FROM artisan_bookings/);
  });

  test('DELETE keeps our record if the partner is unreachable, and treats partner 404 as already freed', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 'bk1', artisan_id: '3', block_id: 'blk-9', status: 'booked' }]]);
    global.fetch.mockRejectedValue(new Error('down'));
    expect((await request(app).delete('/api/artisans/bookings/bk1').set(...auth())).status).toBe(502);
    expect(pool.query).toHaveBeenCalledTimes(1); // only the lookup: nothing deleted

    pool.query.mockReset();
    pool.query.mockResolvedValueOnce([[{ id: 'bk1', artisan_id: '3', block_id: 'blk-9', status: 'booked' }]]);
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    global.fetch.mockReturnValue(reply(404, { error: 'gone' }));
    const res = await request(app).delete('/api/artisans/bookings/bk1').set(...auth());
    expect(res.status).toBe(200);
    expect(pool.query.mock.calls[1][0]).toMatch(/DELETE FROM artisan_bookings/);
  });

  test('PATCH reschedules at the partner, then updates our record', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 'bk1', artisan_id: '3', block_id: 'blk-9', status: 'booked' }]]);
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    pool.query.mockResolvedValueOnce([[{ id: 'bk1', start: WINDOW.start, end: WINDOW.end }]]);
    global.fetch.mockReturnValue(reply(200, { id: 'blk-9' }));
    const res = await request(app).patch('/api/artisans/bookings/bk1').set(...auth()).send(WINDOW);
    expect(res.status).toBe(200);
    expect(res.body.synced).toBe(true);
    expect(global.fetch.mock.calls[0][0]).toBe('https://partner.test/artisans/3/availability/blk-9');
    expect(global.fetch.mock.calls[0][1].method).toBe('PATCH');
  });

  test('PATCH leaves our record alone when the partner rejects the new time', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 'bk1', artisan_id: '3', block_id: 'blk-9', status: 'booked' }]]);
    global.fetch.mockReturnValue(reply(409, { error: 'Clash' }));
    const res = await request(app).patch('/api/artisans/bookings/bk1').set(...auth()).send(WINDOW);
    expect(res.status).toBe(409);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('mark done: allowed once the start has arrived, even before the end (early finish)', async () => {
    const started = new Date(Date.now() - 3600e3).toISOString();
    pool.query.mockResolvedValueOnce([[{ id: 'bk1', artisan_id: '3', block_id: 'b', status: 'booked', start_at: started }]]);
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    pool.query.mockResolvedValueOnce([[{ id: 'bk1', status: 'done' }]]);
    const res = await request(app).patch('/api/artisans/bookings/bk1/status').set(...auth('pharm-A')).send({ status: 'done' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('done');
    const [sql, params] = pool.query.mock.calls[1];
    expect(sql).toMatch(/UPDATE artisan_bookings SET status/);
    expect(params[0]).toBe('done');
    expect(params[2]).toBe('bk1');
    expect(params[3]).toBe('pharm-A');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('mark done: refused before the job has started', async () => {
    const later = new Date(Date.now() + 3600e3).toISOString();
    pool.query.mockResolvedValueOnce([[{ id: 'bk1', artisan_id: '3', block_id: 'b', status: 'booked', start_at: later }]]);
    const res = await request(app).patch('/api/artisans/bookings/bk1/status').set(...auth()).send({ status: 'done' });
    expect(res.status).toBe(409);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('mark done: only your own booking, and only known statuses', async () => {
    pool.query.mockResolvedValueOnce([[]]);
    expect((await request(app).patch('/api/artisans/bookings/bk1/status').set(...auth('pharm-B')).send({ status: 'done' })).status).toBe(404);
    pool.query.mockResolvedValueOnce([[{ id: 'bk1', artisan_id: '3', status: 'booked', start_at: new Date(0).toISOString() }]]);
    expect((await request(app).patch('/api/artisans/bookings/bk1/status').set(...auth()).send({ status: 'finished' })).status).toBe(400);
  });

  test('a job marked done can no longer be rescheduled or cancelled (until undone)', async () => {
    pool.query.mockResolvedValue([[{ id: 'bk1', artisan_id: '3', block_id: 'b', status: 'done', start_at: new Date(0).toISOString() }]]);
    expect((await request(app).delete('/api/artisans/bookings/bk1').set(...auth())).status).toBe(409);
    expect((await request(app).patch('/api/artisans/bookings/bk1').set(...auth()).send(WINDOW)).status).toBe(409);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('Week 11 resilience: retries and the saved-data fallback', () => {
  const html = (status) => () => Promise.resolve({ status, headers: { get: () => null }, json: async () => { throw new Error('html'); } });
  const withRetryAfter = (status, seconds) => Promise.resolve({
    status, headers: { get: (h) => (h.toLowerCase() === 'retry-after' ? String(seconds) : null) }, json: async () => ({ code: 'rate_limited' }),
  });
  let warnSpy;
  beforeEach(() => { warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => warnSpy.mockRestore());

  test('flaky partner (503, 503, then OK): the user sees the live list, no banner', async () => {
    global.fetch.mockImplementationOnce(html(503)).mockImplementationOnce(html(503)).mockReturnValueOnce(reply(200, [{ id: 1 }]));
    const res = await request(app).get('/api/artisans?county=Flaky').set(...auth());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ data: [{ id: 1 }], stale: false });
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  test('partner down + a saved copy: the saved list comes back marked stale with its time', async () => {
    global.fetch.mockReturnValueOnce(reply(200, [{ id: 1, name: 'Wanjiru' }]));
    const live = await request(app).get('/api/artisans?county=Nairobi').set(...auth());

    global.fetch.mockReset();
    global.fetch.mockImplementation(html(503));
    const res = await request(app).get('/api/artisans?county=Nairobi').set(...auth());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [{ id: 1, name: 'Wanjiru' }], stale: true, asOf: live.body.asOf });
    expect(global.fetch).toHaveBeenCalledTimes(3); // 1 try + 2 retries before giving up
  });

  test('the saved copy is kept per search: another search does not get it', async () => {
    global.fetch.mockReturnValueOnce(reply(200, [{ id: 1 }]));
    await request(app).get('/api/artisans?county=Nairobi').set(...auth());
    global.fetch.mockReset();
    global.fetch.mockImplementation(html(503));
    const res = await request(app).get('/api/artisans?county=Mombasa').set(...auth());
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/starting up or temporarily unavailable \(HTTP 503\)/);
  });

  test('partner down and nothing saved: a clear message, not "unexpected reply"', async () => {
    global.fetch.mockImplementation(html(503));
    const res = await request(app).get('/api/artisans?county=NothingSaved').set(...auth());
    expect(res.status).toBe(503);
    expect(res.body.error).not.toMatch(/unexpected reply/);
  });

  test('partner always answering HTTP 500: saved copy is served', async () => {
    global.fetch.mockReturnValueOnce(reply(200, [{ id: 1 }]));
    await request(app).get('/api/artisans/1').set(...auth());
    global.fetch.mockReset();
    global.fetch.mockReturnValue(reply(500, { message: 'Internal error' }));
    const res = await request(app).get('/api/artisans/1').set(...auth());
    expect(res.body).toMatchObject({ data: [{ id: 1 }], stale: true });
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  test('a 404 is never retried and never replaced by old data', async () => {
    global.fetch.mockReturnValueOnce(reply(200, { id: 7 }));
    await request(app).get('/api/artisans/7').set(...auth());
    global.fetch.mockReset();
    global.fetch.mockReturnValue(reply(404, { code: 'not_found', message: 'No artisan' }));
    const res = await request(app).get('/api/artisans/7').set(...auth());
    expect(res.status).toBe(404);
    expect(res.body.stale).toBeUndefined();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('429 is retried; if it persists with nothing saved the caller gets 429 and Retry-After', async () => {
    global.fetch.mockImplementation(() => withRetryAfter(429, 0));
    const res = await request(app).get('/api/artisans?county=Busy').set(...auth());
    expect(res.status).toBe(429);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  test('a wrong partner key is not retried (1 call) and says so; the key is never logged', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch.mockReturnValue(reply(401, { code: 'unauthorized' }));
    const res = await request(app).get('/api/artisans?county=BadKey').set(...auth());
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/refused this server's credentials/);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const logs = [...errSpy.mock.calls, ...warnSpy.mock.calls].flat().join('\n');
    expect(logs).not.toContain('partner-secret');
    errSpy.mockRestore();
  });

  test('writes are never retried and never fall back to saved data', async () => {
    global.fetch.mockImplementation(html(503));
    const book = await request(app).post('/api/artisans/3/availability').set(...auth())
      .send({ start: '2030-11-05T08:00:00Z', end: '2030-11-05T12:00:00Z' });
    expect(book.status).toBe(503);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    global.fetch.mockClear();
    pool.query.mockResolvedValueOnce([[{ id: 'bk1', artisan_id: '3', block_id: 'b', status: 'booked', start_at: new Date(0).toISOString() }]]);
    const cancel = await request(app).delete('/api/artisans/bookings/bk1').set(...auth());
    expect(cancel.status).toBe(503);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('reads use the short timeout (PARTNER_TIMEOUT_MS), writes the longer one', async () => {
    const spy = jest.spyOn(AbortSignal, 'timeout');
    process.env.PARTNER_TIMEOUT_MS = '1500';
    global.fetch.mockReturnValue(reply(200, []));
    await request(app).get('/api/artisans?county=T1').set(...auth());
    expect(spy).toHaveBeenLastCalledWith(1500);
    global.fetch.mockReturnValue(reply(201, { id: 'x' }));
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    await request(app).post('/api/artisans/3/availability').set(...auth()).send({ start: '2030-11-05T08:00:00Z', end: '2030-11-05T12:00:00Z' });
    expect(spy).toHaveBeenLastCalledWith(15000);
    spy.mockRestore();
    delete process.env.PARTNER_TIMEOUT_MS;
  });
});
