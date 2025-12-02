// auth.js
const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

function createAuthRouter(db) {
  const router = express.Router();

  const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_USER,
    SMTP_PASS,
    APP_BASE_URL = "https://storefrontsolutions.shop"
  } = process.env;

  // Transport for verification emails
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: false,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  });

  async function sendVerificationEmail(toEmail, token) {
    const verifyUrl = `${APP_BASE_URL}/auth/verify-email?token=${encodeURIComponent(
      token
    )}`;

    const htmlBody = `
      <p>Thanks for signing up with Storefront Solutions!</p>
      <p>Click the link below to verify your email address:</p>
      <p><a href="${verifyUrl}">${verifyUrl}</a></p>
      <p>If you did not request this, you can ignore this email.</p>
    `;

    await transporter.sendMail({
      from: `"Storefront Solutions" <${SMTP_USER}>`,
      to: toEmail,
      subject: "Verify your email address",
      html: htmlBody
    });
  }

  // ==================================
  //        POST /auth/register
  // ==================================
  router.post("/register", (req, res) => {
    const {
      email,
      username,
      password,
      full_name,
      address_line1,
      address_line2,
      city,
      state,
      zip_code
    } = req.body || {};

    // Basic validation
    if (
      !email ||
      !username ||
      !password ||
      !full_name ||
      !address_line1 ||
      !city ||
      !state ||
      !zip_code
    ) {
      return res.status(400).json({
        error:
          "Missing one or more required fields: email, username, password, full_name, address_line1, city, state, zip_code."
      });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanUsername = String(username).trim().toLowerCase();
    const passwordHash = bcrypt.hashSync(password, 10);
    const verifyToken = crypto.randomBytes(32).toString("hex");

    // (Optional) Check for duplicate email/username first
    db.get(
      `
      SELECT customer_id
      FROM customers
      WHERE LOWER(email) = ? OR LOWER(username) = ?
    `,
      [cleanEmail, cleanUsername],
      (err, existing) => {
        if (err) {
          console.error("DB read error in /auth/register:", err);
          return res.status(500).json({ error: "Database read error" });
        }
        if (existing) {
          return res.status(409).json({
            error:
              "An account with that email or username already exists. Use a different email/username."
          });
        }

        // Insert new customer with login fields
        const sql = `
          INSERT INTO customers (
            full_name,
            address_line1,
            address_line2,
            city,
            state,
            zip_code,
            email,
            username,
            password_hash,
            verify_token
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        db.run(
          sql,
          [
            full_name,
            address_line1,
            address_line2 || null,
            city || null,
            state || null,
            zip_code,
            cleanEmail,
            cleanUsername,
            passwordHash,
            verifyToken
          ],
          function (insertErr) {
            if (insertErr) {
              console.error("DB write error in /auth/register:", insertErr);
              return res.status(500).json({ error: "Database write error" });
            }

            const customerId = this.lastID;

            // Try to send verification email
            sendVerificationEmail(cleanEmail, verifyToken)
              .then(() => {
                res.status(201).json({
                  ok: true,
                  customerId,
                  email: cleanEmail,
                  username: cleanUsername,
                  message:
                    "Account created. Check your email to verify your address."
                });
              })
              .catch((mailErr) => {
                console.error(
                  "Email send error in /auth/register (continuing):",
                  mailErr
                );
                // Still succeed account creation for project
                res.status(201).json({
                  ok: true,
                  customerId,
                  email: cleanEmail,
                  username: cleanUsername,
                  warning:
                    "Account created, but verification email could not be sent in this environment."
                });
              });
          }
        );
      }
    );
  });

  // ==================================
  //        POST /auth/login
  // ==================================
  router.post("/login", (req, res) => {
    const { usernameOrEmail, password } = req.body || {};
    if (!usernameOrEmail || !password) {
      return res
        .status(400)
        .json({ error: "Missing usernameOrEmail or password." });
    }

    const lookup = String(usernameOrEmail).trim().toLowerCase();

    db.get(
      `
      SELECT customer_id,
             full_name,
             email,
             username,
             password_hash,
             is_verified
      FROM customers
      WHERE LOWER(email) = ? OR LOWER(username) = ?
    `,
      [lookup, lookup],
      (err, user) => {
        if (err) {
          console.error("DB read error in /auth/login:", err);
          return res.status(500).json({ error: "Database read error" });
        }
        if (!user || !user.password_hash) {
          return res.status(401).json({ error: "Invalid credentials." });
        }

        const ok = bcrypt.compareSync(password, user.password_hash);
        if (!ok) return res.status(401).json({ error: "Invalid credentials." });

        if (!user.is_verified) {
          return res.status(403).json({
            error: "Email not verified. Check your inbox.",
            needsVerification: true
          });
        }
        return res.json({
          ok: true,
          user: {
            customerId: user.customer_id,
            full_name: user.full_name,
            email: user.email,
            username: user.username
          }
        });
      }
    );
  });

  // ==================================
  //    GET /auth/verify-email?token=
  // ==================================
  router.get("/verify-email", (req, res) => {
    const { token } = req.query;
    if (!token) {
      return res.status(400).json({ error: "Missing verification token." });
    }

    db.get(
      "SELECT customer_id FROM customers WHERE verify_token = ?",
      [token],
      (err, row) => {
        if (err) {
          console.error("DB read error in /auth/verify-email:", err);
          return res.status(500).json({ error: "Database read error" });
        }

        if (!row) {
          return res
            .status(400)
            .json({ error: "Invalid or expired verification token." });
        }

        db.run(
          `
          UPDATE customers
          SET is_verified = 1,
              verify_token = NULL
          WHERE customer_id = ?
        `,
          [row.customer_id],
          (updateErr) => {
            if (updateErr) {
              console.error(
                "DB write error in /auth/verify-email:",
                updateErr
              );
              return res.status(500).json({ error: "Database write error" });
            }

            // For now, simple JSON response is fine
            return res.json({
              ok: true,
              message: "Email verified successfully. You can now log in."
            });
          }
        );
      }
    );
  });

  return router;
}

module.exports = createAuthRouter;
