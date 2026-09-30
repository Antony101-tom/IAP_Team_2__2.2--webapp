const request = require('supertest');
const BASE = process.env.PARTNER_API_URL || 'http://localhost:5001';
const api = request(BASE);

const FAKE_ID = 999999;

describe('GET /artisans', () => {
  it('returns a list of artisans (happy path)', async () => {
    const res = await api.get('/artisans');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    if (res.body.length > 0) {
      const a = res.body[0];
      expect(a).toHaveProperty('id');
      expect(typeof a.name).toBe('string');
      expect(typeof a.trade).toBe('string');
      expect(typeof a.area).toBe('string');
      expect(typeof a.county).toBe('string');
      expect(typeof a.verified).toBe('boolean');
      expect(Array.isArray(a.busy)).toBe(true);
      // list view should not expose phone
      expect(a).not.toHaveProperty('phone');
    }
  });

  it('filters by trade', async () => {
    const res = await api.get('/artisans').query({ trade: 'plumbing' });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    res.body.forEach((a) => expect(a.trade).toBe('plumbing'));
  });

  it('filters by county', async () => {
    const res = await api.get('/artisans').query({ county: 'Nairobi' });
    expect(res.status).toBe(200);
    res.body.forEach((a) => expect(a.county).toBe('Nairobi'));
  });

  it('returns an empty array for a trade with no matches (edge case)', async () => {
    const res = await api.get('/artisans').query({ trade: 'zzzznonexistenttrade' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns 400 for an invalid county value', async () => {
    const res = await api.get('/artisans').query({ county: 'NotARealCountyXYZ123' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code');
    expect(res.body).toHaveProperty('message');
  });
});

describe('GET /artisans/:id', () => {
  it('returns a full profile including phone (happy path)', async () => {
    const res = await api.get('/artisans/1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', 1);
    expect(typeof res.body.name).toBe('string');
    expect(typeof res.body.phone).toBe('string');
    expect(Array.isArray(res.body.busy)).toBe(true);
  });

  it('returns 404 for an id that does not exist', async () => {
    const res = await api.get(`/artisans/${FAKE_ID}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
    expect(res.body).toHaveProperty('message');
  });
});

describe('POST /artisans/:id/reviews', () => {
  const validReview = () => ({
    author: 'Meditrac — Test branch',
    rating: 5,
    comment: 'Great work, on time.',
  });

  it('creates a review (happy path)', async () => {
    const res = await api.post('/artisans/1/reviews').send(validReview());
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.artisanId).toBe(1);
    expect(res.body.author).toBe(validReview().author);
    expect(res.body.rating).toBe(5);
    expect(res.body).toHaveProperty('createdAt');
  });

  it('rejects a missing author', async () => {
    const { author, ...bad } = validReview();
    const res = await api.post('/artisans/1/reviews').send(bad);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_body');
  });

  it('rejects a rating out of range', async () => {
    const res = await api.post('/artisans/1/reviews').send({ ...validReview(), rating: 6 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_body');
  });

  it('rejects a non-integer rating', async () => {
    const res = await api.post('/artisans/1/reviews').send({ ...validReview(), rating: 4.5 });
    expect(res.status).toBe(400);
  });

  it('accepts a null comment (edge case)', async () => {
    const res = await api.post('/artisans/1/reviews').send({ ...validReview(), comment: null });
    expect(res.status).toBe(201);
    expect(res.body.comment).toBeNull();
  });

  it('returns 404 for an artisan that does not exist', async () => {
    const res = await api.post(`/artisans/${FAKE_ID}/reviews`).send(validReview());
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });
});

describe('POST /artisans/:id/availability', () => {
  const validBlock = () => ({
    start: '2026-11-01T09:00:00Z',
    end: '2026-11-01T12:00:00Z',
  });

  it('creates an availability block (happy path)', async () => {
    const res = await api.post('/artisans/1/availability').send(validBlock());
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.artisanId).toBe(1);
    expect(res.body.start).toBe(validBlock().start);
    expect(res.body.end).toBe(validBlock().end);
  });

  it('rejects end before start', async () => {
    const res = await api.post('/artisans/1/availability').send({
      start: '2026-11-01T12:00:00Z',
      end: '2026-11-01T09:00:00Z',
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_body');
  });

  it('returns 404 for an artisan that does not exist', async () => {
    const res = await api.post(`/artisans/${FAKE_ID}/availability`).send(validBlock());
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });
});

describe('PATCH /artisans/:id/availability/:blockId', () => {
  let createdBlockId;

  beforeAll(async () => {
    const res = await api.post('/artisans/1/availability').send({
      start: '2026-11-05T09:00:00Z',
      end: '2026-11-05T11:00:00Z',
    });
    createdBlockId = res.body.id;
  });

  it('updates the end time (happy path)', async () => {
    const res = await api
      .patch(`/artisans/1/availability/${createdBlockId}`)
      .send({ end: '2026-11-05T13:00:00Z' });
    expect(res.status).toBe(200);
    expect(res.body.end).toBe('2026-11-05T13:00:00Z');
  });

  it('rejects end before start after update', async () => {
    const res = await api
      .patch(`/artisans/1/availability/${createdBlockId}`)
      .send({ start: '2026-11-05T15:00:00Z', end: '2026-11-05T09:00:00Z' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for a block that does not exist', async () => {
    const res = await api
      .patch(`/artisans/1/availability/${FAKE_ID}`)
      .send({ end: '2026-11-05T13:00:00Z' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });
});

describe('DELETE /artisans/:id/availability/:blockId', () => {
  it('deletes a block (happy path)', async () => {
    const created = await api.post('/artisans/1/availability').send({
      start: '2026-11-10T09:00:00Z',
      end: '2026-11-10T11:00:00Z',
    });
    const res = await api.delete(`/artisans/1/availability/${created.body.id}`);
    expect(res.status).toBe(204);

    const again = await api.delete(`/artisans/1/availability/${created.body.id}`);
    expect(again.status).toBe(404);
  });

  it('returns 404 for a block that does not exist', async () => {
    const res = await api.delete(`/artisans/1/availability/${FAKE_ID}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });
});