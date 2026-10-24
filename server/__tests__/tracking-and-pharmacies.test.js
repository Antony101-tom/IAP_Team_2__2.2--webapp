const request = require('supertest');
const { pharmacyToken, userToken } = require('./helpers');

jest.mock('../db', () => ({ pool: { query: jest.fn() } }));

const { pool } = require('../db');
const app = require('../index');

const MED_ID = 'c3000000-0000-4000-8000-000000000001';

let errorSpy;
beforeEach(() => {
  pool.query.mockReset();
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => errorSpy.mockRestore());

describe('/api/tracking', () => {
  it('GET requires a patient login (a pharmacy token is rejected)', async () => {
    expect((await request(app).get('/api/tracking')).status).toBe(401);
    expect((await request(app).get('/api/tracking').set('Authorization', pharmacyToken())).status).toBe(403);
  });

  it("GET returns the patient's tracked medication ids", async () => {
    pool.query.mockResolvedValueOnce([[{ medication_id: MED_ID }]]);
    const res = await request(app).get('/api/tracking').set('Authorization', userToken('user-1'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual([MED_ID]);
    expect(pool.query.mock.calls[0][1]).toEqual(['user-1']);
  });

  it('POST tracks a medication (201)', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    const res = await request(app)
      .post('/api/tracking')
      .set('Authorization', userToken('user-1'))
      .send({ medication_id: MED_ID });

    expect(res.status).toBe(201);
    expect(pool.query.mock.calls[0][1]).toEqual(['user-1', MED_ID]);
  });

  it('POST returns 400 for a non-uuid medication_id', async () => {
    const res = await request(app)
      .post('/api/tracking')
      .set('Authorization', userToken())
      .send({ medication_id: 'abc' });

    expect(res.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('POST returns 404 when the medication does not exist', async () => {
    pool.query.mockRejectedValueOnce(Object.assign(new Error('fk'), { code: '23503' }));
    const res = await request(app)
      .post('/api/tracking')
      .set('Authorization', userToken())
      .send({ medication_id: MED_ID });

    expect(res.status).toBe(404);
  });

  it('DELETE stops tracking (204), scoped to the logged-in patient', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    const res = await request(app).delete(`/api/tracking/${MED_ID}`).set('Authorization', userToken('user-1'));

    expect(res.status).toBe(204);
    expect(pool.query.mock.calls[0][1]).toEqual(['user-1', MED_ID]);
  });
});

describe('/api/pharmacies', () => {
  it('GET /me returns the logged-in pharmacy profile', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 'uuid-1', name: 'Halisi', email: 'h@x.com', latitude: null, longitude: null }]]);
    const res = await request(app).get('/api/pharmacies/me').set('Authorization', pharmacyToken('uuid-1'));

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Halisi');
  });

  it('PUT /me/location saves the map pin', async () => {
    pool.query
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ id: 'uuid-1', name: 'Halisi', email: 'h@x.com', latitude: -1.28, longitude: 36.82 }]]);
    const res = await request(app)
      .put('/api/pharmacies/me/location')
      .set('Authorization', pharmacyToken('uuid-1'))
      .send({ latitude: -1.28, longitude: 36.82 });

    expect(res.status).toBe(200);
    expect(res.body.latitude).toBe(-1.28);
    expect(pool.query.mock.calls[0][1]).toEqual([-1.28, 36.82, 'uuid-1']);
  });

  it('PUT /me/location rejects out-of-range or non-numeric coordinates', async () => {
    const res = await request(app)
      .put('/api/pharmacies/me/location')
      .set('Authorization', pharmacyToken())
      .send({ latitude: 200, longitude: 'east' });

    expect(res.status).toBe(400);
    expect(res.body.errors).toHaveLength(2);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('requires a pharmacy login', async () => {
    expect((await request(app).put('/api/pharmacies/me/location').send({})).status).toBe(401);
    expect((await request(app).get('/api/pharmacies/me').set('Authorization', userToken())).status).toBe(403);
  });
});
