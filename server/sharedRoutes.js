// Every route group, mounted on a router. v1 and v2 both use this, so an endpoint that did NOT change
// is literally the same code in both versions and cannot drift apart.
const express = require('express');

function sharedRoutes() {
  const router = express.Router();
  router.use('/auth', require('./routes/auth'));
  router.use('/medications', require('./routes/medications'));
  router.use('/pharmacies', require('./routes/pharmacies'));
  router.use('/tracking', require('./routes/tracking'));
  router.use('/artisans', require('./routes/artisans'));
  return router;
}

module.exports = { sharedRoutes };
