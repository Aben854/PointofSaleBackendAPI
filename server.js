// ===============================
// CAPSTONE BACKEND – UNIFIED SERVER.JS
// Render-ready + Auth Register + Email Verification (SendGrid Web API)
// ===============================

require("dotenv").config({ quiet: true });

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");
const path = require("path");
const YAML = require("yamljs");
const swaggerUi = require("swagger-ui-express");
const crypto = require("crypto");

// ---------------------------------
// Env + Logging
// ---------------------------------
const IS_TEST = process.env.NODE_ENV === "test";
const log = (...args) => {
  if (!IS_TEST) console.log(...args);
};

// ---------------------------------
// App Setup
// ---------------------------------
const app = express();
app.set("trust proxy", 1);

// Middleware
app.use(express.json());
app.use(cors());
app.use(
  helmet({
    // allow inline scripts in admin.html
    contentSecurityPolicy: false
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

// ---------------------------------
// Database Setup
// ---------------------------------
const DB_FILE = process.env.DB_FILE || path.join(__dirname, "ecommerce.db");
const INIT_SQL = path.join(__dirname, "init-sqlite.sql");

const dbExists = fs.existsSync(DB_FILE);
const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) {
    console.error("❌ DB Error:", err.message);
  } else {
    log("📦 Database loaded:", DB_FILE);
  }
});

// initialize schema from init-sqlite.sql on first run
if (!dbExists && fs.existsSync(INIT_SQL)) {
  const schema = fs.readFileSync(INIT_SQL, "utf8");
  db.exec(schema, (err) => {
    if (err) {
      console.error("❌ Schema Error:", err.message);
    } else {
      log("✅ Database initialized from init-sqlite.sql");
    }
  });
}

// Ensure authorization table has auth_token + auth_expires_at columns
function ensureAuthorizationTokenColumns() {
  db.all("PRAGMA table_info(authorizations)", (err, rows) => {
    if (err) {
      console.error("⚠️ Unable to inspect authorizations table:", err.message);
      return;
    }
    const names = rows.map((r) => r.name);
    const tasks = [];

    if (!names.includes("auth_token")) {
      tasks.push(
        new Promise((resolve) => {
          db.run(
            "ALTER TABLE authorizations ADD COLUMN auth_token TEXT",
            (e) => {
              if (e) {
                console.error("⚠️ Could not add auth_token column:", e.message);
              } else {
                log("🗄️ Added auth_token column to authorizations table.");
              }
              resolve();
            }
          );
        })
      );
    }

    if (!names.includes("auth_expires_at")) {
      tasks.push(
        new Promise((resolve) => {
          db.run(
            "ALTER TABLE authorizations ADD COLUMN auth_expires_at DATETIME",
            (e) => {
              if (e) {
                console.error(
                  "⚠️ Could not add auth_expires_at column:",
                  e.message
                );
              } else {
                log("🗄️ Added auth_expires_at column to authorizations table.");
              }
              resolve();
            }
          );
        })
      );
    }

    if (tasks.length) {
      Promise.all(tasks).then(() => {
        log("✅ Authorization table checked/updated for token columns.");
      });
    } else {
      log("✅ Authorization table already has token columns.");
    }
  });
}

ensureAuthorizationTokenColumns();

// ---------------------------------
// Auth Router
// ---------------------------------
const createAuthRouter = require("./auth");
app.use("/auth", createAuthRouter(db));

// ---------------------------------
// Swagger Docs
// ---------------------------------
const swaggerPath = path.join(__dirname, "openapi.yaml");
if (fs.existsSync(swaggerPath)) {
  const docs = YAML.load(swaggerPath);
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(docs));
  log("📘 Swagger running at /docs");
}

// ---------------------------------
// Static Admin UI
// ---------------------------------
const publicDir = __dirname;
app.use(express.static(publicDir));

app.get("/admin", (req, res) => {
  res.sendFile(path.join(publicDir, "admin.html"));
});

// ---------------------------------
// Health Endpoints
// ---------------------------------
app.get("/", (req, res) => {
  res.json({ ok: true, admin: "/admin", docs: "/docs" });
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/db-health", (req, res) => {
  db.get("SELECT 1 AS result", [], (err, row) => {
    if (err) {
      return res.status(500).json({ db: "down", error: err.message });
    }
    res.json({ db: "up", result: !!row });
  });
});

// ---------------------------------
// Helper: weighted authorization outcome
// ---------------------------------
function pickAuthOutcomeWeighted() {
  const r = Math.random();
  if (r < 0.6) return "SUCCESS";
  if (r < 0.77) return "INSUFFICIENT_FUNDS";
  if (r < 0.94) return "INCORRECT_DETAILS";
  return "SERVER_ERROR";
}

