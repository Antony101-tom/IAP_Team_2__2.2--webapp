const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('API is running');
});

const medicationRoutes = require('./routes/medications');
app.use('/api/medications', medicationRoutes);

module.exports = app;