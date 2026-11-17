-- ============================================================================
-- PriceHawk S4 v2.1 — Clean Canonical Database Schema (MySQL 8.0+, UTF8MB4)
-- Includes Core Catalog, Exact BIGINT VND Pricing, FULLTEXT & Dynamic Crawl Registry
-- ============================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `users` (
  `id`            INT          NOT NULL AUTO_INCREMENT,
  `email`         VARCHAR(255) NOT NULL,
  `password_hash` VARCHAR(255) DEFAULT NULL,
  `role`          ENUM('guest','user','paidUser','admin') NOT NULL DEFAULT 'user',
  `provider`      VARCHAR(50)  DEFAULT NULL,
  `provider_id`   VARCHAR(255) DEFAULT NULL,
  `created_at`    TIMESTAMP    NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_email` (`email`),
  UNIQUE KEY `unique_provider` (`provider`, `provider_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `product` (
  `id`             INT               NOT NULL AUTO_INCREMENT,
  `identity_key`   VARCHAR(255)      NOT NULL,
  `name`           VARCHAR(500)      NOT NULL,
  `description`    TEXT              DEFAULT NULL,
  `image_url`      TEXT              DEFAULT NULL,
  `brand`          VARCHAR(100)      DEFAULT NULL,
  `category`       VARCHAR(50)       DEFAULT NULL,
  `current_price`  BIGINT            DEFAULT NULL,
  `retailer_count` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `source`         VARCHAR(32)       NOT NULL DEFAULT 'crawler',
  `view_count`     INT UNSIGNED      NOT NULL DEFAULT 0,
  `last_viewed_at` TIMESTAMP         NULL DEFAULT NULL,
  `is_active`      TINYINT(1)        NOT NULL DEFAULT 1,
  `enriched_at`    TIMESTAMP         NULL DEFAULT NULL,
  `updated_at`     TIMESTAMP         NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_identity_key` (`identity_key`),
  KEY `idx_product_current_price` (`current_price`),
  KEY `idx_product_brand_price` (`brand`, `current_price`),
  KEY `idx_product_category_price` (`category`, `current_price`),
  KEY `idx_product_pool_enrichment` (`is_active`, `retailer_count`, `enriched_at`),
  FULLTEXT KEY `ft_product_name_brand` (`name`, `brand`) WITH PARSER ngram
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `comparison` (
  `id`               INT          NOT NULL AUTO_INCREMENT,
  `product_id`       INT          NOT NULL,
  `price`            BIGINT       NOT NULL,
  `url`              TEXT         NOT NULL,
  `url_hash`         CHAR(64)     GENERATED ALWAYS AS (SHA2(`url`, 256)) STORED,
  `name`             VARCHAR(100) NOT NULL,
  `min_price`        BIGINT            DEFAULT NULL,
  `min_price_at`     TIMESTAMP         NULL DEFAULT NULL,
  `current_price_at` TIMESTAMP         NULL DEFAULT CURRENT_TIMESTAMP,
  `in_stock`         TINYINT(1)        NOT NULL DEFAULT 1,
  `fail_count`       TINYINT UNSIGNED  NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_url_hash` (`url_hash`),
  KEY `idx_comparison_product_price` (`product_id`, `price`),
  KEY `idx_comparison_product_crawled` (`product_id`, `current_price_at`),
  KEY `idx_comparison_refresh` (`current_price_at`, `fail_count`),
  CONSTRAINT `comparison_product_fk` FOREIGN KEY (`product_id`) REFERENCES `product` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `price_history` (
  `id`            BIGINT       NOT NULL AUTO_INCREMENT,
  `product_id`    INT          NOT NULL,
  `comparison_id` INT          DEFAULT NULL,
  `price`         BIGINT       NOT NULL,
  `retailer`      VARCHAR(100) DEFAULT NULL,
  `recorded_at`   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ph_comp_recorded` (`comparison_id`, `recorded_at` DESC),
  KEY `idx_ph_prod_recorded_price` (`product_id`, `recorded_at`, `price`),
  CONSTRAINT `price_history_product_fk` FOREIGN KEY (`product_id`) REFERENCES `product` (`id`) ON DELETE CASCADE,
  CONSTRAINT `price_history_comparison_fk` FOREIGN KEY (`comparison_id`) REFERENCES `comparison` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `wishlist` (
  `id`         INT       NOT NULL AUTO_INCREMENT,
  `product_id` INT       NOT NULL,
  `user_id`    INT       DEFAULT NULL,
  `added_at`   TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_wishlist_item` (`product_id`, `user_id`),
  KEY `wishlist_user_fk` (`user_id`, `added_at` DESC),
  CONSTRAINT `wishlist_product_fk` FOREIGN KEY (`product_id`) REFERENCES `product` (`id`) ON DELETE CASCADE,
  CONSTRAINT `wishlist_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `price_alert` (
  `id`            INT       NOT NULL AUTO_INCREMENT,
  `product_id`    INT       NOT NULL,
  `user_id`       INT       DEFAULT NULL,
  `target_price`  BIGINT    NOT NULL,
  `current_price` BIGINT    DEFAULT NULL,
  `note`          TEXT      DEFAULT NULL,
  `status`        ENUM('active','inactive','triggered') NOT NULL DEFAULT 'active',
  `created_at`    TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `triggered_at`  TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_user_product_alert` (`user_id`, `product_id`),
  KEY `idx_alert_user_status` (`user_id`, `status`),
  KEY `idx_alert_status_product` (`status`, `product_id`, `target_price`),
  CONSTRAINT `price_alert_product_fk` FOREIGN KEY (`product_id`) REFERENCES `product` (`id`) ON DELETE CASCADE,
  CONSTRAINT `price_alert_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── Dynamic Multi-Site Crawler Registry ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS `crawl_source` (
  `id`                     INT               NOT NULL AUTO_INCREMENT,
  `code`                   VARCHAR(64)       NOT NULL,
  `name`                   VARCHAR(120)      NOT NULL,
  `domain`                 VARCHAR(255)      NOT NULL,
  `discovery_mode`         ENUM('builtin_spider','sitemap','html_listing','json_api','playwright_listing') NOT NULL DEFAULT 'sitemap',
  `spider_name`            VARCHAR(64)       DEFAULT 'universal_catalog',
  `start_urls`             JSON              NOT NULL,
  `url_include_pattern`    VARCHAR(255)      DEFAULT NULL,
  `url_exclude_pattern`    VARCHAR(255)      DEFAULT NULL,
  `selectors_json`         JSON              DEFAULT NULL,
  `render_mode`            ENUM('http','auto_escalate','playwright') NOT NULL DEFAULT 'auto_escalate',
  `default_category`       VARCHAR(50)       DEFAULT NULL,
  `priority`               TINYINT UNSIGNED  NOT NULL DEFAULT 5,
  `crawl_interval_minutes` INT UNSIGNED      NOT NULL DEFAULT 30,
  `request_delay_ms`       INT UNSIGNED      NOT NULL DEFAULT 300,
  `max_items_per_run`      INT UNSIGNED      NOT NULL DEFAULT 1500,
  `proxy_url`              VARCHAR(255)      DEFAULT NULL,
  `enabled`                TINYINT(1)        NOT NULL DEFAULT 1,
  `last_status`            ENUM('idle','running','success','partial','failed') NOT NULL DEFAULT 'idle',
  `last_item_count`        INT UNSIGNED      NOT NULL DEFAULT 0,
  `last_error`             TEXT              DEFAULT NULL,
  `consecutive_failures`   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `last_crawled_at`        TIMESTAMP         NULL DEFAULT NULL,
  `next_run_at`            TIMESTAMP         NULL DEFAULT NULL,
  `created_at`             TIMESTAMP         NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`             TIMESTAMP         NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_source_code` (`code`),
  KEY `idx_source_schedule` (`enabled`, `next_run_at`, `priority`),
  KEY `idx_source_domain` (`domain`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── Incremental Sitemap <lastmod> & Conditional Fetch State ──────────────────
CREATE TABLE IF NOT EXISTS `crawl_url_state` (
  `url_hash`        CHAR(64)     NOT NULL,
  `source_code`     VARCHAR(64)  NOT NULL,
  `url`             TEXT         NOT NULL,
  `sitemap_lastmod` VARCHAR(64)  DEFAULT NULL,
  `etag`            VARCHAR(128) DEFAULT NULL,
  `last_fetched_at` TIMESTAMP    NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`url_hash`),
  KEY `idx_url_state_source` (`source_code`, `last_fetched_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── Autonomous Self-Expanding Product Pool Discovery Queue ───────────────────
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

-- ── Pre-seed Default Multi-Site Sources (Built-in + Universal Retailers) ─────
INSERT IGNORE INTO `crawl_source`
  (`code`, `name`, `domain`, `discovery_mode`, `spider_name`, `start_urls`, `url_include_pattern`, `url_exclude_pattern`, `render_mode`, `priority`, `crawl_interval_minutes`, `request_delay_ms`, `enabled`)
VALUES
  ('tgdd', 'Thế Giới Di Động', 'thegioididong.com', 'builtin_spider', 'tgdd_catalog', '["dien-thoai","laptop","tablet"]', NULL, NULL, 'http', 1, 30, 300, 1),
  ('fpt', 'FPT Shop', 'fptshop.com.vn', 'builtin_spider', 'fpt_catalog', '["dien-thoai","laptop","tablet"]', NULL, NULL, 'http', 1, 30, 300, 1),
  ('hoangha', 'Hoàng Hà Mobile', 'hoanghamobile.com', 'builtin_spider', 'hoangha_catalog', '["dien-thoai","laptop","tablet"]', NULL, NULL, 'http', 2, 30, 300, 1),
  ('cellphones', 'CellphoneS', 'cellphones.com.vn', 'builtin_spider', 'cellphones_catalog', '["dien-thoai","laptop","tablet"]', NULL, NULL, 'http', 2, 45, 350, 1),
  ('didongviet', 'Di Động Việt', 'didongviet.vn', 'sitemap', 'universal_catalog', '["https://didongviet.vn/sitemap.xml"]', '(dien-thoai|iphone|samsung|xiaomi|oppo|macbook|ipad|tablet|laptop)', '(tin-tuc|dchannel|tra-gop|khuyen-mai|lien-he)', 'auto_escalate', 3, 60, 400, 1),
  ('phongvu', 'Phong Vũ', 'phongvu.vn', 'sitemap', 'universal_catalog', '["https://phongvu.vn/sitemap.xml"]', '(-s\\d+|/p/|laptop|dien-thoai|may-tinh-bang|macbook)', '(cong-nghe|tin-tuc|hoi-dap|tuyen-dung)', 'auto_escalate', 3, 60, 400, 1),
  ('gearvn', 'GearVN', 'gearvn.com', 'sitemap', 'universal_catalog', '["https://gearvn.com/sitemap.xml"]', '/products/', '(/blogs/|/pages/|/collections/)', 'auto_escalate', 4, 90, 450, 1),
  ('clickbuy', 'ClickBuy', 'clickbuy.com.vn', 'sitemap', 'universal_catalog', '["https://clickbuy.com.vn/sitemap_index.xml"]', '\\.html$', '(tin-tuc|tuyen-dung|chinh-sach|sua-chua)', 'auto_escalate', 4, 90, 450, 1);

SET FOREIGN_KEY_CHECKS = 1;
