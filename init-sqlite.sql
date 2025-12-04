PRAGMA foreign_keys = ON;

-- ============================================
-- Drop Old Tables (for dev / re-init only)
-- ============================================
DROP TABLE IF EXISTS settlements;
DROP TABLE IF EXISTS authorizations;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS user_cards;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS customers;

-- =====================
-- Customers
-- =====================
CREATE TABLE IF NOT EXISTS customers (
  customer_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name       TEXT NOT NULL,
  address_line1   TEXT NOT NULL,
  address_line2   TEXT,
  city            TEXT,
  state           TEXT,
  zip_code        TEXT NOT NULL,

  -- NEW: fields used by auth.js
  email           TEXT UNIQUE,
  username        TEXT UNIQUE,
  password_hash   TEXT,
  is_verified     INTEGER NOT NULL DEFAULT 0,
  verify_token    TEXT,

  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =====================
-- Orders
-- =====================
CREATE TABLE IF NOT EXISTS orders (
  order_id       TEXT PRIMARY KEY,
  customer_id    INTEGER NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('PENDING','AUTHORIZED','DECLINED','ERROR','SETTLED')),
  total_amount   REAL NOT NULL,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE CASCADE
);

-- =====================
-- Authorizations
-- =====================
CREATE TABLE IF NOT EXISTS authorizations (
  auth_id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id        TEXT NOT NULL,
  outcome         TEXT NOT NULL CHECK (outcome IN ('SUCCESS','DECLINED','ERROR')),
  gateway_code    TEXT,
  gateway_message TEXT,
  amount          REAL NOT NULL,
  auth_token      TEXT,
  auth_expires_at DATETIME,

  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE
);


-- =====================
-- Settlements
-- =====================
CREATE TABLE IF NOT EXISTS settlements (
  settlement_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id       TEXT NOT NULL,
  amount         REAL NOT NULL,
  settled_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE
);

-- =====================
-- Audit Logs
-- =====================
CREATE TABLE IF NOT EXISTS audit_logs (
  audit_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type     TEXT NOT NULL,
  order_id       TEXT,
  details        TEXT,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =====================
-- Seed Customers (no login info – fine, login uses only new signups)
-- =====================
INSERT OR IGNORE INTO customers (customer_id, full_name, address_line1, address_line2, city, state, zip_code)
VALUES
  (1, 'Alice Johnson', '123 Main St', 'Apt 4B', 'Atlanta', 'GA', '30301'),
  (2, 'Bob Smith', '456 Oak Ave', NULL, 'Marietta', 'GA', '30060'),
  (3, 'Carol Lee', '789 Pine Rd', 'Unit 12', 'Kennesaw', 'GA', '30144');

-- =====================
-- Seed Orders
-- =====================
INSERT OR IGNORE INTO orders (order_id, customer_id, status, total_amount)
VALUES
  ('ORD1001', 1, 'PENDING',    75.50),
  ('ORD1002', 1, 'AUTHORIZED', 49.99),
  ('ORD1003', 2, 'DECLINED',   120.00),
  ('ORD1004', 3, 'SETTLED',    200.00);

-- =====================
-- Seed Authorizations
-- =====================
INSERT OR IGNORE INTO authorizations (order_id, outcome, gateway_code, gateway_message, amount)
VALUES
  ('ORD1002', 'SUCCESS', '00', 'Approved',     49.99),
  ('ORD1003', 'DECLINED','05', 'Do not honor',120.00),
  ('ORD1004', 'SUCCESS', '00', 'Approved',    200.00);

-- =====================
-- Seed Settlements
-- =====================
INSERT OR IGNORE INTO settlements (order_id, amount)
VALUES
  ('ORD1004', 200.00);

-- =====================
-- Seed Audit Logs
-- =====================
INSERT OR IGNORE INTO audit_logs (event_type, order_id, details)
VALUES
  ('ORDER_CREATED',    'ORD1001', 'Order created, pending checkout'),
  ('ORDER_AUTHORIZED', 'ORD1002', 'Authorization successful'),
  ('ORDER_DECLINED',   'ORD1003', 'Authorization declined'),
  ('ORDER_SETTLED',    'ORD1004', 'Settlement completed');

-- =====================
-- Users / Cards 
-- =====================
CREATE TABLE IF NOT EXISTS users (
  user_id         INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id     INTEGER,
  email           TEXT UNIQUE NOT NULL,
  username        TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  email_verified  INTEGER NOT NULL DEFAULT 0,
  verification_token TEXT,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS user_cards (
  card_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL,
  last4          TEXT NOT NULL,
  brand          TEXT,
  exp_month      INTEGER,
  exp_year       INTEGER,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
