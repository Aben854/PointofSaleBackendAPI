// ===============================
// CAPSTONE BACKEND – SERVER.JS
// ===============================

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");
const path = require("path");
const YAML = require("yamljs");
const swaggerUi = require("swagger-ui-express");
require("dotenv").config({ quiet: true });

// Env + Logging
const IS_TEST = process.env.NODE_ENV === "test";
const log = (...args) => { if (!IS_TEST) console.log(...args); };

const app = express();
app.set("trust proxy", 1);

// Middleware
app.use(express.json());
app.use(cors());
app.use(
  helmet({
    contentSecurityPolicy: false // allow inline admin scripts
  })
);
app.disable("x-powered-by");

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false
  })
);

// Database Setup
const DB_FILE = process.env.DB_FILE || path.join(__dirname, "ecommerce.db");
const INIT_SQL = path.join(__dirname, "init-sqlite.sql");

const dbExists = fs.existsSync(DB_FILE);
const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) console.error("❌ DB Error:", err.message);
  else log("📦 Database loaded:", DB_FILE);
});

if (!dbExists && fs.existsSync(INIT_SQL)) {
  const schema = fs.readFileSync(INIT_SQL, "utf8");
  db.exec(schema, (err) => {
    if (err) console.error("❌ Schema Error:", err.message);
    else log("✅ Database initialized from init-sqlite.sql");
  });
}

const dbPath = path.join(__dirname, "ecommerce.db");
if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
  console.log("🗑️ Old ecommerce.db deleted, will recreate on startup.");
}


// Swagger Docs
const swaggerPath = path.join(__dirname, "openapi.yaml");
if (fs.existsSync(swaggerPath)) {
  const docs = YAML.load(swaggerPath);
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(docs));
  log("📘 Swagger running at /docs");
}

// Static Admin UI
const publicDir = __dirname;;
app.use(express.static(publicDir));
app.get("/admin", (req, res) =>
  res.sendFile(path.join(publicDir, "admin.html"))
);

// Health
app.get("/", (req, res) => res.json({ ok: true, admin: "/admin", docs: "/docs" }));
app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/db-health", (req, res) => {
  db.get("SELECT 1 AS result", [], (err, row) => {
    if (err) return res.status(500).json({ db: "down", error: err.message });
    res.json({ db: "up", result: !!row });
  });
});

// Weighted Authorization Outcome
function pickAuthOutcomeWeighted() {
  const r = Math.random();
  if (r < 0.6) return "SUCCESS";
  if (r < 0.77) return "INSUFFICIENT_FUNDS";
  if (r < 0.94) return "INCORRECT_DETAILS";
  return "SERVER_ERROR";
}

// ============================================
// ORDERS
// ============================================

// List Orders (no dependency on order_date)
app.get("/orders", (req, res) => {
  const limit = parseInt(req.query.limit) || 200;
  const offset = parseInt(req.query.offset) || 0;

  db.all(
    "SELECT * FROM orders ORDER BY rowid DESC LIMIT ? OFFSET ?",
    [limit, offset],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// Order Detail
app.get("/orders/:id", (req, res) => {
  const id = req.params.id;

  db.get("SELECT * FROM orders WHERE order_id = ?", [id], (err, order) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!order) return res.status(404).json({ error: "Order not found" });

    db.get(
      "SELECT * FROM authorizations WHERE order_id = ? ORDER BY rowid DESC LIMIT 1",
      [id],
      (err2, auth) => {
        if (err2) return res.status(500).json({ error: err2.message });

        db.get(
          "SELECT * FROM settlements WHERE order_id = ? ORDER BY rowid DESC LIMIT 1",
          [id],
          (err3, settle) => {
            if (err3) return res.status(500).json({ error: err3.message });

            res.json({
              order,
              lastAuthorization: auth || null,
              lastSettlement: settle || null
            });
          }
        );
      }
    );
  });
});

// ============================================
// CHECKOUT / AUTHORIZATION
// ============================================

app.post("/orders/checkout", (req, res) => {
  const { orderId, customerId, amount, last4 } = req.body;

  if (!orderId || !customerId || !amount) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const result = pickAuthOutcomeWeighted();

  const status =
    result === "SUCCESS"
      ? "AUTHORIZED"
      : result === "INSUFFICIENT_FUNDS" || result === "INCORRECT_DETAILS"
      ? "DECLINED"
      : "ERROR";

  db.run(
    "INSERT OR REPLACE INTO orders(order_id, customer_id, order_amount, status_id, order_date) VALUES (?, ?, ?, ?, datetime('now'))",
    [orderId, customerId, amount, status],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });

      db.run(
        "INSERT INTO authorizations(order_id, response_id, auth_amnt, last_4, audit_date) VALUES (?, ?, ?, ?, datetime('now'))",
        [orderId, result, amount, last4 || "0000"],
        (err2) => {
          if (err2) return res.status(500).json({ error: err2.message });

          res.json({ orderId, result, status });
        }
      );
    }
  );
});

