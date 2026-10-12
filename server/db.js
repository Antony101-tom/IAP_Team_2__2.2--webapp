const mysql = require('mysql2/promise');
require('dotenv').config();

// Connection pool: reuses connections instead of opening one per request
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'meditrac',
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true, // return DECIMAL columns (price, lat/lng) as numbers, not strings
});

module.exports = { pool };
