import "server-only";
import db from "@/server/db/pool";

function buildBooleanFulltextQuery(rawTerm) {
  const tokens = String(rawTerm)
    .trim()
    .replace(/[+\-><()~*"@]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .slice(0, 8);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `+${t}*`).join(" ");
}

export async function countAllProducts() {
  const rows = await db.query("SELECT COUNT(*) AS total FROM product");
  return Number(rows?.[0]?.total || 0);
}

export async function findProductsPage(limit, offset) {
  return db.query(
    `SELECT
       p.id,
       p.name,
       p.description,
       p.image_url,
       p.brand,
       p.current_price,
       p.current_price AS min_price
     FROM product p
     ORDER BY p.id DESC
     LIMIT ? OFFSET ?`,
    [limit, offset]
  );
}

export async function findProductById(id) {
  return db.query(
    `SELECT
       p.*,
       COALESCE(agg.min_price, p.current_price) AS min_price,
       COALESCE(agg.retailer_count, 0) AS retailer_count,
       agg.last_crawled_at AS lastCrawledAt
     FROM product p
     LEFT JOIN (
       SELECT
         product_id,
         MIN(price) AS min_price,
         COUNT(*) AS retailer_count,
         MAX(current_price_at) AS last_crawled_at
       FROM comparison
       WHERE product_id = ?
       GROUP BY product_id
     ) agg ON agg.product_id = p.id
     WHERE p.id = ?
     LIMIT 1`,
    [id, id]
  );
}

export async function searchProductsPage(searchTerm, limit, offset) {
  const boolQuery = buildBooleanFulltextQuery(searchTerm);

  if (boolQuery) {
    try {
      const [countRows, dataRows] = await Promise.all([
        db.query(
          "SELECT COUNT(*) AS count FROM product WHERE MATCH(name, brand) AGAINST (? IN BOOLEAN MODE)",
          [boolQuery]
        ),
        db.query(
          `SELECT
             id, name, description, image_url, brand, current_price,
             MATCH(name, brand) AGAINST (? IN BOOLEAN MODE) AS relevance
           FROM product
           WHERE MATCH(name, brand) AGAINST (? IN BOOLEAN MODE)
           ORDER BY relevance DESC, current_price ASC
           LIMIT ? OFFSET ?`,
          [boolQuery, boolQuery, limit, offset]
        ),
      ]);

      const totalCount = Number(countRows?.[0]?.count || 0);
      if (totalCount > 0) {
        return { totalCount, data: dataRows };
      }
    } catch {
      // Gracefully fallback to parameterized LIKE if FULLTEXT index is not yet created
    }
  }

  const escaped = String(searchTerm).replace(/[\\%_]/g, "\\$&");
  const likePattern = `%${escaped}%`;
  const [countRows, dataRows] = await Promise.all([
    db.query("SELECT COUNT(*) AS count FROM product WHERE name LIKE ? OR brand LIKE ?", [
      likePattern,
      likePattern,
    ]),
    db.query(
      `SELECT id, name, description, image_url, brand, current_price
       FROM product
       WHERE name LIKE ? OR brand LIKE ?
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      [likePattern, likePattern, limit, offset]
    ),
  ]);

  return {
    totalCount: Number(countRows?.[0]?.count || 0),
    data: dataRows,
  };
}

export async function findComparisonsByProductId(productId) {
  return db.query(
    `SELECT
       id,
       product_id,
       url,
       name,
       price,
       min_price,
       min_price_at,
       current_price_at
     FROM comparison
     WHERE product_id = ?
     ORDER BY price ASC`,
    [productId]
  );
}

export async function findAllTimeMaxPrice(productId) {
  const rows = await db.query(
    "SELECT MAX(price) AS allTimeMax FROM price_history WHERE product_id = ?",
    [productId]
  );
  const val = rows?.[0]?.allTimeMax;
  return val !== null && val !== undefined ? Number(val) : null;
}

export async function findPriceHistoryData(productId, days) {
  const halfDays = Math.max(1, Math.ceil(days / 2));

  const rawSql = `
    SELECT
      DATE(recorded_at) AS day,
      YEARWEEK(recorded_at, 1) AS yearweek,
      DATE(DATE_SUB(recorded_at, INTERVAL WEEKDAY(recorded_at) DAY)) AS week_start,
      price,
      retailer
    FROM price_history
    WHERE product_id = ?
      AND recorded_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    ORDER BY recorded_at DESC
  `;

  // Fixed parameter order: [halfDays, days, halfDays, productId, days]
  const periodChangeSql = `
    SELECT
      MIN(CASE WHEN recorded_at >= DATE_SUB(NOW(), INTERVAL ? DAY) THEN price ELSE NULL END) AS this_period_min,
      MIN(CASE WHEN recorded_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
                AND recorded_at <  DATE_SUB(NOW(), INTERVAL ? DAY) THEN price ELSE NULL END) AS prev_period_min
    FROM price_history
    WHERE product_id = ?
      AND recorded_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
  `;

  const [rawRows, periodChangeRows] = await Promise.all([
    db.query(rawSql, [productId, days]),
    db.query(periodChangeSql, [halfDays, days, halfDays, productId, days]),
  ]);

  return { rawRows, periodChange: periodChangeRows?.[0] || {} };
}

export async function findProductByIdentityKey(identityKey) {
  const rows = await db.query(
    `SELECT id, name, current_price, brand, image_url, identity_key
     FROM product
     WHERE identity_key = ?
     LIMIT 1`,
    [identityKey]
  );
  return rows?.[0] ?? null;
}

export async function findProductPriceById(productId) {
  const rows = await db.query(
    "SELECT id, current_price FROM product WHERE id = ? LIMIT 1",
    [productId]
  );
  return rows?.[0] ?? null;
}

export async function insertProductFromExtension({
  name,
  currentPrice,
  brandNorm,
  category,
  identityKey,
  sourceUrl,
  retailerName,
}) {
  let result;
  try {
    result = await db.query(
      `INSERT INTO product (name, current_price, brand, category, identity_key, source, retailer_count)
       VALUES (?, ?, ?, ?, ?, 'extension', 1)`,
      [name, currentPrice, brandNorm, category, identityKey]
    );
  } catch (err) {
    // Fallback if database has not run Migration 003 yet
    if (err.code === "ER_BAD_FIELD_ERROR") {
      result = await db.query(
        `INSERT INTO product (name, current_price, brand, identity_key)
         VALUES (?, ?, ?, ?)`,
        [name, currentPrice, brandNorm, identityKey]
      );
    } else {
      throw err;
    }
  }

  const productId = result.insertId;
  if (productId && sourceUrl) {
    await db
      .query(
        `INSERT INTO comparison (product_id, price, url, name, min_price, min_price_at, current_price_at)
         VALUES (?, ?, ?, ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           price = VALUES(price),
           current_price_at = NOW(),
           min_price = CASE WHEN min_price IS NULL OR VALUES(price) < min_price THEN VALUES(price) ELSE min_price END`,
        [productId, currentPrice ?? 0, sourceUrl, retailerName, currentPrice ?? 0]
      )
      .catch(() => {});
  }

  return productId;
}
