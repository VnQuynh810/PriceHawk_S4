import "server-only";
import mysql from "mysql2/promise";

const poolLimit = Math.max(2, Math.min(25, parseInt(process.env.DB_POOL_LIMIT || "10", 10) || 10));

function createMysqlPool() {
  return mysql.createPool({
    host: process.env.DB_HOST || "127.0.0.1",
    port: parseInt(process.env.DB_PORT || "3306", 10),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "pricecomparison",
    charset: "utf8mb4",
    connectionLimit: poolLimit,
    waitForConnections: true,
    queueLimit: 100,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    connectTimeout: 5000,
  });
}

// Singleton across both development HMR and production serverless/standalone workers
const pool = globalThis.__pricehawkMysqlPool || createMysqlPool();
globalThis.__pricehawkMysqlPool = pool;

/**
 * Execute a parameterized SQL query using the shared MySQL2 promise pool.
 * Resolves directly with rows (SELECT) or ResultSetHeader (INSERT/UPDATE/DELETE).
 */
export async function query(sql, params = []) {
  const [results] = await pool.query(sql, params);
  return results;
}

export async function pingDatabase() {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

const db = { query, pingDatabase, pool };
export default db;
