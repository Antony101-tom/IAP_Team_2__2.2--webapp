const express = require('express');
const bcrypt = require('bcrypt');
const { randomUUID } = require('crypto');
const { pool } = require('../db');
const { signToken } = require('../middleware/auth');
const { readPharmacyDetails } = require('../pharmacyDetails');
const { describeError } = require('../errors');
const { isUniqueViolation } = require('../dbErrors');

const router = express.Router();
const SALT_ROUNDS = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// accountType -> table + the columns we read back
const TABLES = {
  user: { table: 'users', columns: 'id, name, email' },
  pharmacy: { table: 'pharmacies', columns: 'id, name, email, phone, address, opening_hours, latitude, longitude' },
};

function accountPayload(type, row) {
  const account = { id: row.id, type, name: row.name, email: row.email };
  if (type === 'pharmacy') {
    account.phone = row.phone ?? null;
    account.address = row.address ?? null;
    account.opening_hours = row.opening_hours ?? null;
    account.latitude = row.latitude ?? null;
    account.longitude = row.longitude ?? null;
  }
  return account;
}

// POST /api/auth/register  { accountType, name, email, password }
// A pharmacy may also send phone, address, opening_hours and latitude + longitude, so an
// app can create a complete pharmacy in one call.
router.post('/register', async (req, res) => {
  const body = req.body || {};
  const { accountType, password } = body;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

  if (!TABLES[accountType]) {
    return res.status(400).json({ error: 'accountType must be "user" or "pharmacy".' });
  }
  if (!name || name.length > 150) {
    return res.status(400).json({ error: 'Please enter a name (150 characters maximum).' });
  }
  if (!EMAIL_RE.test(email) || email.length > 255) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }
  // bcrypt silently ignores everything past 72 bytes, so refuse rather than truncate
  if (Buffer.byteLength(password) > 72) {
    return res.status(400).json({ error: 'Password is too long (72 characters maximum).' });
  }

  // Column names below come from fixed lists, never from the request
  const columns = ['id', 'name', 'email', 'password_hash'];
  let details = {};
  if (accountType === 'pharmacy') {
    const read = readPharmacyDetails(body);
    if (read.errors.length > 0) return res.status(400).json({ error: read.errors.join('. ') });
    details = read.values;
  }

  try {
    const id = randomUUID();
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const params = [id, name, email, passwordHash];
    for (const [field, value] of Object.entries(details)) {
      columns.push(field);
      params.push(value);
    }
    await pool.query(
      `INSERT INTO ${TABLES[accountType].table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      params
    );

    res.status(201).json({
      token: signToken(accountType, id),
      account: accountPayload(accountType, { id, name, email, ...details }),
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
    console.error('Registration error:', describeError(err));
    res.status(500).json({ error: 'Server error during registration.' });
  }
});

// POST /api/auth/login  { accountType, email, password }
router.post('/login', async (req, res) => {
  const body = req.body || {};
  const { accountType, password } = body;
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

  if (!TABLES[accountType]) {
    return res.status(400).json({ error: 'accountType must be "user" or "pharmacy".' });
  }
  if (!email || typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const { table, columns } = TABLES[accountType]; // fixed whitelist, never user input
    const [rows] = await pool.query(
      `SELECT ${columns}, password_hash FROM ${table} WHERE email = ?`,
      [email]
    );

    // Same message for unknown email and wrong password, so emails can't be probed
    if (rows.length === 0 || !(await bcrypt.compare(password, rows[0].password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    res.json({
      token: signToken(accountType, rows[0].id),
      account: accountPayload(accountType, rows[0]),
    });
  } catch (err) {
    console.error('Login error:', describeError(err));
    res.status(500).json({ error: 'Server error during login.' });
  }
});

module.exports = router;
