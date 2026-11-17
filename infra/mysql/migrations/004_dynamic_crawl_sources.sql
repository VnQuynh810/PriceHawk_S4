-- ============================================================================
-- Migration 004: Dynamic Multi-Website Crawl Registry & Incremental URL State
-- Idempotent upgrade for existing PriceHawk S4 databases
-- ============================================================================

SET NAMES utf8mb4;

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

CREATE TABLE IF NOT EXISTS `crawl_url_state` (
  `url_hash`        CHAR(64)    NOT NULL,
  `source_code`     VARCHAR(64) NOT NULL,
  `url`             TEXT        NOT NULL,
  `sitemap_lastmod` VARCHAR(64) DEFAULT NULL,
  `etag`            VARCHAR(128) DEFAULT NULL,
  `last_fetched_at` TIMESTAMP   NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`url_hash`),
  KEY `idx_url_state_source` (`source_code`, `last_fetched_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
