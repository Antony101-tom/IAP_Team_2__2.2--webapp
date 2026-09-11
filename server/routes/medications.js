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

module.exports = router;