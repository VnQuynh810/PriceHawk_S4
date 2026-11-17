import "server-only";
import db from "@/server/db/pool";

export async function findUserByEmail(email) {
  const rows = await db.query(
    "SELECT id, email, password_hash, role, provider FROM users WHERE email = ? LIMIT 1",
    [email]
  );
  return rows?.[0] ?? null;
}

export async function findUserByOAuthProvider(provider, providerAccountId) {
  const rows = await db.query(
    "SELECT id, role FROM users WHERE provider = ? AND provider_id = ? LIMIT 1",
    [provider, providerAccountId]
  );
  return rows?.[0] ?? null;
}

export async function findCredentialUserByEmail(email) {
  const rows = await db.query(
    "SELECT id FROM users WHERE email = ? AND provider IS NULL LIMIT 1",
    [email]
  );
  return rows?.[0] ?? null;
}

export async function createCredentialUser(email, passwordHash) {
  const result = await db.query(
    "INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'user')",
    [email, passwordHash]
  );
  return result.insertId;
}

export async function createOAuthUser(email, provider, providerAccountId) {
  const result = await db.query(
    `INSERT INTO users (email, password_hash, role, provider, provider_id)
     VALUES (?, NULL, 'user', ?, ?)`,
    [email, provider, providerAccountId]
  );
  return result.insertId;
}

export async function listUsersWithStats() {
  return db.query(
    `SELECT
       u.id,
       u.email,
       u.role,
       u.created_at,
       COUNT(DISTINCT w.id)  AS wishlist_count,
       COUNT(DISTINCT pa.id) AS alert_count
     FROM users u
     LEFT JOIN wishlist    w  ON w.user_id  = u.id
     LEFT JOIN price_alert pa ON pa.user_id = u.id
     GROUP BY u.id, u.email, u.role, u.created_at
     ORDER BY u.created_at DESC`
  );
}
