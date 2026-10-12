-- MediTrac demo data. Run AFTER schema.sql:  mysql -u root -p meditrac < seed_data.sql
-- Every demo account below logs in with the password: Password123
-- Delete these before going live.
USE meditrac;
SET NAMES utf8mb4; -- so the bullet (•) in the sample text loads correctly whatever your client's default is

INSERT INTO users (id, name, email, password_hash) VALUES
('b2000000-0000-4000-8000-000000000001', 'Demo Patient', 'patient@example.com', '$2b$10$llu6H.wUNr85lRLmnaUTMer8Lw49anPynT8Op3db9EeDYcAAeW9Iy');

INSERT INTO pharmacies (id, name, email, password_hash, phone, address, opening_hours, latitude, longitude) VALUES
('a1000000-0000-4000-8000-000000000001', 'Halisi Pharmaceuticals', 'info@halisipharmacy.co.ke', '$2b$10$llu6H.wUNr85lRLmnaUTMer8Lw49anPynT8Op3db9EeDYcAAeW9Iy', '0722000001', 'Kilimani, Nairobi', 'Mon-Sat 8am-9pm', -1.2921, 36.7872),
('a1000000-0000-4000-8000-000000000002', 'Wellness Pharmacy', 'wellness@example.com', '$2b$10$llu6H.wUNr85lRLmnaUTMer8Lw49anPynT8Op3db9EeDYcAAeW9Iy', '0722000002', 'Tom Mboya Street, Nairobi', 'Daily 7am-10pm', -1.2833, 36.8219),
('a1000000-0000-4000-8000-000000000003', 'CityCare Chemist', 'citycare@example.com', '$2b$10$llu6H.wUNr85lRLmnaUTMer8Lw49anPynT8Op3db9EeDYcAAeW9Iy', '0722000003', 'Lavington, Nairobi', 'Mon-Fri 8am-6pm', -1.3, 36.76);

INSERT INTO medications (id, name, form, category, quantity, unit, price, branch, pharmacy_id) VALUES
('c3000000-0000-4000-8000-000000000001', 'Amoxicillin 500mg', 'Capsules • 10x10 pack', 'Antibiotic', 40, 'Boxes', 650, 'Kilimani Branch', 'a1000000-0000-4000-8000-000000000001'),
('c3000000-0000-4000-8000-000000000002', 'Paracetamol 500mg', 'Tablets • 10x10 pack', 'Analgesic / Pain Relief', 120, 'Boxes', 50, 'Kilimani Branch', 'a1000000-0000-4000-8000-000000000001'),
('c3000000-0000-4000-8000-000000000003', 'Metformin 500mg', 'Tablets • 30 pack', 'Antidiabetic', 25, 'Packs', 750, 'Kilimani Branch', 'a1000000-0000-4000-8000-000000000001'),
('c3000000-0000-4000-8000-000000000004', 'Ventolin Inhaler', 'Inhaler • 200 doses', 'Respiratory', 4, 'Inhalers', 900, 'Kilimani Branch', 'a1000000-0000-4000-8000-000000000001'),
('c3000000-0000-4000-8000-000000000005', 'Insulin Lantus', 'Vial • 10ml', 'Antidiabetic', 0, 'Vials', 2400, 'Kilimani Branch', 'a1000000-0000-4000-8000-000000000001'),
('c3000000-0000-4000-8000-000000000006', 'Paracetamol 500mg', 'Tablets • 10x10 pack', 'Analgesic / Pain Relief', 60, 'Boxes', 55, 'CBD Branch', 'a1000000-0000-4000-8000-000000000002'),
('c3000000-0000-4000-8000-000000000007', 'Amoxicillin 500mg', 'Capsules • 10x10 pack', 'Antibiotic', 12, 'Boxes', 620, 'CBD Branch', 'a1000000-0000-4000-8000-000000000002'),
('c3000000-0000-4000-8000-000000000008', 'Ventolin Inhaler', 'Inhaler • 200 doses', 'Respiratory', 30, 'Inhalers', 950, 'CBD Branch', 'a1000000-0000-4000-8000-000000000002'),
('c3000000-0000-4000-8000-000000000009', 'Cetirizine 10mg', 'Tablets • 10 pack', 'Antihistamine', 3, 'Packs', 180, 'Lavington Branch', 'a1000000-0000-4000-8000-000000000003'),
('c3000000-0000-4000-8000-000000000010', 'Amoxicillin 500mg', 'Capsules • 10x10 pack', 'Antibiotic', 50, 'Boxes', 640, 'Lavington Branch', 'a1000000-0000-4000-8000-000000000003');
