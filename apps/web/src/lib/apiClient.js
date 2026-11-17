import axios from "axios";

const apiClient = axios.create({
  baseURL: "/api",
  timeout: 15000,
});

// ─── Products ────────────────────────────────────────────────────────────────

export const getProducts = (page, pageSize, signal) =>
  apiClient.get("/product", { params: { page, pageSize }, signal });

export const searchProducts = (q, page, pageSize, signal) =>
  apiClient.get("/pagination", { params: { q, page, pageSize }, signal });

export const getProductDetail = (id, signal) =>
  apiClient.get("/compare", { params: { id }, signal });

export const getPriceHistory = (id, range = "7d", signal) =>
  apiClient.get("/price-history", { params: { id, range }, signal });

// ─── User Summary (Navbar Badges — Single Query) ─────────────────────────────

export const getUserSummary = (signal) =>
  apiClient.get("/me/summary", { signal });

// ─── Wishlist ────────────────────────────────────────────────────────────────

export const getWishlist = (signal) =>
  apiClient.get("/wishlist", { signal });

export const addToWishlist = (productId) =>
  apiClient.post("/wishlist", { productId });

export const removeFromWishlist = (productId) =>
  apiClient.delete("/wishlist", { data: { productId } });

// ─── Price Alerts ────────────────────────────────────────────────────────────

export const getAlerts = (signal) =>
  apiClient.get("/price-alert", { params: { status: "all" }, signal });

export const checkTriggeredAlerts = (signal) =>
  apiClient.get("/price-alert", { params: { action: "check-triggers" }, signal });

export const createAlert = (productId, targetPrice, note) =>
  apiClient.post("/price-alert", { productId, targetPrice, note });

export const updateAlertStatus = (alertId, status) =>
  apiClient.put("/price-alert", { alertId, status });

export const deleteAlert = (alertId) =>
  apiClient.delete("/price-alert", { data: { alertId } });

// ─── Auth ────────────────────────────────────────────────────────────────────

export const registerUser = (email, password) =>
  apiClient.post("/auth/register", { email, password });

// ─── Admin: Dynamic Crawl Sources & Live URL Extractor ───────────────────────

export const getAdminSources = (signal) =>
  apiClient.get("/admin/sources", { signal });

export const createAdminSource = (payload) =>
  apiClient.post("/admin/sources", payload);

export const updateAdminSource = (payload) =>
  apiClient.put("/admin/sources", payload);

export const deleteAdminSource = (id) =>
  apiClient.delete("/admin/sources", { data: { id } });

export const testAdminSourceUrl = (url, category = null) =>
  apiClient.post("/admin/sources/test-extract", { url, category });

// ─── Admin: Autonomous Self-Expanding Product Pool ───────────────────────────

export const getAdminPool = (signal) =>
  apiClient.get("/admin/pool", { signal });

export const seedAdminPool = (seeds, category = null) =>
  apiClient.post("/admin/pool", { seeds, category });

export const deleteAdminPoolSeed = (payload) =>
  apiClient.delete("/admin/pool", { data: payload });

export default apiClient;
