// v1: FROZEN. Do not change the shape of anything v1 returns.
// Mounted at /api/v1 AND at /api (so every old, unversioned URL keeps working for existing callers).
//
// Only GET /pharmacies (the list) is deprecated, because it is the only thing that changed in v2.
// Every other endpoint is identical in both versions, so it carries no deprecation headers.
const express = require('express');
const { deprecated } = require('./deprecate');
const { sharedRoutes } = require('./sharedRoutes');

// The sunset date is chosen in DEPRECATION_NOTICE.md. Change it here (or with V1_SUNSET) if the notice changes.
const SUNSET = process.env.V1_SUNSET || '2026-11-18';
const old = deprecated({ sunset: SUNSET, successor: '/api/v2/pharmacies' });

const router = express.Router();
router.get('/pharmacies', old); // adds the headers, then falls through to the unchanged v1 handler
router.use(sharedRoutes());

module.exports = router;
