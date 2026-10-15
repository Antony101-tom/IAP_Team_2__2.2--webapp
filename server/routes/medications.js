const express = require('express');
const { randomUUID } = require('crypto');
const { pool } = require('../db');
const { requirePharmacy, optionalPharmacy } = require('../middleware/auth');
const { cleanMedication } = require('../serialize');
const { isUniqueViolation, isForeignKeyViolation } = require('../dbErrors');
const { parseGeoQuery, parseLimit, DISTANCE_SQL } = require('../geo');

const router = express.Router();

// The fields every endpoint returns for a medication (see openapi.yaml → Medication)
const MED_COLUMNS = 'id, name, form, category, quantity, unit, price, branch, sku, pharmacy_id';
const PUBLIC_MED_COLUMNS = 'id, name, form, category, quantity, unit, price, branch, pharmacy_id';

async function findMedication(id) {
  const [rows] = await pool.query(`SELECT ${MED_COLUMNS} FROM medications WHERE id = ?`, [id]);
  return rows[0] ? cleanMedication(rows[0]) : null;
}

// GET all medications across all pharmacies.
// Each row also carries the owning pharmacy's name and map pin (extra fields, see
// CONTRACT_DEVIATIONS.md) so the patient dashboard can group, map and sort by distance
// from one request per page load.
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT m.id, m.name, m.form, m.category, m.quantity, m.unit, m.price, m.branch, m.pharmacy_id,
              p.name AS pharmacy, p.latitude, p.longitude
       FROM medications m
       JOIN pharmacies p ON p.id = m.pharmacy_id
       ORDER BY m.name ASC`
    );
    res.json(rows.map(cleanMedication));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch medications' });
  }
});

// GET /api/medications/search?name=&lat=&lng=&radius_km=&in_stock=&limit=   (public)
// "Where can I find this medicine?" Matches the medicine's name or category. Every result
// carries its pharmacy's name and map pin. With lat/lng each also gets distance_km and the
// list is nearest first; radius_km keeps only pharmacies within that distance.
router.get('/search', async (req, res) => {
  const name = typeof req.query.name === 'string' ? req.query.name.trim() : '';
  const geo = parseGeoQuery(req.query);
  const { limit, error: limitError } = parseLimit(req.query);
  const errors = [...geo.errors, ...(limitError ? [limitError] : [])];
  if (!name) errors.unshift('name is required');
  if (errors.length > 0) return res.status(400).json({ message: 'Validation failed', errors });

  // Escape % and _ so they are searched for literally rather than acting as wildcards
  const like = `%${name.replace(/[\\%_]/g, '\\$&')}%`;
  const params = [];
  let inner = `SELECT m.id, m.name, m.form, m.category, m.quantity, m.unit, m.price, m.branch, m.pharmacy_id,
                      p.name AS pharmacy, p.latitude, p.longitude`;
  if (geo.hasPosition) {
    inner += `, ${DISTANCE_SQL} AS distance_km`;
    params.push(geo.lat, geo.lat, geo.lng);
  }
  inner += ` FROM medications m JOIN pharmacies p ON p.id = m.pharmacy_id
             WHERE (m.name ILIKE ? OR m.category ILIKE ?)`;
  params.push(like, like);
  if (req.query.in_stock === 'true') inner += ' AND m.quantity > 0';

  let sql;
  if (geo.hasPosition) {
    // distance_km is computed in the inner query so the outer one can filter and sort on it
    sql = `SELECT * FROM (${inner}) t`;
    if (geo.radiusKm !== null) {
      sql += ' WHERE distance_km <= ?';
      params.push(geo.radiusKm);
    }
    sql += ' ORDER BY distance_km ASC NULLS LAST, price ASC';
  } else {
    sql = `${inner} ORDER BY m.name ASC, m.price ASC`;
  }
  sql += ' LIMIT ?';
  params.push(limit);

  try {
    const [rows] = await pool.query(sql, params);
    res.json(rows.map(cleanMedication));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to search medications' });
  }
});

// GET medications for the logged-in pharmacy (token identifies the pharmacy)
router.get('/mine', requirePharmacy, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT ${MED_COLUMNS} FROM medications WHERE pharmacy_id = ? ORDER BY name ASC`,
      [req.pharmacyId]
    );
    res.json(rows.map(cleanMedication));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch your medications' });
  }
});

