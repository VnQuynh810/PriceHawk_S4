import "server-only";
import db from "@/server/db/pool";

export async function insertDiscoverySeedsBatch(entries) {
  if (!entries || entries.length === 0) return 0;

  const placeholders = entries.map(() => "(?, ?, ?, ?, ?, 'pending')").join(", ");
  const params = [];
  for (const e of entries) {
    params.push(
      e.seedType,
      e.queryOrUrl.slice(0, 500),
      e.categoryHint || null,
      e.origin || "admin_seed",
      e.priority ?? 5
    );
  }

  const res = await db.query(
    `INSERT INTO discovery_queue
       (seed_type, query_or_url, category_hint, origin, priority, status)
     VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE
       status = IF(
         VALUES(origin) = 'admin_seed'
         OR (status IN ('empty', 'failed') AND (processed_at IS NULL OR processed_at < DATE_SUB(NOW(), INTERVAL 24 HOUR))),
         'pending',
         status
       ),
       priority = LEAST(priority, VALUES(priority))`,
    params
  );
  return Number(res?.affectedRows || entries.length);
}

export async function incrementProductViewCount(productId) {
  return db.query(
    "UPDATE product SET view_count = view_count + 1, last_viewed_at = NOW() WHERE id = ?",
    [productId]
  );
}

export async function fetchPoolOverviewStats() {
  try {
    const [tierRows, queueGroupRows, recentQueue] = await Promise.all([
      db.query(
        `SELECT
           COUNT(*) AS totalProducts,
           SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS activeProducts,
           SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) AS dormantProducts,
           SUM(CASE WHEN is_active = 1 AND retailer_count >= 2 THEN 1 ELSE 0 END) AS multiRetailerProducts,
           SUM(CASE
             WHEN is_active = 1 AND (
               EXISTS (SELECT 1 FROM price_alert pa WHERE pa.product_id = product.id AND pa.status = 'active')
               OR EXISTS (SELECT 1 FROM wishlist w WHERE w.product_id = product.id)
             ) THEN 1 ELSE 0
           END) AS hotProducts,
           SUM(CASE
             WHEN is_active = 1
               AND NOT EXISTS (SELECT 1 FROM price_alert pa WHERE pa.product_id = product.id AND pa.status = 'active')
               AND NOT EXISTS (SELECT 1 FROM wishlist w WHERE w.product_id = product.id)
               AND (
                 (last_viewed_at IS NOT NULL AND last_viewed_at >= DATE_SUB(NOW(), INTERVAL 7 DAY))
                 OR (updated_at IS NOT NULL AND updated_at >= DATE_SUB(NOW(), INTERVAL 14 DAY))
               )
             THEN 1 ELSE 0
           END) AS warmProducts
         FROM product`
      ),
      db.query(
        "SELECT status, COUNT(*) AS cnt FROM discovery_queue GROUP BY status"
      ),
      db.query(
        `SELECT id, seed_type, query_or_url, category_hint, origin, priority, status,
                matched_urls_count, attempts, last_error, created_at, processed_at
         FROM discovery_queue
         ORDER BY FIELD(status, 'processing', 'pending', 'completed', 'empty', 'failed'), id DESC
         LIMIT 30`
      ),
    ]);

    const t = tierRows?.[0] || {};
    const active = Number(t.activeProducts || 0);
    const hot = Number(t.hotProducts || 0);
    const warm = Number(t.warmProducts || 0);
    const cold = Math.max(0, active - hot - warm);

    const queueStats = { pending: 0, processing: 0, completed: 0, empty: 0, failed: 0 };
    for (const r of queueGroupRows || []) {
      if (r.status in queueStats) {
        queueStats[r.status] = Number(r.cnt || 0);
      }
    }

    return {
      totalProducts: Number(t.totalProducts || 0),
      activeProducts: active,
      dormantProducts: Number(t.dormantProducts || 0),
      multiRetailerProducts: Number(t.multiRetailerProducts || 0),
      hotProducts: hot,
      warmProducts: warm,
      coldProducts: cold,
      queueStats,
      recentQueue: recentQueue || [],
    };
  } catch (err) {
    if (err.code === "ER_NO_SUCH_TABLE" || err.code === "ER_BAD_FIELD_ERROR") {
      return {
        totalProducts: 0,
        activeProducts: 0,
        dormantProducts: 0,
        multiRetailerProducts: 0,
        hotProducts: 0,
        warmProducts: 0,
        coldProducts: 0,
        queueStats: { pending: 0, processing: 0, completed: 0, empty: 0, failed: 0 },
        recentQueue: [],
      };
    }
    throw err;
  }
}

export async function deleteDiscoverySeed(id) {
  const res = await db.query("DELETE FROM discovery_queue WHERE id = ?", [id]);
  return Number(res?.affectedRows || 0);
}

export async function purgeCompletedDiscoverySeeds() {
  const res = await db.query(
    "DELETE FROM discovery_queue WHERE status IN ('completed', 'empty', 'failed')"
  );
  return Number(res?.affectedRows || 0);
}
