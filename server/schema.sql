-- MediTrac MySQL schema (MySQL 8+ / MariaDB 10.5+)
-- Run with:  mysql -u root -p < schema.sql
-- ids are UUID strings (CHAR(36)) to match the API contract in openapi.yaml.

CREATE DATABASE IF NOT EXISTS meditrac
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE meditrac;

CREATE TABLE IF NOT EXISTS users (
    id             CHAR(36)     NOT NULL,
    name           VARCHAR(150) NOT NULL,
    email          VARCHAR(255) NOT NULL,
    password_hash  VARCHAR(255) NOT NULL,           -- bcrypt hash, never plain text
    created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS pharmacies (
    id             CHAR(36)     NOT NULL,
    name           VARCHAR(150) NOT NULL,
    email          VARCHAR(255) NOT NULL,
    password_hash  VARCHAR(255) NOT NULL,
    phone          VARCHAR(30)  NULL,               -- optional public contact details
    address        VARCHAR(255) NULL,
    opening_hours  VARCHAR(100) NULL,
    latitude       DECIMAL(9,6) NULL,               -- set when the pharmacy pins its location
    longitude      DECIMAL(9,6) NULL,
    created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_pharmacies_email (email),
    KEY idx_pharmacies_name (name),
    CONSTRAINT chk_pharmacy_lat CHECK (latitude  IS NULL OR latitude  BETWEEN -90  AND 90),
    CONSTRAINT chk_pharmacy_lng CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS medications (
    id           CHAR(36)      NOT NULL,
    name         VARCHAR(150)  NOT NULL,
    form         VARCHAR(100)  NULL,
    category     VARCHAR(80)   NULL,
    quantity     INT UNSIGNED  NOT NULL DEFAULT 0,
    unit         VARCHAR(30)   NULL,
    price        DECIMAL(10,2) NOT NULL,
    branch       VARCHAR(150)  NULL,
    sku          VARCHAR(64)   NULL,                -- the pharmacy's own product code (lets uploads update instead of duplicate)
    pharmacy_id  CHAR(36)      NOT NULL,
    created_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_medications_pharmacy_sku (pharmacy_id, sku),
    KEY idx_medications_pharmacy (pharmacy_id),
    KEY idx_medications_name (name),
    CONSTRAINT fk_medications_pharmacy FOREIGN KEY (pharmacy_id)
        REFERENCES pharmacies (id) ON DELETE CASCADE,
    CONSTRAINT chk_medication_price CHECK (price >= 0)
) ENGINE=InnoDB;

-- A patient "tracking" a specific pharmacy listing
CREATE TABLE IF NOT EXISTS tracked_medications (
    user_id        CHAR(36)  NOT NULL,
    medication_id  CHAR(36)  NOT NULL,
    created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, medication_id),
    CONSTRAINT fk_trackedmeds_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_trackedmeds_medication FOREIGN KEY (medication_id)
        REFERENCES medications (id) ON DELETE CASCADE
) ENGINE=InnoDB;