// GET medications for one pharmacy, by pharmacy name
router.get('/by-pharmacy', async (req, res) => {
  const { name } = req.query;
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'Missing pharmacy name' });

  try {
    // Names aren't unique across pharmacies, so match every pharmacy with this name
    const [pharmacies] = await pool.query('SELECT id FROM pharmacies WHERE LOWER(name) = LOWER(?)', [name]);
    if (pharmacies.length === 0) {
      return res.status(404).json({ error: 'Pharmacy not found' });
    }

    const [rows] = await pool.query(
      `SELECT ${PUBLIC_MED_COLUMNS} FROM medications WHERE pharmacy_id = ANY(?) ORDER BY name ASC`,
      [pharmacies.map((p) => p.id)]
    );
    res.json(rows.map(cleanMedication));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch pharmacy medications' });
  }
});

// --- Validation helper ---
// The largest values the database columns can hold (integer, numeric(10,2))
const MAX_QUANTITY = 2147483647;
const MAX_PRICE = 99999999.99;
const MAX_LENGTH = { name: 150, form: 100, category: 80, unit: 30, branch: 150, sku: 64 };

function validateMedicationBody(body, { partial = false } = {}) {
  const errors = [];
  const requiredFields = ['name', 'quantity', 'price', 'pharmacy_id'];

  if (!partial) {
    for (const field of requiredFields) {
      if (body[field] === undefined || body[field] === null || body[field] === '') {
        errors.push(`${field} is required`);
      }
    }
  }

  if (body.name !== undefined && typeof body.name !== 'string') {
    errors.push('name must be a string');
  }
  if (body.quantity !== undefined && !Number.isInteger(body.quantity)) {
    errors.push('quantity must be an integer');
  } else if (body.quantity !== undefined && body.quantity < 0) {
    errors.push('quantity must be 0 or more');
  } else if (body.quantity !== undefined && body.quantity > MAX_QUANTITY) {
    errors.push(`quantity must be ${MAX_QUANTITY} or less`);
  }
  if (body.price !== undefined && (typeof body.price !== 'number' || !Number.isFinite(body.price))) {
    errors.push('price must be a number');
  } else if (body.price !== undefined && body.price < 0) {
    errors.push('price must be 0 or more');
  } else if (body.price !== undefined && body.price > MAX_PRICE) {
    errors.push(`price must be ${MAX_PRICE} or less`);
  }
  if (body.pharmacy_id !== undefined && typeof body.pharmacy_id !== 'string') {
    errors.push('pharmacy_id must be a string (uuid)');
  }
  if (body.form !== undefined && typeof body.form !== 'string') {
    errors.push('form must be a string');
  }
  if (body.category !== undefined && typeof body.category !== 'string') {
    errors.push('category must be a string');
  }
  if (body.unit !== undefined && typeof body.unit !== 'string') {
    errors.push('unit must be a string');
  }
  if (body.branch !== undefined && typeof body.branch !== 'string') {
    errors.push('branch must be a string');
  }
  if (body.sku !== undefined && body.sku !== null && typeof body.sku !== 'string') {
    errors.push('sku must be a string');
  }

  // Text columns have fixed sizes; report too-long values instead of failing in the database
  for (const [field, max] of Object.entries(MAX_LENGTH)) {
    if (typeof body[field] === 'string' && body[field].length > max) {
      errors.push(`${field} must be at most ${max} characters`);
    }
  }

  return errors;
}

