-- ============================================================================
-- Migration 005: Autonomous Self-Expanding Product Pool & Temperature Lifecycle
-- Idempotent upgrade for existing PriceHawk S4 databases
-- ============================================================================

SET NAMES utf8mb4;

DROP PROCEDURE IF EXISTS `_ph_mig_005`;
DELIMITER $$
CREATE PROCEDURE `_ph_mig_005`()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product' AND COLUMN_NAME = 'view_count') THEN
    ALTER TABLE `product` ADD COLUMN `view_count` INT UNSIGNED NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product' AND COLUMN_NAME = 'last_viewed_at') THEN
    ALTER TABLE `product` ADD COLUMN `last_viewed_at` TIMESTAMP NULL DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product' AND COLUMN_NAME = 'is_active') THEN
    ALTER TABLE `product` ADD COLUMN `is_active` TINYINT(1) NOT NULL DEFAULT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product' AND COLUMN_NAME = 'enriched_at') THEN
    ALTER TABLE `product` ADD COLUMN `enriched_at` TIMESTAMP NULL DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product' AND INDEX_NAME = 'idx_product_pool_enrichment') THEN
    ALTER TABLE `product` ADD INDEX `idx_product_pool_enrichment` (`is_active`, `retailer_count`, `enriched_at`);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'comparison' AND COLUMN_NAME = 'in_stock') THEN
    ALTER TABLE `comparison` ADD COLUMN `in_stock` TINYINT(1) NOT NULL DEFAULT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'comparison' AND COLUMN_NAME = 'fail_count') THEN
    ALTER TABLE `comparison` ADD COLUMN `fail_count` TINYINT UNSIGNED NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'comparison' AND INDEX_NAME = 'idx_comparison_refresh') THEN
    ALTER TABLE `comparison` ADD INDEX `idx_comparison_refresh` (`current_price_at`, `fail_count`);
  END IF;
END$$
DELIMITER ;

CALL `_ph_mig_005`();
DROP PROCEDURE IF EXISTS `_ph_mig_005`;

CREATE TABLE IF NOT EXISTS `discovery_queue` (
  `id`                 BIGINT            NOT NULL AUTO_INCREMENT,
  `seed_type`          ENUM('keyword','url') NOT NULL DEFAULT 'keyword',
  `query_or_url`       VARCHAR(512)      NOT NULL,
  `normalized_key`     CHAR(64)          GENERATED ALWAYS AS (SHA2(LOWER(TRIM(`query_or_url`)), 256)) STORED,
  `category_hint`      VARCHAR(50)       DEFAULT NULL,
  `origin`             ENUM('admin_seed','user_search','chatbot_miss','cross_store_enrich','extension') NOT NULL DEFAULT 'admin_seed',
  `priority`           TINYINT UNSIGNED  NOT NULL DEFAULT 5,
  `status`             ENUM('pending','processing','completed','empty','failed') NOT NULL DEFAULT 'pending',
  `matched_urls_count` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `attempts`           TINYINT UNSIGNED  NOT NULL DEFAULT 0,
  `last_error`         VARCHAR(500)      DEFAULT NULL,
  `created_at`         TIMESTAMP         NULL DEFAULT CURRENT_TIMESTAMP,
  `processed_at`       TIMESTAMP         NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_discovery_seed` (`normalized_key`),
  KEY `idx_discovery_pending` (`status`, `priority`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
