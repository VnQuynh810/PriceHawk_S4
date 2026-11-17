-- ============================================================================
-- Migration 003: Performance, Exact VND Pricing (BIGINT) & Scaling Indexes
-- Safe & Idempotent upgrade path for existing PriceHawk S4 production DBs
-- ============================================================================

SET NAMES utf8mb4;

-- 1. Upgrade FLOAT prices to exact BIGINT and normalize product columns
ALTER TABLE `product`
  MODIFY COLUMN `name` VARCHAR(500) NOT NULL,
  MODIFY COLUMN `current_price` BIGINT DEFAULT NULL;

-- Add denormalized columns if not already present (MySQL 8 stored procedure helper)
DROP PROCEDURE IF EXISTS `_ph_mig_003`;
DELIMITER $$
CREATE PROCEDURE `_ph_mig_003`()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product' AND COLUMN_NAME = 'retailer_count') THEN
    ALTER TABLE `product` ADD COLUMN `retailer_count` SMALLINT UNSIGNED NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product' AND COLUMN_NAME = 'category') THEN
    ALTER TABLE `product` ADD COLUMN `category` VARCHAR(50) DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product' AND COLUMN_NAME = 'source') THEN
    ALTER TABLE `product` ADD COLUMN `source` VARCHAR(32) NOT NULL DEFAULT 'crawler';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product' AND COLUMN_NAME = 'updated_at') THEN
    ALTER TABLE `product` ADD COLUMN `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
  END IF;

  -- Indexes on product
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product' AND INDEX_NAME = 'idx_product_current_price') THEN
    ALTER TABLE `product` ADD INDEX `idx_product_current_price` (`current_price`);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product' AND INDEX_NAME = 'idx_product_brand_price') THEN
    ALTER TABLE `product` ADD INDEX `idx_product_brand_price` (`brand`, `current_price`);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product' AND INDEX_NAME = 'idx_product_category_price') THEN
    ALTER TABLE `product` ADD INDEX `idx_product_category_price` (`category`, `current_price`);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product' AND INDEX_NAME = 'ft_product_name_brand') THEN
    ALTER TABLE `product` ADD FULLTEXT INDEX `ft_product_name_brand` (`name`, `brand`) WITH PARSER ngram;
  END IF;

  -- comparison BIGINT + url_hash
  ALTER TABLE `comparison`
    MODIFY COLUMN `price` BIGINT NOT NULL,
    MODIFY COLUMN `min_price` BIGINT DEFAULT NULL;

  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'comparison' AND COLUMN_NAME = 'url_hash') THEN
    ALTER TABLE `comparison` ADD COLUMN `url_hash` CHAR(64) GENERATED ALWAYS AS (SHA2(`url`, 256)) STORED;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'comparison' AND INDEX_NAME = 'unique_url_hash') THEN
    ALTER TABLE `comparison` ADD UNIQUE INDEX `unique_url_hash` (`url_hash`);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'comparison' AND INDEX_NAME = 'idx_comparison_product_crawled') THEN
    ALTER TABLE `comparison` ADD INDEX `idx_comparison_product_crawled` (`product_id`, `current_price_at`);
  END IF;

  -- price_history BIGINT + composite indexes
  ALTER TABLE `price_history`
    MODIFY COLUMN `id` BIGINT NOT NULL AUTO_INCREMENT,
    MODIFY COLUMN `price` BIGINT NOT NULL;

  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'price_history' AND INDEX_NAME = 'idx_ph_comp_recorded') THEN
    ALTER TABLE `price_history` ADD INDEX `idx_ph_comp_recorded` (`comparison_id`, `recorded_at` DESC);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'price_history' AND INDEX_NAME = 'idx_ph_prod_recorded_price') THEN
    ALTER TABLE `price_history` ADD INDEX `idx_ph_prod_recorded_price` (`product_id`, `recorded_at`, `price`);
  END IF;

  -- price_alert BIGINT + composite indexes
  ALTER TABLE `price_alert`
    MODIFY COLUMN `target_price` BIGINT NOT NULL,
    MODIFY COLUMN `current_price` BIGINT DEFAULT NULL;

  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'price_alert' AND INDEX_NAME = 'idx_alert_user_status') THEN
    ALTER TABLE `price_alert` ADD INDEX `idx_alert_user_status` (`user_id`, `status`);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'price_alert' AND INDEX_NAME = 'idx_alert_status_product') THEN
    ALTER TABLE `price_alert` ADD INDEX `idx_alert_status_product` (`status`, `product_id`, `target_price`);
  END IF;
END$$
DELIMITER ;

CALL `_ph_mig_003`();
DROP PROCEDURE IF EXISTS `_ph_mig_003`;

-- 2. Backfill accurate MIN(price) and retailer_count for all existing products
UPDATE `product` p
LEFT JOIN (
  SELECT `product_id`, MIN(`price`) AS `min_p`, COUNT(*) AS `cnt`
  FROM `comparison`
  GROUP BY `product_id`
) agg ON agg.`product_id` = p.`id`
SET
  p.`current_price`  = COALESCE(agg.`min_p`, p.`current_price`),
  p.`retailer_count` = COALESCE(agg.`cnt`, 0);
