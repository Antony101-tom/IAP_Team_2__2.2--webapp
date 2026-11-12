// v2: the new shape. Same data, different response.
// Only the pharmacy list changed: it is wrapped as { data, count } so paging can be added later
// without another breaking change. Everything else is the same code as v1 (see sharedRoutes.js).
const express = require('express');
const { fetchPharmacyList } = require('./routes/pharmacies');
const { sharedRoutes } = require('./sharedRoutes');

const router = express.Router();

// GET /api/v2/pharmacies?lat=&lng=&radius_km=&limit=   (same query parameters as v1)
router.get('/pharmacies', async (req, res) => {
  try {
    const { errors, rows } = await fetchPharmacyList(req.query);
    if (errors) return res.status(400).json({ message: 'Validation failed', errors }); // same error shape as v1
    res.json({ data: rows, count: rows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch pharmacies' });
  }
});

router.use(sharedRoutes());

module.exports = router;
