// PostgreSQL reports constraint problems with standard error codes
// (https://www.postgresql.org/docs/current/errcodes-appendix.html).
const isUniqueViolation = (err) => !!err && err.code === '23505'; // e.g. an email or sku already used
const isForeignKeyViolation = (err) => !!err && err.code === '23503'; // e.g. a pharmacy_id that does not exist

module.exports = { isUniqueViolation, isForeignKeyViolation };
