// Shared test setup: a signed-in pharmacy / patient token and a fake database pool.
process.env.JWT_SECRET = 'test-secret';
const { signToken } = require('../middleware/auth');

module.exports = {
  pharmacyToken: (id = 'uuid-1') => `Bearer ${signToken('pharmacy', id)}`,
  userToken: (id = 'user-1') => `Bearer ${signToken('user', id)}`,
};
