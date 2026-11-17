import "server-only";
import db from "@/server/db/pool";

function parseJsonColumn(val, fallback) {
  if (val === null || val === undefined) return fallback;
  if (typeof val === "object") return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

function mapSourceRow(row) {
  return {
    ...row,
    enabled: Boolean(row.enabled),
    start_urls: parseJsonColumn(row.start_urls, []),
    selectors_json: parseJsonColumn(row.selectors_json, null),
  };
}

export async function listAllCrawlSources() {
  try {
    const rows = await db.query(
      "SELECT * FROM crawl_source ORDER BY priority ASC, id ASC"
    );
    return rows.map(mapSourceRow);
  } catch (err) {
    if (err.code === "ER_NO_SUCH_TABLE") return [];
    throw err;
  }
}

export async function findEnabledSourceDomains() {
  try {
    const rows = await db.query(
      "SELECT domain FROM crawl_source WHERE enabled = 1"
    );
    return rows.map((r) => String(r.domain || "").toLowerCase()).filter(Boolean);
  } catch {
    return [];
  }
}

export async function insertCrawlSource(data) {
  const result = await db.query(
    `INSERT INTO crawl_source (
       code, name, domain, discovery_mode, spider_name, start_urls,
       url_include_pattern, url_exclude_pattern, selectors_json,
       render_mode, default_category, priority, crawl_interval_minutes,
       request_delay_ms, max_items_per_run, proxy_url, enabled, next_run_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      data.code,
      data.name,
      data.domain,
      data.discovery_mode,
      data.discovery_mode === "builtin_spider" ? data.spider_name || `${data.code}_catalog` : "universal_catalog",
      JSON.stringify(data.start_urls),
      data.url_include_pattern || null,
      data.url_exclude_pattern || null,
      data.selectors_json ? JSON.stringify(data.selectors_json) : null,
      data.render_mode,
      data.default_category || null,
      data.priority,
      data.crawl_interval_minutes,
      data.request_delay_ms,
      data.max_items_per_run,
      data.proxy_url || null,
      data.enabled ? 1 : 0,
    ]
  );
  return result.insertId;
}

export async function updateCrawlSourceById(id, patch) {
  const fields = [];
  const params = [];

  const scalarKeys = [
    "name",
    "domain",
    "discovery_mode",
    "spider_name",
    "url_include_pattern",
    "url_exclude_pattern",
    "render_mode",
    "default_category",
    "priority",
    "crawl_interval_minutes",
    "request_delay_ms",
    "max_items_per_run",
    "proxy_url",
  ];

  for (const key of scalarKeys) {
    if (patch[key] !== undefined) {
      fields.push(`${key} = ?`);
      params.push(patch[key]);
    }
  }

  if (patch.start_urls !== undefined) {
    fields.push("start_urls = ?");
    params.push(JSON.stringify(patch.start_urls));
  }

  if (patch.selectors_json !== undefined) {
    fields.push("selectors_json = ?");
    params.push(patch.selectors_json ? JSON.stringify(patch.selectors_json) : null);
  }

  if (patch.enabled !== undefined) {
    fields.push("enabled = ?");
    params.push(patch.enabled ? 1 : 0);
  }

  if (patch.triggerNow) {
    fields.push("next_run_at = NULL");
  }

  if (fields.length === 0) return 0;

  params.push(id);
  const res = await db.query(
    `UPDATE crawl_source SET ${fields.join(", ")} WHERE id = ?`,
    params
  );
  return Number(res?.affectedRows || 0);
}

export async function deleteCrawlSourceById(id) {
  const res = await db.query("DELETE FROM crawl_source WHERE id = ?", [id]);
  return Number(res?.affectedRows || 0);
}