// Helper: generate auth token and expiry (7 days)
function generateAuthToken(orderId) {
  const randomPart = crypto.randomBytes(8).toString("hex");
  const token = `${orderId}_${randomPart}`;

  const expires = new Date();
  expires.setDate(expires.getDate() + 7);
  const expiresAt = expires.toISOString();

  return { token, expiresAt };
}

// Helper: ensure there is at least one authorization for an order
function ensureAuthorizationForOrder(orderId, amount, cb) {
  db.get(
    "SELECT auth_id FROM authorizations WHERE order_id = ? ORDER BY created_at DESC LIMIT 1",
    [orderId],
    (err, row) => {
      if (err) return cb(err);

      if (row) {
        // already has an auth row
        return cb(null, row.auth_id);
      }

      // create a success authorization for settlement
      const { token, expiresAt } = generateAuthToken(orderId);
      db.run(
        `
        INSERT INTO authorizations (
          order_id,
          outcome,
          gateway_code,
          gateway_message,
          amount,
          auth_token,
          auth_expires_at
        ) VALUES (?, 'SUCCESS', '00', 'Approved for settlement', ?, ?, ?)
      `,
        [orderId, amount, token, expiresAt],
        function (err2) {
          if (err2) return cb(err2);
          cb(null, this.lastID);
        }
      );
    }
  );
}

// ============================================
// ORDERS
// ============================================

// List orders (newest first)
app.get("/orders", (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 200;
  const offset = parseInt(req.query.offset, 10) || 0;

  db.all(
    "SELECT * FROM orders ORDER BY created_at DESC LIMIT ? OFFSET ?",
    [limit, offset],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(rows);
    }
  );
});

// Get single order with last auth + last settlement
app.get("/orders/:id", (req, res) => {
  const id = req.params.id;

  db.get("SELECT * FROM orders WHERE order_id = ?", [id], (err, order) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!order) return res.status(404).json({ error: "Order not found" });

    db.get(
      "SELECT * FROM authorizations WHERE order_id = ? ORDER BY created_at DESC LIMIT 1",
      [id],
      (err2, auth) => {
        if (err2) return res.status(500).json({ error: err2.message });

        db.get(
          "SELECT * FROM settlements WHERE order_id = ? ORDER BY settled_at DESC LIMIT 1",
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
  const { orderId, customerId, amount, last4 } = req.body || {};

  // basic validation
  if (!orderId || !customerId || amount == null) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ error: "Invalid amount" });
  }

  // This is the detailed result that your front-end cares about.
  // It returns one of:
  // "SUCCESS", "INSUFFICIENT_FUNDS", "INCORRECT_DETAILS", "SERVER_ERROR"
  const detailedResult = pickAuthOutcomeWeighted();

  // Map detailed result to ORDER status
  // (what gets stored in orders.status)
  const orderStatus =
    detailedResult === "SUCCESS"
      ? "AUTHORIZED"
      : detailedResult === "INSUFFICIENT_FUNDS" ||
        detailedResult === "INCORRECT_DETAILS"
      ? "DECLINED"
      : "ERROR";

  // Map to the limited set allowed by the CHECK constraint on
  // authorizations.outcome: 'SUCCESS', 'DECLINED', 'ERROR'
  const authOutcome =
    orderStatus === "AUTHORIZED"
      ? "SUCCESS"
      : orderStatus === "DECLINED"
      ? "DECLINED"
      : "ERROR";

  // Use gateway_code / gateway_message to store the specific reason
  let gatewayCode = "00";
  let gatewayMessage = "Approved";

  switch (detailedResult) {
    case "SUCCESS":
      gatewayCode = "00";
      gatewayMessage = "Approved";
      break;
    case "INSUFFICIENT_FUNDS":
      gatewayCode = "51";
      gatewayMessage = "Insufficient funds";
      break;
    case "INCORRECT_DETAILS":
      gatewayCode = "14";
      gatewayMessage = "Incorrect card details";
      break;
    case "SERVER_ERROR":
    default:
      gatewayCode = "XX";
      gatewayMessage = "Authorization server error";
      break;
  }

  // Upsert into orders (matches init-sqlite.sql: status, total_amount)
  db.run(
    `
      INSERT INTO orders (order_id, customer_id, status, total_amount)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(order_id) DO UPDATE SET
        customer_id  = excluded.customer_id,
        status       = excluded.status,
        total_amount = excluded.total_amount,
        updated_at   = CURRENT_TIMESTAMP
    `,
    [orderId, customerId, orderStatus, numericAmount],
    (orderErr) => {
      if (orderErr) {
        console.error("DB write error in /orders/checkout (orders):", orderErr);
        return res.status(500).json({ error: "Database write error (orders)" });
      }

      // Insert into authorizations (matches init-sqlite.sql)
      db.run(
        `
          INSERT INTO authorizations (
            order_id,
            outcome,
            gateway_code,
            gateway_message,
            amount
          )
          VALUES (?, ?, ?, ?, ?)
        `,
        [orderId, authOutcome, gatewayCode, gatewayMessage, numericAmount],
        (authErr) => {
          if (authErr) {
            console.error(
              "DB write error in /orders/checkout (authorizations):",
              authErr
            );
            return res
              .status(500)
              .json({ error: "Database write error (authorizations)" });
          }

          // Send detailed result back to the frontend so it can show
          // SUCCESS / INSUFFICIENT_FUNDS / INCORRECT_DETAILS / SERVER_ERROR
          return res.json({
            orderId,
            result: detailedResult, // what paymentauthorization.html uses
            status: orderStatus,    // AUTHORIZED / DECLINED / ERROR
            outcome: authOutcome    // SUCCESS / DECLINED / ERROR (DB-safe)
          });
        }
      );
    }
  );
});


