const express = require('express');
const { pool } = require('../db');
const { requirePharmacy } = require('../middleware/auth');
const { parseGeoQuery, parseLimit, DISTANCE_SQL } = require('../geo');
const { readPharmacyDetails } = require('../pharmacyDetails');
const { cleanMedication } = require('../serialize');

const router = express.Router();
const PROFILE_SQL = 'SELECT id, name, email, phone, address, opening_hours, latitude, longitude FROM pharmacies WHERE id = ?';

// GET /api/pharmacies/me  -> the logged-in pharmacy's profile (incl. map pin, if set)
router.get('/me', requirePharmacy, async (req, res) => {
  try {
    const [rows] = await pool.query(
      PROFILE_SQL,
      [req.pharmacyId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Pharmacy not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch pharmacy profile' });
  }
});

// PATCH /api/pharmacies/me  { name?, phone?, address?, opening_hours?, latitude?, longitude? }
// Update your own details. Send only what you want to change (latitude and longitude together).
// phone, address, opening_hours and the map pin are shown publicly; the email never is.
router.patch('/me', requirePharmacy, async (req, res) => {
  const body = req.body || {};
  const sets = [];
  const params = [];
  const errors = [];

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) errors.push('name must be a non-empty string');
    else if (body.name.trim().length > 150) errors.push('name must be at most 150 characters');
    else {
      sets.push('name = ?');
      params.push(body.name.trim());
    }
  }

  const details = readPharmacyDetails(body);
  errors.push(...details.errors);
  for (const [field, value] of Object.entries(details.values)) {
    sets.push(`${field} = ?`); // field names come from a fixed list
    params.push(value);
  }

  if (errors.length > 0) return res.status(400).json({ message: 'Validation failed', errors });
  if (sets.length === 0) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: ['Send at least one of: name, phone, address, opening_hours, latitude and longitude'],
    });
  }

  try {
    const [result] = await pool.query(`UPDATE pharmacies SET ${sets.join(', ')} WHERE id = ?`, [...params, req.pharmacyId]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Pharmacy not found' });
    const [rows] = await pool.query(PROFILE_SQL, [req.pharmacyId]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update pharmacy' });
  }
});

// PUT /api/pharmacies/me/location  { latitude, longitude }  -> save the map pin
router.put('/me/location', requirePharmacy, async (req, res) => {
  const { latitude, longitude } = req.body || {};
  const errors = [];
  if (typeof latitude !== 'number' || !(latitude >= -90 && latitude <= 90)) {
    errors.push('latitude must be a number between -90 and 90');
  }
  if (typeof longitude !== 'number' || !(longitude >= -180 && longitude <= 180)) {
    errors.push('longitude must be a number between -180 and 180');
  }
  if (errors.length > 0) {
    return res.status(400).json({ message: 'Validation failed', errors });
  }

  try {
    const [result] = await pool.query(
      'UPDATE pharmacies SET latitude = ?, longitude = ? WHERE id = ?',
      [latitude, longitude, req.pharmacyId]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Pharmacy not found' });

    const [rows] = await pool.query(
      PROFILE_SQL,
      [req.pharmacyId]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save pharmacy location' });
  }
});

// ---------------------------------------------------------------
// PUBLIC, read-only. Other apps use these to build their own pharmacy map.
// They never return emails or anything about accounts: only name, map pin and stock.
// ---------------------------------------------------------------

// GET /api/pharmacies?lat=&lng=&radius_km=&limit=
// Pharmacies that have pinned their location. With lat/lng each one gets distance_km and
// the list is nearest first; add radius_km to keep only those within that distance.
router.get('/', async (req, res) => {
  const geo = parseGeoQuery(req.query);
  const { limit, error: limitError } = parseLimit(req.query);
  const errors = [...geo.errors, ...(limitError ? [limitError] : [])];
  if (errors.length > 0) return res.status(400).json({ message: 'Validation failed', errors });

  const inStock = `(SELECT COUNT(*) FROM medications m WHERE m.pharmacy_id = p.id AND m.quantity > 0)`;

  try {
    let sql;
    const params = [];
    if (geo.hasPosition) {
      sql = `SELECT p.id, p.name, p.phone, p.address, p.opening_hours, p.latitude, p.longitude, ${inStock} AS in_stock_count,
                    ${DISTANCE_SQL} AS distance_km
             FROM pharmacies p
             WHERE p.latitude IS NOT NULL AND p.longitude IS NOT NULL`;
      params.push(geo.lat, geo.lat, geo.lng);
      if (geo.radiusKm !== null) {
        sql += ' HAVING distance_km <= ?';
        params.push(geo.radiusKm);
      }
      sql += ' ORDER BY distance_km ASC, p.name ASC LIMIT ?';
    } else {
      sql = `SELECT p.id, p.name, p.phone, p.address, p.opening_hours, p.latitude, p.longitude, ${inStock} AS in_stock_count
             FROM pharmacies p
             WHERE p.latitude IS NOT NULL AND p.longitude IS NOT NULL
             ORDER BY p.name ASC LIMIT ?`;
    }
    params.push(limit);

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch pharmacies' });
  }
});

// GET /api/pharmacies/:id  -> one pharmacy and everything it stocks
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name, phone, address, opening_hours, latitude, longitude FROM pharmacies WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Pharmacy not found' });

    const [medications] = await pool.query(
      `SELECT id, name, form, category, quantity, unit, price, branch, pharmacy_id
       FROM medications WHERE pharmacy_id = ? ORDER BY name ASC`,
      [req.params.id]
    );
    res.json({ ...rows[0], medications: medications.map(cleanMedication) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch pharmacy' });
  }
});

module.exports = router;
