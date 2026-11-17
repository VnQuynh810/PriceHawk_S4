-- Seed additional dynamic Vietnamese tech & e-commerce retailers
INSERT IGNORE INTO `crawl_source`
  (`code`, `name`, `domain`, `discovery_mode`, `spider_name`, `start_urls`, `url_include_pattern`, `url_exclude_pattern`, `render_mode`, `priority`, `crawl_interval_minutes`, `request_delay_ms`, `enabled`)
VALUES
  ('hacom', 'HACOM', 'hacom.vn', 'sitemap', 'universal_catalog', '["https://hacom.vn/sitemap.xml"]', '(laptop|dien-thoai|may-tinh-bang|apple)', '(tin-tuc|khuyen-mai|buildpc)', 'auto_escalate', 5, 120, 500, 0),
  ('anphat', 'An Phát Computer', 'anphatpc.com.vn', 'sitemap', 'universal_catalog', '["https://www.anphatpc.com.vn/sitemap.xml"]', '(laptop|apple|may-tinh-bang)_id\\d+\\.html', '(tin-tuc|khuyen-mai)', 'auto_escalate', 5, 120, 500, 0),
  ('mobilecity', 'MobileCity', 'mobilecity.vn', 'sitemap', 'universal_catalog', '["https://mobilecity.vn/sitemap.xml"]', '/(dien-thoai|apple|samsung|xiaomi|ipad)/', '(tin-tuc|dich-vu|sua-chua)', 'auto_escalate', 5, 120, 500, 0);
