import { z } from "zod";

export const ALLOWED_RETAILER_DOMAINS = [
  "thegioididong.com",
  "dienmayxanh.com",
  "topzone.vn",
  "fptshop.com.vn",
  "hoanghamobile.com",
  "cellphones.com.vn",
  "phongvu.vn",
  "gearvn.com",
  "hacom.vn",
  "diidongviet.vn",
  "didongviet.vn",
  "clickbuy.com.vn",
  "anphatpc.com.vn",
  "mobilecity.vn",
  "shopee.vn",
  "lazada.vn",
  "tiki.vn",
];

export function isTrustedRetailerUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    const host = parsed.hostname.toLowerCase();
    return ALLOWED_RETAILER_DOMAINS.some(
      (domain) => host === domain || host.endsWith(`.${domain}`)
    );
  } catch {
    return false;
  }
}

export const paginationQuerySchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1, "Missing search term").max(120, "Search term too long"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

export const idQuerySchema = z.object({
  id: z.coerce.number().int().positive("Invalid product ID"),
});

export const priceHistoryQuerySchema = z.object({
  id: z.coerce.number().int().positive("Missing or invalid product ID"),
  range: z.enum(["7d", "30d", "90d", "180d"]).catch("7d"),
});

export const createAlertSchema = z.object({
  productId: z.coerce.number().int().positive("productId is required"),
  targetPrice: z.coerce.number().positive("targetPrice must be positive"),
  note: z
    .string()
    .trim()
    .max(255)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
});

export const updateAlertSchema = z.object({
  alertId: z.coerce.number().int().positive("alertId is required"),
  status: z.enum(["active", "inactive", "triggered"]),
});

export const deleteAlertSchema = z.object({
  alertId: z.coerce.number().int().positive("alertId is required"),
});

export const wishlistBodySchema = z.object({
  productId: z.coerce.number().int().positive("productId is required"),
});

export const registerBodySchema = z.object({
  email: z.string().trim().toLowerCase().email("Email không hợp lệ").max(255),
  password: z.string().min(6, "Password phải có ít nhất 6 ký tự").max(128),
});

export const extensionCompareSchema = z.object({
  name: z.string().trim().min(2, "name is required").max(300),
  price: z.coerce.number().nonnegative().nullable().optional(),
  sourceUrl: z.string().trim().max(1024).optional().nullable(),
  brand: z.string().trim().max(100).nullable().optional(),
  category: z.string().trim().max(50).nullable().optional(),
});

export const extensionSaveSchema = z.object({
  name: z.string().trim().min(2, "name is required").max(300),
  price: z.coerce.number().nonnegative().nullable().optional(),
  sourceUrl: z.string().trim().url("sourceUrl must be a valid URL").max(1024),
  brand: z.string().trim().max(100).nullable().optional(),
  category: z.string().trim().max(50).nullable().optional(),
});

export const chatRequestSchema = z.object({
  message: z.string().trim().min(1, "Message is required").max(1000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(4000),
      })
    )
    .max(20)
    .default([]),
});

// ─── Dynamic Crawl Source Admin Schemas ──────────────────────────────────────

function isValidRegex(pattern) {
  if (!pattern) return true;
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

export const crawlSourceCreateSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_-]{2,40}$/, "Mã nguồn chỉ gồm chữ thường, số, gạch ngang/dưới (2-40 ký tự)"),
  name: z.string().trim().min(2, "Tên hiển thị bắt buộc").max(120),
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .transform((v) => v.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""))
    .refine((v) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(v), "Domain không hợp lệ (VD: phongvu.vn)"),
  discovery_mode: z
    .enum(["builtin_spider", "sitemap", "html_listing", "json_api", "playwright_listing"])
    .default("sitemap"),
  spider_name: z.string().trim().max(64).nullable().optional(),
  start_urls: z.array(z.string().trim().min(1).max(1000)).min(1, "Cần ít nhất 1 Start URL / Sitemap"),
  url_include_pattern: z
    .string()
    .trim()
    .max(255)
    .nullable()
    .optional()
    .refine(isValidRegex, "Regex include không hợp lệ"),
  url_exclude_pattern: z
    .string()
    .trim()
    .max(255)
    .nullable()
    .optional()
    .refine(isValidRegex, "Regex exclude không hợp lệ"),
  selectors_json: z.record(z.string(), z.any()).nullable().optional(),
  render_mode: z.enum(["http", "auto_escalate", "playwright"]).default("auto_escalate"),
  default_category: z.enum(["dien-thoai", "laptop", "tablet"]).nullable().optional(),
  priority: z.coerce.number().int().min(1).max(10).default(5),
  crawl_interval_minutes: z.coerce.number().int().min(5).max(1440).default(60),
  request_delay_ms: z.coerce.number().int().min(100).max(10000).default(350),
  max_items_per_run: z.coerce.number().int().min(10).max(10000).default(1500),
  proxy_url: z.string().trim().max(255).nullable().optional(),
  enabled: z.boolean().default(true),
});

export const crawlSourceUpdateSchema = crawlSourceCreateSchema
  .omit({ code: true })
  .partial()
  .extend({
    id: z.coerce.number().int().positive("id is required"),
    triggerNow: z.boolean().optional(),
  });

export const crawlSourceDeleteSchema = z.object({
  id: z.coerce.number().int().positive("id is required"),
});

export const testExtractUrlSchema = z.object({
  url: z.string().trim().url("URL không hợp lệ").max(1024),
  category: z.enum(["dien-thoai", "laptop", "tablet"]).nullable().optional(),
});

export const poolBulkSeedSchema = z.object({
  seeds: z.union([
    z.string().min(3, "Vui lòng nhập ít nhất 1 tên sản phẩm hoặc URL").max(20000),
    z.array(z.string().min(3).max(500)).min(1).max(100),
  ]),
  category: z.enum(["dien-thoai", "laptop", "tablet"]).nullable().optional(),
});

export const poolQueueDeleteSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  purgeFinished: z.boolean().optional(),
});
