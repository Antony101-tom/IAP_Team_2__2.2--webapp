// Shared test setup: a signed-in pharmacy / patient token, an API key, and a fake database pool.
process.env.JWT_SECRET = 'test-secret';

// Every endpoint needs an API key (Week 9), so the test app is given one. These are test-only values.
const TEST_API_KEY = 'mtk_test_key_for_jest_only';
process.env.API_KEYS = TEST_API_KEY;
// A high ceiling so ordinary tests never hit the rate limit; api-key.test.js lowers it on purpose.
process.env.RATE_LIMIT_PER_MINUTE = '100000';

const supertest = require('supertest');
const { signToken } = require('../middleware/auth');

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

// supertest, but every request carries the test API key unless the test sets its own X-API-Key
// (a later .set('X-API-Key', ...) replaces this default). Use request(app) exactly like supertest.
function request(app) {
  const agent = supertest(app);
  for (const method of METHODS) {
    const original = agent[method].bind(agent);
    agent[method] = (...args) => original(...args).set('X-API-Key', TEST_API_KEY);
  }
  return agent;
}

module.exports = {
  TEST_API_KEY,
  request,
  rawRequest: supertest, // no key attached: for tests that check what happens WITHOUT one
  pharmacyToken: (id = 'uuid-1') => `Bearer ${signToken('pharmacy', id)}`,
  userToken: (id = 'user-1') => `Bearer ${signToken('user', id)}`,
};