// A write that names a pharmacy_id that doesn't exist is a validation error (400), per the contract
function isUnknownPharmacy(err) {
  return isForeignKeyViolation(err);
}
const UNKNOWN_PHARMACY = { message: 'Validation failed', errors: ['pharmacy_id does not match an existing pharmacy'] };

// The pharmacy's own product code, trimmed; null when absent or blank
function skuOf(body) {
  return typeof body.sku === 'string' && body.sku.trim() ? body.sku.trim() : null;
}

// Used by write routes: if a pharmacy is logged in, the body's pharmacy_id must be that pharmacy
function ownsBody(req, res) {
  if (req.pharmacyId !== undefined && req.body.pharmacy_id !== req.pharmacyId) {
    res.status(403).json({ error: "You can only manage your own pharmacy's medications." });
    return false;
  }
  return true;
}

const MAX_BULK = 500;
const MAX_REPORTED_ERRORS = 50;

// POST /api/medications/bulk  { medications: [ { name, quantity, price, ...}, ... ] }   (pharmacy login)
// Upload or refresh a whole stock list in one call. Safe to repeat: each item is matched to
// an existing listing of YOUR pharmacy and updated, otherwise it is created.
//   - with a sku: matched by sku (recommended: use your own product code)
//   - without one: matched by exact name + form
// All or nothing: if any item is invalid, nothing is saved. pharmacy_id is taken from your login.
router.post('/bulk', requirePharmacy, async (req, res) => {
  const items = (req.body || {}).medications;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'Validation failed', errors: ['medications must be a non-empty array'] });
  }
  if (items.length > MAX_BULK) {
    return res.status(400).json({ message: 'Validation failed', errors: [`medications can contain at most ${MAX_BULK} items per request`] });
  }

  const errors = [];
  const seenSkus = new Set();
  items.forEach((item, i) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(`medications[${i}] must be an object`);
      return;
    }
    // pharmacy_id always comes from the login, whatever the item says
    validateMedicationBody({ ...item, pharmacy_id: req.pharmacyId }).forEach((e) => errors.push(`medications[${i}]: ${e}`));
    const sku = skuOf(item);
    if (sku) {
      if (seenSkus.has(sku)) errors.push(`medications[${i}]: sku "${sku}" appears more than once in this upload`);
      seenSkus.add(sku);
    }
  });
  if (errors.length > 0) {
    return res.status(400).json({ message: 'Validation failed', errors: errors.slice(0, MAX_REPORTED_ERRORS) });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const results = [];

    for (const item of items) {
      const sku = skuOf(item);
      const name = item.name.trim();
      const fields = [name, item.form ?? null, item.category ?? null, item.quantity, item.unit ?? null, item.price, item.branch ?? null];

      const [found] = sku
        ? await conn.query('SELECT id FROM medications WHERE pharmacy_id = ? AND sku = ? LIMIT 1', [req.pharmacyId, sku])
        : await conn.query(
            'SELECT id FROM medications WHERE pharmacy_id = ? AND sku IS NULL AND name = ? AND form IS NOT DISTINCT FROM ? LIMIT 1',
            [req.pharmacyId, name, item.form ?? null]
          );

      if (found.length > 0) {
        await conn.query(
          `UPDATE medications SET name = ?, form = ?, category = ?, quantity = ?, unit = ?, price = ?, branch = ?
           WHERE id = ? AND pharmacy_id = ?`,
          [...fields, found[0].id, req.pharmacyId]
        );
        results.push({ id: found[0].id, sku, name, action: 'updated' });
      } else {
        const id = randomUUID();
        await conn.query(
          `INSERT INTO medications (id, name, form, category, quantity, unit, price, branch, sku, pharmacy_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, ...fields, sku, req.pharmacyId]
        );
        results.push({ id, sku, name, action: 'created' });
      }
    }

    await conn.commit();
    res.status(200).json({
      created: results.filter((r) => r.action === 'created').length,
      updated: results.filter((r) => r.action === 'updated').length,
      results,
    });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'Failed to save the stock list. Nothing was changed.' });
  } finally {
    conn.release();
  }
});

// POST create a new medication (pharmacy login required)
router.post('/', optionalPharmacy, async (req, res) => {
  const errors = validateMedicationBody(req.body);
  if (errors.length > 0) {
    return res.status(400).json({ message: 'Validation failed', errors });
  }
  if (!ownsBody(req, res)) return;

  const { name, form, category, quantity, unit, price, branch, pharmacy_id } = req.body;
  const id = randomUUID();

  try {
    await pool.query(
      `INSERT INTO medications (id, name, form, category, quantity, unit, price, branch, sku, pharmacy_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, name.trim(), form ?? null, category ?? null, quantity, unit ?? null, price, branch ?? null, skuOf(req.body), pharmacy_id]
    );
    res.status(201).json(await findMedication(id));
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: 'You already have a medication with that sku.' });
    }
    if (isUnknownPharmacy(err)) return res.status(400).json(UNKNOWN_PHARMACY);
    console.error(err);
    res.status(500).json({ error: 'Failed to create medication' });
  }
});

