const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');

// GET all medications
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('medications')
      .select('*');

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch medications' });
  }
});

// GET medications for one pharmacy, by pharmacy name
router.get('/by-pharmacy', async (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'Missing pharmacy name' });

  try {
    const { data: pharmacy, error: pharmacyError } = await supabase
      .from('pharmacies')
      .select('id')
      .ilike('name', name)
      .single();

    if (pharmacyError || !pharmacy) {
      return res.status(404).json({ error: 'Pharmacy not found' });
    }

    const { data, error } = await supabase
      .from('medications')
      .select('*')
      .eq('pharmacy_id', pharmacy.id);

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch pharmacy medications' });
  }
});

// --- Validation helper ---
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
  }
  if (body.price !== undefined && typeof body.price !== 'number') {
    errors.push('price must be a number');
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

  return errors;
}

// POST create a new medication
router.post('/', async (req, res) => {
  const errors = validateMedicationBody(req.body);
  if (errors.length > 0) {
    return res.status(400).json({ message: 'Validation failed', errors });
  }

  const { name, form, category, quantity, unit, price, branch, pharmacy_id } = req.body;

  try {
    const { data, error } = await supabase
      .from('medications')
      .insert({ name, form, category, quantity, unit, price, branch, pharmacy_id })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create medication' });
  }
});

// PUT replace an existing medication
router.put('/:id', async (req, res) => {
  const { id } = req.params;

  const errors = validateMedicationBody(req.body);
  if (errors.length > 0) {
    return res.status(400).json({ message: 'Validation failed', errors });
  }

  const { name, form, category, quantity, unit, price, branch, pharmacy_id } = req.body;

  try {
    const { data: existing, error: findError } = await supabase
      .from('medications')
      .select('id')
      .eq('id', id)
      .single();

    if (findError || !existing) {
      return res.status(404).json({ error: 'Medication not found' });
    }

    const { data, error } = await supabase
      .from('medications')
      .update({ name, form, category, quantity, unit, price, branch, pharmacy_id })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.status(200).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update medication' });
  }
});

// PATCH update just the quantity (stock)
router.patch('/:id/stock', async (req, res) => {
  const { id } = req.params;
  const { quantity } = req.body;

  if (quantity === undefined || quantity === null) {
    return res.status(400).json({ message: 'quantity is required' });
  }
  if (!Number.isInteger(quantity)) {
    return res.status(400).json({ message: 'quantity must be an integer' });
  }

  try {
    const { data: existing, error: findError } = await supabase
      .from('medications')
      .select('id')
      .eq('id', id)
      .single();

    if (findError || !existing) {
      return res.status(404).json({ error: 'Medication not found' });
    }

    const { data, error } = await supabase
      .from('medications')
      .update({ quantity })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.status(200).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update stock' });
  }
});

// DELETE a medication
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const { data: existing, error: findError } = await supabase
      .from('medications')
      .select('id')
      .eq('id', id)
      .single();

    if (findError || !existing) {
      return res.status(404).json({ error: 'Medication not found' });
    }

    const { error } = await supabase
      .from('medications')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete medication' });
  }
});

module.exports = router;