import "server-only";
import db from "@/server/db/pool";

export async function findWishlistByUserId(userId) {
  if (!userId) return [];
  return db.query(
    `SELECT
       w.id,
       w.product_id,
       w.added_at,
       p.name,
       p.brand,
       p.image_url,
       p.current_price
     FROM wishlist w
     JOIN product p ON w.product_id = p.id
     WHERE w.user_id = ?
     ORDER BY w.added_at DESC`,
    [userId]
  );
}

export async function existsWishlistItem(userId, productId) {
  const rows = await db.query(
    "SELECT id FROM wishlist WHERE user_id = ? AND product_id = ? LIMIT 1",
    [userId, productId]
  );
  return rows.length > 0;
}

export async function insertWishlistItem(userId, productId) {
  return db.query(
    "INSERT INTO wishlist (product_id, user_id) VALUES (?, ?)",
    [productId, userId]
  );
}

export async function deleteWishlistItem(userId, productId) {
  return db.query(
    "DELETE FROM wishlist WHERE product_id = ? AND user_id = ?",
    [productId, userId]
  );
}