// ============================================
// PAYMENT SETTLEMENT
// ============================================
//
// Expects JSON body: { orderId, amount }
//
app.post("/payments/settle", (req, res) => {
  const { orderId, amount } = req.body;

  if (!orderId || amount == null) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ error: "Invalid amount" });
  }

  db.get(
    "SELECT order_id, status, total_amount FROM orders WHERE order_id = ?",
    [orderId],
    (err, order) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!order) return res.status(404).json({ error: "Order not found" });

      if (order.status !== "AUTHORIZED") {
        return res
          .status(400)
          .json({ error: "Order not authorized, cannot settle" });
      }

      // ensure there is at least one authorization (for audit)
      ensureAuthorizationForOrder(orderId, order.total_amount, (authErr) => {
        if (authErr) {
          return res.status(500).json({ error: authErr.message });
        }

        // Insert settlement row
        db.run(
          "INSERT INTO settlements (order_id, amount) VALUES (?, ?)",
          [orderId, numericAmount],
          (err2) => {
            if (err2) return res.status(500).json({ error: err2.message });

            // Update order status to SETTLED
            db.run(
              `
              UPDATE orders
              SET status = 'SETTLED',
                  updated_at = CURRENT_TIMESTAMP
              WHERE order_id = ?
            `,
              [orderId],
              (err3) => {
                if (err3) {
                  return res.status(500).json({ error: err3.message });
                }

                res.json({
                  orderId,
                  paymentStatus: "SETTLED"
                });
              }
            );
          }
        );
      });
    }
  );
});

// ============================================
// STATS
// ============================================
app.get("/stats", (req, res) => {
  const out = { totals: {}, recentOrders: [], settled_total: 0 };

  // Orders per status
  db.all(
    "SELECT status, COUNT(*) AS count FROM orders GROUP BY status",
    [],
    (e1, rows1) => {
      if (e1) return res.status(500).json({ error: e1.message });

      rows1.forEach((r) => {
        out.totals[r.status] = r.count;
      });

      // Total orders
      db.get("SELECT COUNT(*) AS total FROM orders", [], (e2, row2) => {
        out.totals.ALL = row2 ? row2.total : 0;

        // Total settled amount
        db.get(
          "SELECT IFNULL(SUM(amount), 0) AS settled_total FROM settlements",
          [],
          (e3, row3) => {
            if (e3) return res.status(500).json({ error: e3.message });

            out.settled_total = Number(row3 ? row3.settled_total : 0);

            // Recent orders
            db.all(
              "SELECT * FROM orders ORDER BY created_at DESC LIMIT 5",
              [],
              (e4, rows4) => {
                if (e4) return res.status(500).json({ error: e4.message });

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

// ============================================
// SEED ORDERS
// ============================================
app.post("/seed-orders", (req, res) => {
  const sampleOrders = [
    ["ORD9001", 1, "AUTHORIZED", 45.5],
    ["ORD9002", 2, "DECLINED", 78.2],
    ["ORD9003", 3, "SETTLED", 23.99],
    ["ORD9004", 4, "ERROR", 51.77],
    ["ORD9005", 1, "AUTHORIZED", 67.4],
    ["ORD9006", 2, "AUTHORIZED", 15.99],
    ["ORD9007", 3, "DECLINED", 90.1],
    ["ORD9008", 4, "AUTHORIZED", 12.3],
    ["ORD9009", 1, "ERROR", 120.0],
    ["ORD9010", 2, "AUTHORIZED", 44.44]
  ];

  const stmt = db.prepare(
    `
    INSERT INTO orders (order_id, customer_id, status, total_amount)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(order_id) DO UPDATE SET
      customer_id = excluded.customer_id,
      status = excluded.status,
      total_amount = excluded.total_amount,
      updated_at = CURRENT_TIMESTAMP
  `
  );

  sampleOrders.forEach((o) => stmt.run(o));
  stmt.finalize();

  res.json({ message: "10 sample orders added or updated." });
});

// ============================================
// Start Server
// ============================================
if (!IS_TEST) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    log(`✅ API running on port ${PORT}`);
  });
}

module.exports = app;
