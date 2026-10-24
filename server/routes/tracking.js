const express = require('express');
const { pool } = require('../db');
const { requireUser } = require('../middleware/auth');
const { isForeignKeyViolation } = require('../dbErrors');

const router = express.Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/tracking  -> array of medication ids the logged-in patient is tracking
router.get('/', requireUser, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT medication_id FROM tracked_medications WHERE user_id = ? ORDER BY created_at DESC',
      [req.userId]
    );
    res.json(rows.map((r) => r.medication_id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch trackers' });
  }
});

// POST /api/tracking  { medication_id }
router.post('/', requireUser, async (req, res) => {
  const medicationId = (req.body || {}).medication_id;
  if (typeof medicationId !== 'string' || !UUID_RE.test(medicationId)) {
    return res.status(400).json({ message: 'medication_id must be a uuid string' });
  }

  try {
    // ON CONFLICT DO NOTHING: tracking the same listing twice is harmless. A medication that
    // doesn't exist still fails with a foreign-key error, which becomes a 404 below.
    await pool.query(
      `INSERT INTO tracked_medications (user_id, medication_id) VALUES (?, ?)
       ON CONFLICT (user_id, medication_id) DO NOTHING`,
      [req.userId, medicationId]
    );
    res.status(201).json({ medication_id: medicationId });
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      return res.status(404).json({ error: 'Medication not found' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to add tracker' });
  }
});

// DELETE /api/tracking/:medicationId
router.delete('/:medicationId', requireUser, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM tracked_medications WHERE user_id = ? AND medication_id = ?',
      [req.userId, req.params.medicationId]
    );
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to remove tracker' });
  }
});

module.exports = router;
