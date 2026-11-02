const { request, pharmacyToken, userToken } = require('./helpers');

jest.mock('../db', () => ({ pool: { query: jest.fn() } }));
const app = require('../index');

const reply = (status, body) => Promise.resolve({
  status,
  headers: { get: () => null },
  json: async () => { if (body === undefined) throw new Error('no json'); return body; },
});

beforeEach(() => {
  process.env.PARTNER_URL = 'https://partner.test/';
  process.env.PARTNER_API_KEY = 'partner-secret';
  global.fetch = jest.fn();
});

describe('/api/artisans proxy', () => {
  test('needs a pharmacy login', async () => {
    expect((await request(app).get('/api/artisans')).status).toBe(401);
    expect((await request(app).get('/api/artisans').set('Authorization', userToken())).status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('lists artisans, forwards only trade/county and the partner key', async () => {
    global.fetch.mockReturnValue(reply(200, [{ id: 1, name: 'A' }]));
    const res = await request(app).get('/api/artisans?trade=plumber&county=Nairobi&evil=1').set('Authorization', pharmacyToken());
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 1, name: 'A' }]);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://partner.test/artisans?trade=plumber&county=Nairobi');
    expect(opts.headers['X-API-Key']).toBe('partner-secret');
  });

  test('forwards booking body and method', async () => {
    global.fetch.mockReturnValue(reply(201, { id: 9 }));
    const body = { start: '2026-11-05T08:00:00Z', end: '2026-11-05T12:00:00Z' };
    const res = await request(app).post('/api/artisans/3/availability').set('Authorization', pharmacyToken()).send(body);
    expect(res.status).toBe(201);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://partner.test/artisans/3/availability');
    expect(JSON.parse(opts.body)).toEqual(body);
  });

  test('DELETE with 204', async () => {
    global.fetch.mockReturnValue(reply(204));
    const res = await request(app).delete('/api/artisans/3/reviews/7').set('Authorization', pharmacyToken());
    expect(res.status).toBe(204);
    expect(global.fetch.mock.calls[0][0]).toBe('https://partner.test/artisans/3/reviews/7');
  });

  test('rejects ids that could change the partner path', async () => {
    const res = await request(app).get('/api/artisans/..%2Fadmin').set('Authorization', pharmacyToken());
    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('passes the partner 404 through', async () => {
    global.fetch.mockReturnValue(reply(404, { error: 'Not found' }));
    const res = await request(app).get('/api/artisans/99999').set('Authorization', pharmacyToken());
    expect(res.status).toBe(404);
  });

  test('partner refusing our key is a 502, never a 401 (that would log the pharmacy out)', async () => {
    global.fetch.mockReturnValue(reply(401, { code: 'unauthorized' }));
    const res = await request(app).get('/api/artisans').set('Authorization', pharmacyToken());
    expect(res.status).toBe(502);
  });

  test('unreachable partner is a 502, not a crash', async () => {
    global.fetch.mockRejectedValue(Object.assign(new Error('boom'), { cause: { code: 'ECONNREFUSED' } }));
    const res = await request(app).get('/api/artisans').set('Authorization', pharmacyToken());
    expect(res.status).toBe(502);
  });

  test('503 when not configured', async () => {
    delete process.env.PARTNER_API_KEY;
    const res = await request(app).get('/api/artisans').set('Authorization', pharmacyToken());
    expect(res.status).toBe(503);
  });
});
