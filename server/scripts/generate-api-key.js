// Prints a new random API key. Usage: npm run generate:key
// Give the key to ONE partner, and add it to API_KEYS on the server (comma-separated for several).
const crypto = require('crypto');
console.log('mtk_' + crypto.randomBytes(24).toString('hex'));
