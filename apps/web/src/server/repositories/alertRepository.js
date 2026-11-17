import "server-only";
import db from "@/server/db/pool";

export async function findAlertsByUser(userId, status = "all") {
  if (!userId) return [];

  let sql = `
    SELECT
      pa.id,
      pa.product_id,
      pa.target_price,
      pa.current_price,
      pa.note,
      pa.status,
      pa.created_at,
      pa.triggered_at,
      p.name,
      p.brand,
      p.image_url,
      p.current_price AS latest_price
    FROM price_alert pa
    JOIN product p ON pa.product_id = p.id
    WHERE pa.user_id = ?
  `;
  const params = [userId];

  if (status && status !== "all") {
    sql += " AND pa.status = ?";
    params.push(status);
  }

  sql += " ORDER BY pa.created_at DESC";
  return db.query(sql, params);
}

export async function findCheckableAlertsByUser(userId) {
  if (!userId) return [];
  return db.query(
    `SELECT
       pa.id,
       pa.product_id,
       pa.target_price,
       pa.status,
       p.current_price AS latest_price,
       p.name,
       p.brand
     FROM price_alert pa
     JOIN product p ON pa.product_id = p.id
     WHERE pa.user_id = ?
       AND pa.status IN ('active', 'triggered')`,
    [userId]
  );
}

export async function insertPriceAlert({ productId, userId, targetPrice, currentPrice, note }) {
  return db.query(
    `INSERT INTO price_alert (product_id, user_id, target_price, current_price, note, status)
     VALUES (?, ?, ?, ?, ?, 'active')`,
    [productId, userId, targetPrice, currentPrice, note]
  );
}

export async function updatePriceAlertStatus(alertId, userId, status) {
  return db.query(
    "UPDATE price_alert SET status = ? WHERE id = ? AND user_id = ?",
    [status, alertId, userId]
  );
}

export async function deletePriceAlertById(alertId, userId) {
  return db.query(
    "DELETE FROM price_alert WHERE id = ? AND user_id = ?",
    [alertId, userId]
  );
}

/**
 * Atomic single-statement batch trigger for all active alerts across the system.
 * Eliminates the N+1 UPDATE loop.
 */
export async function triggerMetPriceAlertsBatch() {
  const result = await db.query(
    `UPDATE price_alert pa
     JOIN product p ON p.id = pa.product_id
     SET pa.status = 'triggered', pa.triggered_at = NOW()
     WHERE pa.status = 'active'
       AND p.current_price IS NOT NULL
       AND p.current_price <= pa.target_price`
  );
  return Number(result?.affectedRows || 0);
}

/**
 * Lightweight 1-query summary for Navbar badges (replaces dual 5s/10s full-list polling).
 */
export async function getUserNavbarSummary(userId) {
  if (!userId) {
    return { wishlistCount: 0, triggeredAlertCount: 0 };
  }

  const rows = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM wishlist WHERE user_id = ?) AS wishlistCount,
       (SELECT COUNT(*)
        FROM price_alert pa
        JOIN product p ON p.id = pa.product_id
        WHERE pa.user_id = ?
          AND pa.status IN ('active', 'triggered')
          AND p.current_price IS NOT NULL
          AND p.current_price <= pa.target_price) AS triggeredAlertCount`,
    [userId, userId]
  );

  return {
    wishlistCount: Number(rows?.[0]?.wishlistCount || 0),
    triggeredAlertCount: Number(rows?.[0]?.triggeredAlertCount || 0),
  };
}
