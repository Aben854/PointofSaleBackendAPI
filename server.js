// ===============================
// CAPSTONE BACKEND – PATCHED SERVER.JS
// Fully CSP-safe, Render-ready, crash-proof
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

const app = express();
app.set("trust proxy", 1);

// ---------- Middleware ----------
app.use(express.json());
app.use(cors());

// Keep Helmet ON but disable only CSP (we use external JS, so still secure)
app.use(
  helmet({
    contentSecurityPolicy: false
  })
);

app.disable("x-powered-by");

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    legacyHeaders: false,
    standardHeaders: true
  })
);

// ---------- Database Setup ----------
const DB_FILE = process.env.DB_FILE || path.join(__dirname, "ecommerce.db");
const INIT_SQL = path.join(__dirname, "init-sqlite.sql");

const dbFileExists = fs.existsSync(DB_FILE);
const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) console.error("❌ DB Error:", err.message);
  else console.log("📦 SQLite DB loaded:", DB_FILE);
});

if (!dbFileExists && fs.existsSync(INIT_SQL)) {
  const schema = fs.readFileSync(INIT_SQL, "utf8");
  db.exec(schema, (err) => {
    if (err) console.error("❌ DB Init Error:", err.message);
    else console.log("✅ SQLite schema initialized");
  });
}

// ---------- Swagger ----------
const swaggerPath = path.join(__dirname, "openapi.yaml");
if (fs.existsSync(swaggerPath)) {
  const swaggerDocument = YAML.load(swaggerPath);
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
  console.log("📘 Swagger available at /docs");
}

// ---------- Static Admin ----------
const publicDir = __dirname;              
app.use(express.static(publicDir));

app.get("/admin", (_, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});


// ---------- Health ----------
app.get("/", (req, res) =>
  res.json({ ok: true, docs: "/docs", admin: "/admin" })
);

app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/db-health", (req, res) => {
  db.get("SELECT 1 AS result", [], (err, row) => {
    if (err) return res.status(500).json({ db: "down" });
    res.json({ db: "up" });
  });
});

// ---------- Helper ----------
function pickAuthOutcomeWeighted() {
  const r = Math.random();
  if (r < 0.7) return "SUCCESS";
  if (r < 0.9) return "INSUFFICIENT_FUNDS";
  return "SERVER_ERROR";
}

// ===============================
//          API ROUTES
// ===============================

// ---------- List Orders ----------
app.get("/orders", (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 100;
  const offset = parseInt(req.query.offset, 10) || 0;

  db.all(
    "SELECT * FROM orders ORDER BY order_date DESC LIMIT ? OFFSET ?",
    [limit, offset],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "Database read error" });
      res.json(rows);
    }
  );
});

