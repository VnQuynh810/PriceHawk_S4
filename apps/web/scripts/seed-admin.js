// Standalone CommonJS Admin Seeder Script
// Usage: node scripts/seed-admin.js <email> <password>

const path = require("path");
try {
  require("dotenv").config({ path: path.resolve(__dirname, "../.env.local") });
  require("dotenv").config({ path: path.resolve(__dirname, "../../../.env.local") });
} catch {}

const bcrypt = require("bcryptjs");
const mysql = require("mysql2/promise");

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const password = process.argv[3];

  if (!email || !password) {
    console.error("Usage: node scripts/seed-admin.js <email> <password>");
    process.exit(1);
  }

  if (password.length < 6) {
    console.error("Password phải có ít nhất 6 ký tự.");
    process.exit(1);
  }

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: parseInt(process.env.DB_PORT || "3306", 10),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "pricecomparison",
  });

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    await conn.execute(
      `INSERT INTO users (email, password_hash, role)
       VALUES (?, ?, 'admin')
       ON DUPLICATE KEY UPDATE
         role = 'admin',
         password_hash = VALUES(password_hash)`,
      [email, passwordHash]
    );
    console.log(`Admin seeded thành công: ${email}`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("Lỗi seed admin:", err.message);
  process.exit(1);
});
