-- Only needed if you already created the database with an earlier schema.sql.
-- Run it ONCE:  mysql -u root -p meditrac < migration_partner_api.sql
-- (If it says "Duplicate column name", it has already been applied.)
USE meditrac;

ALTER TABLE pharmacies
  ADD COLUMN phone VARCHAR(30) NULL AFTER password_hash,
  ADD COLUMN address VARCHAR(255) NULL AFTER phone,
  ADD COLUMN opening_hours VARCHAR(100) NULL AFTER address;

ALTER TABLE medications
  ADD COLUMN sku VARCHAR(64) NULL AFTER branch,
  ADD UNIQUE KEY uq_medications_pharmacy_sku (pharmacy_id, sku);