// ---------- Order Detail ----------
app.get("/orders/:id", (req, res) => {
  const id = req.params.id;

  db.get("SELECT * FROM orders WHERE order_id = ?", [id], (err, order) => {
    if (err) return res.status(500).json({ error: "DB error" });
    if (!order) return res.status(404).json({ error: "Order not found" });

    db.get(
      "SELECT * FROM authorizations WHERE order_id = ? ORDER BY audit_date DESC LIMIT 1",
      [id],
      (err2, auth) => {
        if (err2) return res.status(500).json({ error: "DB error" });

        db.get(
          "SELECT * FROM settlements WHERE order_id = ? ORDER BY settlement_date DESC LIMIT 1",
          [id],
          (err3, settle) => {
            if (err3) return res.status(500).json({ error: "DB error" });

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

// ---------- Checkout / Authorization ----------
app.post("/orders/checkout", (req, res) => {
  const { orderId, customerId, amount, last4 } = req.body;
  if (!orderId || !customerId || !amount)
    return res.status(400).json({ error: "Missing fields" });

  const result = pickAuthOutcomeWeighted();
  const status =
    result === "SUCCESS"
      ? "AUTHORIZED"
      : result === "INSUFFICIENT_FUNDS"
      ? "DECLINED"
      : "ERROR";

  db.run(
    "INSERT OR REPLACE INTO orders(order_id, customer_id, order_amount, status_id, order_date) VALUES (?, ?, ?, ?, datetime('now'))",
    [orderId, customerId, amount, status],
    (err) => {
      if (err) return res.status(500).json({ error: "DB write error" });

      db.run(
        "INSERT INTO authorizations(order_id, response_id, auth_amnt, last_4, audit_date) VALUES (?, ?, ?, ?, datetime('now'))",
        [orderId, result, amount, last4 || "0000"],
        (err2) => {
          if (err2) return res.status(500).json({ error: "DB write error" });
          res.json({ orderId, status, result });
        }
      );
    }
  );
});

// ---------- Settlement (PATCHED, CRASH-PROOF) ----------
app.post("/payments/settle", (req, res) => {
  const { orderId, amount } = req.body;

  if (!orderId || !amount)
    return res.status(400).json({ error: "Missing orderId or amount" });

  // Get order
  db.get(
    "SELECT order_id, status_id FROM orders WHERE order_id = ?",
    [orderId],
    (err, order) => {
      if (err) return res.status(500).json({ error: "DB read error" });
      if (!order) return res.status(404).json({ error: "Order not found" });

      if (order.status_id !== "AUTHORIZED") {
        return res.status(400).json({
          error: `Order ${orderId} cannot be settled because its status is '${order.status_id}'. Only AUTHORIZED orders may be settled.`
        });
      }

      // Fetch last authorization (may not exist)
      db.get(
        "SELECT auth_id FROM authorizations WHERE order_id = ? ORDER BY audit_date DESC LIMIT 1",
        [orderId],
        (err2, auth) => {
          if (err2) return res.status(500).json({ error: "DB read error" });

          const authId = auth?.auth_id || null;

          // Insert settlement
          db.run(
            "INSERT INTO settlements(order_id, auth_id, settled_amnt, settlement_stat, settlement_date) VALUES (?, ?, ?, 'SETTLED', datetime('now'))",
            [orderId, authId, amount],
            (err3) => {
              if (err3)
                return res.status(500).json({ error: "DB write error (settlements)" });

              // Update order
              db.run(
                "UPDATE orders SET status_id='SETTLED' WHERE order_id=?",
                [orderId],
                (err4) => {
                  if (err4)
                    return res.status(500).json({ error: "DB write error (order update)" });

                  res.json({
                    orderId,
                    paymentStatus: "SETTLED",
                    authorizationUsed: authId || "none",
                    note:
                      authId === null
                        ? "Warning: no authorization record found. Still settled for class project."
                        : "Settlement succeeded using last authorization."
                  });
                }
              );
            }
          );
        }
      );
    }
  );
});

// ---------- Stats ----------
app.get("/stats", (req, res) => {
  const out = { totals: {}, recentOrders: [], settled_total: 0 };

  db.all(
    "SELECT status_id, COUNT(*) AS count FROM orders GROUP BY status_id",
    [],
    (e1, rows1) => {
      if (e1) return res.status(500).json({ error: "DB error" });

      rows1.forEach((r) => (out.totals[r.status_id] = r.count));

      db.get("SELECT COUNT(*) AS total FROM orders", [], (e2, row2) => {
        if (e2) return res.status(500).json({ error: "DB error" });
        out.totals.ALL = row2?.total || 0;

        db.get(
          "SELECT IFNULL(SUM(settled_amnt), 0) AS settled_total FROM settlements",
          [],
          (e3, row3) => {
            if (e3) return res.status(500).json({ error: "DB error" });

            out.settled_total = Number(row3?.settled_total || 0);

            db.all(
              "SELECT order_id, customer_id, order_amount, status_id, order_date FROM orders ORDER BY order_date DESC LIMIT 5",
              [],
              (e4, rows4) => {
                out.recentOrders = rows4 || [];
                res.json(out);
              }
            );
          }
        );
      });
    }
  );
});

// ---------- Start Server ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ API running on port ${PORT}`));

module.exports = app;