// ============================================
// PAYMENT SETTLEMENT (AUTO-CREATE AUTH IF MISSING)
// ============================================

app.post("/payments/settle", (req, res) => {
  const { orderId, amount } = req.body;

  if (!orderId || !amount) {
    return res.status(400).json({ error: "Missing fields" });
  }

  db.get(
    "SELECT order_id, status_id, order_amount FROM orders WHERE order_id = ?",
    [orderId],
    (err, order) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!order) return res.status(404).json({ error: "Order not found" });

      if (order.status_id !== "AUTHORIZED") {
        return res.status(400).json({ error: "Order not authorized, cannot settle" });
      }

      db.get(
        "SELECT auth_id FROM authorizations WHERE order_id = ? ORDER BY rowid DESC LIMIT 1",
        [orderId],
        (err2, auth) => {
          if (err2) return res.status(500).json({ error: err2.message });

          if (!auth) {
            // Auto-create authorization
            db.run(
              "INSERT INTO authorizations(order_id, response_id, auth_amnt, last_4, audit_date) VALUES (?, 'SUCCESS', ?, '0000', datetime('now'))",
              [orderId, order.order_amount],
              function (err3) {
                if (err3) return res.status(500).json({ error: err3.message });
                finalizeSettlement(orderId, amount, this.lastID, res);
              }
            );
          } else {
            finalizeSettlement(orderId, amount, auth.auth_id, res);
          }
        }
      );
    }
  );
});

// Helper for settlement
function finalizeSettlement(orderId, amount, authId, res) {
  db.run(
    "INSERT INTO settlements(order_id, auth_id, settled_amnt, settlement_stat, settlement_date) VALUES (?, ?, ?, 'SETTLED', datetime('now'))",
    [orderId, authId, amount],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });

      db.run(
        "UPDATE orders SET status_id = 'SETTLED' WHERE order_id = ?",
        [orderId],
        (err2) => {
          if (err2) return res.status(500).json({ error: err2.message });

          res.json({ orderId, paymentStatus: "SETTLED", auth_id: authId });
        }
      );
    }
  );
}

// ============================================
// STATS (ORDER BY rowid)
// ============================================

app.get("/stats", (req, res) => {
  const out = { totals: {}, recentOrders: [], settled_total: 0 };

  db.all("SELECT status_id, COUNT(*) AS count FROM orders GROUP BY status_id", [], (e1, rows1) => {
    if (e1) return res.status(500).json({ error: e1.message });

    rows1.forEach((r) => (out.totals[r.status_id] = r.count));

    db.get("SELECT COUNT(*) AS total FROM orders", [], (e2, row2) => {
      out.totals.ALL = row2?.total || 0;

      db.get("SELECT IFNULL(SUM(settled_amnt), 0) AS settled_total FROM settlements", [], (e3, row3) => {
        out.settled_total = Number(row3?.settled_total || 0);

        db.all("SELECT * FROM orders ORDER BY rowid DESC LIMIT 5", [], (e4, rows4) => {
          out.recentOrders = rows4 || [];
          res.json(out);
        });
      });
    });
  });
});

// ============================================
// SEED ORDERS
// ============================================

app.post("/seed-orders", (req, res) => {
  const sampleOrders = [
    ["ORD9001", 1, 45.5, "AUTHORIZED"],
    ["ORD9002", 2, 78.2, "DECLINED"],
    ["ORD9003", 3, 23.99, "SETTLED"],
    ["ORD9004", 4, 51.77, "ERROR"],
    ["ORD9005", 1, 67.4, "AUTHORIZED"],
    ["ORD9006", 2, 15.99, "AUTHORIZED"],
    ["ORD9007", 3, 90.1, "DECLINED"],
    ["ORD9008", 4, 12.3, "AUTHORIZED"],
    ["ORD9009", 1, 120.0, "ERROR"],
    ["ORD9010", 2, 44.44, "AUTHORIZED"]
  ];

  const stmt = db.prepare(
    "INSERT OR REPLACE INTO orders(order_id, customer_id, order_amount, status_id, order_date) VALUES (?, ?, ?, ?, datetime('now'))"
  );

  sampleOrders.forEach((o) => stmt.run(o));
  stmt.finalize();

  res.json({ message: "10 sample orders added." });
});

// Start Server
if (!IS_TEST) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => log(`✅ API running on port ${PORT}`));
}

module.exports = app;