// PUT replace an existing medication (pharmacy login required, own items only)
router.put('/:id', optionalPharmacy, async (req, res) => {
  const { id } = req.params;

  const errors = validateMedicationBody(req.body);
  if (errors.length > 0) {
    return res.status(400).json({ message: 'Validation failed', errors });
  }
  if (!ownsBody(req, res)) return;

  const { name, form, category, quantity, unit, price, branch, pharmacy_id } = req.body;

  // Logged in: only your own medications. Not logged in: any (the contract has no login).
  const scope = req.pharmacyId !== undefined ? ' AND pharmacy_id = ?' : '';
  const scopeParams = req.pharmacyId !== undefined ? [req.pharmacyId] : [];

  try {
    // Not found OR belongs to another pharmacy: same answer on purpose
    const [result] = await pool.query(
      `UPDATE medications
       SET name = ?, form = ?, category = ?, quantity = ?, unit = ?, price = ?, branch = ?, sku = ?, pharmacy_id = ?
       WHERE id = ?${scope}`,
      [name.trim(), form ?? null, category ?? null, quantity, unit ?? null, price, branch ?? null, skuOf(req.body), pharmacy_id, id, ...scopeParams]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Medication not found' });
    }
    res.status(200).json(await findMedication(id));
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: 'You already have a medication with that sku.' });
    }
    if (isUnknownPharmacy(err)) return res.status(400).json(UNKNOWN_PHARMACY);
    console.error(err);
    res.status(500).json({ error: 'Failed to update medication' });
  }
});

// PATCH update just the quantity (stock) (pharmacy login required, own items only)
router.patch('/:id/stock', optionalPharmacy, async (req, res) => {
  const { id } = req.params;
  const { quantity } = req.body || {};

  if (quantity === undefined || quantity === null) {
    return res.status(400).json({ error: 'quantity is required' });
  }
  if (!Number.isInteger(quantity)) {
    return res.status(400).json({ error: 'quantity must be an integer' });
  }
  if (quantity < 0) {
    return res.status(400).json({ error: 'quantity must be 0 or more' });
  }

  try {
    const [result] = await pool.query(
      `UPDATE medications SET quantity = ? WHERE id = ?${req.pharmacyId !== undefined ? ' AND pharmacy_id = ?' : ''}`,
      req.pharmacyId !== undefined ? [quantity, id, req.pharmacyId] : [quantity, id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Medication not found' });
    }
    res.status(200).json(await findMedication(id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update stock' });
  }
});

// DELETE a medication (pharmacy login required, own items only)
router.delete('/:id', optionalPharmacy, async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await pool.query(
      `DELETE FROM medications WHERE id = ?${req.pharmacyId !== undefined ? ' AND pharmacy_id = ?' : ''}`,
      req.pharmacyId !== undefined ? [id, req.pharmacyId] : [id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Medication not found' });
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete medication' });
  }
});

module.exports = router;
