-- Enable FK constraints
PRAGMA foreign_keys = ON;

-- DROP tables if you need to reset (uncomment if needed)
-- DROP TABLE IF EXISTS audit;
-- DROP TABLE IF EXISTS settlements;
-- DROP TABLE IF EXISTS authorizations;
-- DROP TABLE IF EXISTS orders;
-- DROP TABLE IF EXISTS customers;

-- Customers
CREATE TABLE IF NOT EXISTS customers (
  customer_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name       TEXT NOT NULL,
  address_line1   TEXT NOT NULL,
  address_line2   TEXT,
  city            TEXT,
  state           TEXT,
  zip_code        TEXT NOT NULL,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Orders
CREATE TABLE IF NOT EXISTS orders (
  order_id        TEXT PRIMARY KEY,
  customer_id     INTEGER NOT NULL,
  order_amount    NUMERIC,
  currency_type   TEXT DEFAULT 'USD',
  status_id       TEXT CHECK (status_id IN ('PENDING','AUTHORIZED','DECLINED','ERROR','SETTLED')),
  order_date      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
);

-- Authorizations
CREATE TABLE IF NOT EXISTS authorizations (
  auth_id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id        TEXT NOT NULL,
  response_id     TEXT CHECK (response_id IN ('SUCCESS','INVALID_CARD','INSUFFICIENT_FUNDS','SERVER_ERROR')) NOT NULL,
  currency_type   TEXT DEFAULT 'USD',
  auth_amnt       NUMERIC,
  ref_num         TEXT,
  card_provider   TEXT,
  last_4          TEXT,  -- store only last 4 (no PAN/CCV)
  month_exp       INTEGER,
  year_exp        INTEGER,
  audit_date      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(order_id)
);

-- Settlements
CREATE TABLE IF NOT EXISTS settlements (
  settlement_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id        TEXT NOT NULL,
  auth_id         INTEGER NOT NULL,
  settled_amnt    NUMERIC NOT NULL,
  settlement_stat TEXT CHECK (settlement_stat IN ('SETTLED','REVERSED')) NOT NULL,
  settlement_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(order_id),
  FOREIGN KEY (auth_id) REFERENCES authorizations(auth_id)
);

-- Audit
CREATE TABLE IF NOT EXISTS audit (
  log_id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type      TEXT CHECK (event_type IN ('AUTH_REQUEST','AUTH_RESULT','SETTLEMENT_REQUEST','SETTLEMENT_RESULT','ACCESS_DENIED')) NOT NULL,
  order_id        TEXT,
  auth_id         INTEGER,
  settlement_id   INTEGER,
  user_message    TEXT,
  generated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(order_id),
  FOREIGN KEY (auth_id) REFERENCES authorizations(auth_id),
  FOREIGN KEY (settlement_id) REFERENCES settlements(settlement_id)
);

-- Seed data (you can insert explicit IDs in SQLite)
INSERT OR IGNORE INTO customers (customer_id, full_name, address_line1, address_line2, city, state, zip_code)
VALUES
  (1, 'Mike Ike', '35 Wooded Way', NULL, 'Suwanee', 'GA', '30024'),
  (2, 'Bobby Bones', '2250 Highrise Ct', NULL, 'Canton', 'GA', '30114'),
  (3, 'Tommy John', '105 Brick Blvd', NULL, 'Atlanta', 'GA', '30304'),
  (4, 'Jimmy Dean', '321 ABC Rd', NULL, 'Duluth', 'GA', '30096');

INSERT OR IGNORE INTO orders (order_id, customer_id, order_amount, currency_type, status_id, order_date)
VALUES
  ('ORD1001', 1, 50.35, 'USD', 'AUTHORIZED', '2025-01-02 00:00:00'),
  ('ORD1002', 2, 62.50, 'USD', 'DECLINED',   '2025-01-03 00:00:00'),
  ('ORD1003', 3, 31.80, 'USD', 'DECLINED',   '2025-01-04 00:00:00'),
  ('ORD1004', 4, 78.50, 'USD', 'ERROR',      '2025-01-05 00:00:00');
