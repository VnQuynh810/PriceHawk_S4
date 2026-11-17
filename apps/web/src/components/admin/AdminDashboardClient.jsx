"use client";

import { useState } from "react";
import {
  getAdminSources,
  createAdminSource,
  updateAdminSource,
  deleteAdminSource,
  testAdminSourceUrl,
  getAdminPool,
  seedAdminPool,
  deleteAdminPoolSeed,
} from "@/lib/apiClient";
import { formatPrice } from "@/app/utils/format";
import { cn, ui } from "@/components/ui/designSystem";
import {
  Globe,
  Plus,
  Play,
  Trash2,
  Users,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Layers,
  Flame,
  Sun,
  Snowflake,
  Archive,
  RefreshCw,
} from "lucide-react";

const STATUS_BADGES = {
  success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  running: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  processing: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  pending: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  failed: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
  partial: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  empty: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  idle: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

const DEFAULT_POOL = {
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

const EMPTY_FORM = {
  code: "",
  name: "",
  domain: "",
  discovery_mode: "sitemap",
  start_url_input: "",
  url_include_pattern: "",
  url_exclude_pattern: "(tin-tuc|blog|tra-gop|lien-he|tuyen-dung)",
  render_mode: "auto_escalate",
  crawl_interval_minutes: 60,
  request_delay_ms: 400,
  priority: 4,
  name_css: "",
  price_css: "",
};

export default function AdminDashboardClient({
  initialSources = [],
  initialUsers = [],
  initialPool = null,
}) {
  const [activeTab, setActiveTab] = useState("pool");
  const [sources, setSources] = useState(initialSources);
  const [pool, setPool] = useState(initialPool || DEFAULT_POOL);
  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);

  // Bulk Seed state
  const [seedText, setSeedText] = useState("");
  const [seedCategory, setSeedCategory] = useState("");
  const [seedLoading, setSeedLoading] = useState(false);

  // Live URL Extractor Sandbox state
  const [testUrl, setTestUrl] = useState("");
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const reloadSources = async () => {
    try {
      const res = await getAdminSources();
      setSources(res.data?.data || []);
    } catch {}
  };

  const reloadPool = async () => {
    try {
      const res = await getAdminPool();
      if (res.data) setPool(res.data);
    } catch {}
  };

  const handleBulkSeedSubmit = async (e) => {
    e.preventDefault();
    if (!seedText.trim()) return;
    setSeedLoading(true);
    setFeedback("");
    try {
      const res = await seedAdminPool(seedText, seedCategory || null);
      setFeedback(`✓ ${res.data?.message || "Đã thêm hạt giống vào Pool!"}`);
      setSeedText("");
      await reloadPool();
    } catch (err) {
      setFeedback(err.response?.data?.error || "Lỗi khi thả hạt giống sản phẩm");
    } finally {
      setSeedLoading(false);
    }
  };

  const handlePurgeFinishedQueue = async () => {
    try {
      await deleteAdminPoolSeed({ purgeFinished: true });
      await reloadPool();
    } catch {}
  };

  const handleDeleteQueueItem = async (id) => {
    try {
      await deleteAdminPoolSeed({ id });
      await reloadPool();
    } catch {}
  };

  const handleToggleEnabled = async (src) => {
    try {
      await updateAdminSource({ id: src.id, enabled: !src.enabled });
      await reloadSources();
    } catch (err) {
      setFeedback(err.response?.data?.error || "Lỗi cập nhật trạng thái");
    }
  };

  const handleForceRun = async (src) => {
    try {
      await updateAdminSource({ id: src.id, triggerNow: true, enabled: true });
      setFeedback(`Đã xếp lịch ưu tiên chạy ngay cho "${src.name}" ở chu kỳ kế tiếp.`);
      await reloadSources();
    } catch (err) {
      setFeedback(err.response?.data?.error || "Không thể kích hoạt nguồn cào");
    }
  };

  const handleDeleteSource = async (src) => {
    if (!window.confirm(`Xóa nguồn cào "${src.name}" (${src.domain})?`)) return;
    try {
      await deleteAdminSource(src.id);
      await reloadSources();
    } catch (err) {
      setFeedback(err.response?.data?.error || "Không thể xóa nguồn cào");
    }
  };

  const handleCreateSource = async (e) => {
    e.preventDefault();
    setBusy(true);
    setFeedback("");
    try {
      const startUrls = form.start_url_input
        .split(/\r?\n|,/)
        .map((s) => s.trim())
        .filter(Boolean);

      const selectorsJson =
        form.name_css.trim() || form.price_css.trim()
          ? {
              ...(form.name_css.trim() ? { name_css: form.name_css.trim() } : {}),
              ...(form.price_css.trim() ? { price_css: form.price_css.trim() } : {}),
            }
          : null;

      await createAdminSource({
        code: form.code,
        name: form.name,
        domain: form.domain,
        discovery_mode: form.discovery_mode,
        start_urls: startUrls,
        url_include_pattern: form.url_include_pattern || null,
        url_exclude_pattern: form.url_exclude_pattern || null,
        selectors_json: selectorsJson,
        render_mode: form.render_mode,
        crawl_interval_minutes: Number(form.crawl_interval_minutes),
        request_delay_ms: Number(form.request_delay_ms),
        priority: Number(form.priority),
        enabled: true,
      });

      setShowAddModal(false);
      setForm(EMPTY_FORM);
      setFeedback("✓ Đã thêm nguồn website mới vào hệ thống cào động!");
      await reloadSources();
    } catch (err) {
      setFeedback(err.response?.data?.error || "Lỗi khi thêm website mới");
    } finally {
      setBusy(false);
    }
  };

  const handleLiveTest = async (e) => {
    e.preventDefault();
    if (!testUrl.trim()) return;
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await testAdminSourceUrl(testUrl.trim());
      setTestResult(res.data);
    } catch (err) {
      setTestResult({
        success: false,
        error: err.response?.data?.error || "Không thể bóc tách URL này",
      });
    } finally {
      setTestLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Tabs */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className={cn(ui.heading, "text-3xl font-black")}>
            Trung tâm Điều hành PriceHawk
          </h1>
          <p className={cn(ui.mutedText, "text-sm mt-1")}>
            Hồ sản phẩm tự sinh sôi (Autonomous Pool), Cào động đa website & Quản trị người dùng
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-zinc-200/70 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 self-start">
          <button
            onClick={() => setActiveTab("pool")}
            className={cn(
              "flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-bold transition-all",
              activeTab === "pool"
                ? "bg-violet-600 text-white shadow-sm"
                : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
            )}
          >
            <Layers className="w-4 h-4" />
            Hồ Sản Phẩm ({pool.totalProducts})
          </button>
          <button
            onClick={() => setActiveTab("sources")}
            className={cn(
              "flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-bold transition-all",
              activeTab === "sources"
                ? "bg-violet-600 text-white shadow-sm"
                : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
            )}
          >
            <Globe className="w-4 h-4" />
            Nguồn Cào ({sources.length})
          </button>
          <button
            onClick={() => setActiveTab("users")}
            className={cn(
              "flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-bold transition-all",
              activeTab === "users"
                ? "bg-violet-600 text-white shadow-sm"
                : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
            )}
          >
            <Users className="w-4 h-4" />
            Người dùng ({initialUsers.length})
          </button>
        </div>
      </div>

      {feedback && (
        <div className="p-4 rounded-xl bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800/40 text-sm font-semibold text-violet-700 dark:text-violet-300">
          {feedback}
        </div>
      )}

      {/* ── TAB 1: AUTONOMOUS SELF-EXPANDING PRODUCT POOL ── */}
      {activeTab === "pool" && (
        <div className="space-y-6">
          {/* 4 Temperature Tier Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <div className={cn(ui.card, "p-4")}>
              <span className="text-xs font-bold uppercase text-violet-600 dark:text-violet-400">
                Đa sàn (&ge;2 nơi bán)
              </span>
              <p className="text-2xl font-black mt-1 tabular-nums">
                {pool.multiRetailerProducts} / {pool.activeProducts}
              </p>
              <p className={cn(ui.mutedText, "text-[11px] mt-1")}>Tự động dò bù sàn còn thiếu</p>
            </div>

            <div className={cn(ui.card, "p-4")}>
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase text-rose-500">
                <Flame className="w-3.5 h-3.5" />
                HOT (15 phút)
              </div>
              <p className="text-2xl font-black mt-1 tabular-nums">{pool.hotProducts}</p>
              <p className={cn(ui.mutedText, "text-[11px] mt-1")}>Có Wishlist / Price Alert</p>
            </div>

            <div className={cn(ui.card, "p-4")}>
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase text-amber-500">
                <Sun className="w-3.5 h-3.5" />
                WARM (3 giờ)
              </div>
              <p className="text-2xl font-black mt-1 tabular-nums">{pool.warmProducts}</p>
              <p className={cn(ui.mutedText, "text-[11px] mt-1")}>Có người xem / Mới nhập</p>
            </div>

            <div className={cn(ui.card, "p-4")}>
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase text-sky-500">
                <Snowflake className="w-3.5 h-3.5" />
                COLD (36 giờ)
              </div>
              <p className="text-2xl font-black mt-1 tabular-nums">{pool.coldProducts}</p>
              <p className={cn(ui.mutedText, "text-[11px] mt-1")}>Rải đều tiết kiệm CPU</p>
            </div>

            <div className={cn(ui.card, "p-4")}>
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase text-zinc-500">
                <Archive className="w-3.5 h-3.5" />
                DORMANT (Ngủ đông)
              </div>
              <p className="text-2xl font-black mt-1 tabular-nums">{pool.dormantProducts}</p>
              <p className={cn(ui.mutedText, "text-[11px] mt-1")}>Giữ SEO, tốn 0% tài nguyên</p>
            </div>
          </div>

          {/* Bulk Seed Injection Box */}
          <section className={cn(ui.card, "p-6 space-y-4")}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-violet-500" />
                <h2 className={cn(ui.heading, "text-lg font-bold")}>
                  Thả Hạt Giống Mở Rộng Pool (Bulk Seed)
                </h2>
              </div>
              <button onClick={reloadPool} className={cn(ui.secondaryButton, "px-3 py-1.5 text-xs gap-1.5")}>
                <RefreshCw className="w-3.5 h-3.5" />
                Làm mới
              </button>
            </div>
            <p className={cn(ui.mutedText, "text-xs leading-relaxed")}>
              Mỗi dòng nhập <strong>tên sản phẩm</strong> (VD: <code>iPhone 17 Air 256GB</code>, <code>MacBook Pro M4 16GB 512GB</code>) hoặc <strong>link trực tiếp</strong> từ bất kỳ sàn nào. Worker sẽ tự dùng SearXNG + Universal Extractor lùng sục khắp các sàn uy tín khác để gom trọn bộ báo giá đắp vào Pool! (Ngoài ra, từ khóa khách tìm hoặc hỏi Chatbot chưa có cũng tự chảy vào đây).
            </p>
            <form onSubmit={handleBulkSeedSubmit} className="space-y-3">
              <textarea
                rows={4}
                value={seedText}
                onChange={(e) => setSeedText(e.target.value)}
                placeholder={"iPhone 16 Pro Max 256GB\nLaptop ASUS Zenbook 14 OLED 16GB 512GB\nhttps://phongvu.vn/..."}
                className={ui.input}
                required
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <select
                  value={seedCategory}
                  onChange={(e) => setSeedCategory(e.target.value)}
                  className={cn(ui.input, "w-auto min-w-[200px]")}
                >
                  <option value="">Tự động nhận diện danh mục</option>
                  <option value="dien-thoai">Điện thoại</option>
                  <option value="laptop">Laptop</option>
                  <option value="tablet">Máy tính bảng</option>
                </select>
                <button type="submit" disabled={seedLoading} className={ui.primaryButton}>
                  {seedLoading ? "Đang đẩy vào hàng đợi..." : "Bơm Vào Pool Tự Nở"}
                </button>
              </div>
            </form>
          </section>

          {/* Discovery Queue Live Monitor */}
          <section className={cn(ui.card, "p-6 space-y-4")}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className={cn(ui.heading, "text-lg font-bold")}>
                  Hàng Đợi Khám Phá Tự Động (`discovery_queue`)
                </h2>
                <p className={cn(ui.mutedText, "text-xs mt-0.5")}>
                  Chờ xử lý: <strong>{pool.queueStats?.pending || 0}</strong> • Đang săn giá:{" "}
                  <strong>{pool.queueStats?.processing || 0}</strong> • Đã đắp vào Pool:{" "}
                  <strong>{pool.queueStats?.completed || 0}</strong>
                </p>
              </div>
              <button
                onClick={handlePurgeFinishedQueue}
                className={cn(ui.secondaryButton, "px-3 py-1.5 text-xs")}
              >
                Dọn lịch sử đã xong
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 text-left">
                    <th className={cn(ui.mutedText, "py-2.5 font-semibold")}>Hạt giống (Từ khóa / URL)</th>
                    <th className={cn(ui.mutedText, "py-2.5 font-semibold")}>Nguồn kích hoạt</th>
                    <th className={cn(ui.mutedText, "py-2.5 font-semibold")}>Trạng thái</th>
                    <th className={cn(ui.mutedText, "py-2.5 font-semibold text-right")}>Số sàn khớp</th>
                    <th className={cn(ui.mutedText, "py-2.5 font-semibold text-right")}>Xóa</th>
                  </tr>
                </thead>
                <tbody>
                  {(pool.recentQueue || []).map((item) => (
                    <tr
                      key={item.id}
                      className="border-b border-zinc-100 dark:border-zinc-800/50 last:border-0"
                    >
                      <td className="py-3 pr-4 max-w-md truncate font-medium">
                        <span className="mr-2 px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-[10px] font-mono uppercase">
                          {item.seed_type}
                        </span>
                        {item.query_or_url}
                      </td>
                      <td className="py-3 pr-4 text-xs font-mono text-zinc-500">
                        {item.origin}
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className={cn(
                            "px-2.5 py-0.5 rounded-full text-xs font-bold uppercase",
                            STATUS_BADGES[item.status] || STATUS_BADGES.idle
                          )}
                        >
                          {item.status}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-right font-bold tabular-nums">
                        {item.matched_urls_count ?? 0}
                      </td>
                      <td className="py-3 text-right">
                        <button
                          onClick={() => handleDeleteQueueItem(item.id)}
                          className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {(!pool.recentQueue || pool.recentQueue.length === 0) && (
                    <tr>
                      <td colSpan={5} className={cn(ui.mutedText, "py-8 text-center")}>
                        Hàng đợi đang trống — hãy thả hạt giống đầu tiên hoặc chờ người dùng tìm kiếm sản phẩm mới!
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* ── TAB 2: DYNAMIC CRAWL SOURCES ── */}
      {activeTab === "sources" && (
        <>
          <section className={cn(ui.card, "p-6 space-y-4")}>
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-violet-500" />
              <h2 className={cn(ui.heading, "text-lg font-bold")}>
                Kiểm thử Bóc tách Tự động (Universal URL Sandbox)
              </h2>
            </div>
            <form onSubmit={handleLiveTest} className="flex flex-col sm:flex-row gap-3">
              <input
                type="url"
                value={testUrl}
                onChange={(e) => setTestUrl(e.target.value)}
                placeholder="https://phongvu.vn/... hoặc https://didongviet.vn/..."
                className={cn(ui.input, "flex-1")}
                required
              />
              <button type="submit" disabled={testLoading} className={ui.primaryButton}>
                {testLoading ? "Đang phân tích..." : "Bóc tách thử"}
              </button>
            </form>

            {testResult && (
              <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm space-y-2">
                {testResult.success ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold">
                      <CheckCircle2 className="w-4 h-4" />
                      Bóc tách thành công qua tầng:{" "}
                      <code className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30">
                        {testResult.strategy}
                      </code>
                    </div>
                    <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                      Sản phẩm: {testResult.extracted?.name}
                    </p>
                    <p className="text-orange-500 font-bold">
                      Giá bán: {formatPrice(testResult.extracted?.price)}
                    </p>
                    <p className={cn(ui.mutedText, "text-xs font-mono")}>
                      identity_key: {testResult.normalized?.identityKey || "N/A"}
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-semibold">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>
                      {testResult.error ||
                        (testResult.needsJsRender
                          ? "Trang SPA động — sẽ tự leo thang sang Dynamic Playwright Worker khi chạy thật."
                          : "Không tìm thấy JSON-LD/OpenGraph chuẩn — hãy khai báo CSS Selector hoặc bật AI Selector Healer.")}
                    </span>
                  </div>
                )}
              </div>
            )}
          </section>

          <section className={cn(ui.card, "p-6 space-y-4")}>
            <div className="flex items-center justify-between">
              <h2 className={cn(ui.heading, "text-lg font-bold")}>
                Danh sách Website Nguồn Cào
              </h2>
              <button onClick={() => setShowAddModal(true)} className={cn(ui.primaryButton, "gap-1.5")}>
                <Plus className="w-4 h-4" />
                Thêm Website Mới
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 text-left">
                    <th className={cn(ui.mutedText, "py-3 font-semibold")}>Nguồn / Domain</th>
                    <th className={cn(ui.mutedText, "py-3 font-semibold")}>Chế độ Cào</th>
                    <th className={cn(ui.mutedText, "py-3 font-semibold")}>Chu kỳ</th>
                    <th className={cn(ui.mutedText, "py-3 font-semibold")}>Trạng thái</th>
                    <th className={cn(ui.mutedText, "py-3 font-semibold text-right")}>SP đã lưu</th>
                    <th className={cn(ui.mutedText, "py-3 font-semibold text-right")}>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((src) => (
                    <tr
                      key={src.id}
                      className="border-b border-zinc-100 dark:border-zinc-800/50 last:border-0"
                    >
                      <td className="py-3.5 pr-4">
                        <div className="font-bold text-zinc-900 dark:text-zinc-100">{src.name}</div>
                        <div className="text-xs text-zinc-500 font-mono">
                          {src.code} • {src.domain}
                        </div>
                      </td>
                      <td className="py-3.5 pr-4">
                        <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                          {src.discovery_mode}
                        </span>
                        <span className="ml-1.5 text-xs text-zinc-400">({src.render_mode})</span>
                      </td>
                      <td className="py-3.5 pr-4 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                        {src.crawl_interval_minutes} phút
                      </td>
                      <td className="py-3.5 pr-4">
                        <span
                          className={cn(
                            "px-2.5 py-0.5 rounded-full text-xs font-bold uppercase",
                            STATUS_BADGES[src.last_status] || STATUS_BADGES.idle
                          )}
                        >
                          {src.enabled ? src.last_status || "idle" : "tắt"}
                        </span>
                      </td>
                      <td className="py-3.5 pr-4 text-right font-bold tabular-nums">
                        {src.last_item_count ?? 0}
                      </td>
                      <td className="py-3.5 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            onClick={() => handleToggleEnabled(src)}
                            className={cn(ui.secondaryButton, "px-2.5 py-1 text-xs")}
                          >
                            {src.enabled ? "Tạm dừng" : "Bật"}
                          </button>
                          <button
                            onClick={() => handleForceRun(src)}
                            title="Xếp lịch chạy ngay"
                            className={cn(ui.secondaryButton, "px-2.5 py-1 text-xs")}
                          >
                            <Play className="w-3.5 h-3.5" />
                          </button>
                          {src.discovery_mode !== "builtin_spider" && (
                            <button
                              onClick={() => handleDeleteSource(src)}
                              title="Xóa nguồn"
                              className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* ── TAB 3: USERS ── */}
      {activeTab === "users" && (
        <section className={cn(ui.card, "p-6 overflow-x-auto")}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                {["Email", "Role", "Ngày tạo", "Wishlist", "Alerts"].map((h) => (
                  <th
                    key={h}
                    className={cn(ui.mutedText, "py-3 font-semibold text-left last:text-right")}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {initialUsers.map((user) => (
                <tr
                  key={user.id}
                  className="border-b border-zinc-100 dark:border-zinc-800/50 last:border-0"
                >
                  <td className="py-3 text-zinc-900 dark:text-zinc-100">{user.email}</td>
                  <td className="py-3">
                    <span
                      className={cn(
                        "inline-block px-2 py-0.5 rounded-md text-xs font-semibold",
                        user.role === "admin"
                          ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
                          : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                      )}
                    >
                      {user.role}
                    </span>
                  </td>
                  <td className={cn(ui.mutedText, "py-3")}>
                    {user.created_at
                      ? new Date(user.created_at).toLocaleDateString("vi-VN")
                      : "—"}
                  </td>
                  <td className="py-3 text-right">{user.wishlist_count ?? 0}</td>
                  <td className="py-3 text-right">{user.alert_count ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Add Website Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className={cn(ui.card, "w-full max-w-xl p-6 max-h-[90vh] overflow-y-auto space-y-4")}>
            <h3 className={cn(ui.heading, "text-xl font-black")}>
              Thêm Website Cào Động Mới
            </h3>
            <form onSubmit={handleCreateSource} className="space-y-3 text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1">Mã định danh (code)</label>
                  <input
                    className={ui.input}
                    placeholder="vd: nguyenkim"
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">Tên hiển thị</label>
                  <input
                    className={ui.input}
                    placeholder="vd: Nguyễn Kim"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1">Domain</label>
                  <input
                    className={ui.input}
                    placeholder="nguyenkim.com"
                    value={form.domain}
                    onChange={(e) => setForm({ ...form, domain: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">Chế độ Khám phá Link</label>
                  <select
                    className={ui.input}
                    value={form.discovery_mode}
                    onChange={(e) => setForm({ ...form, discovery_mode: e.target.value })}
                  >
                    <option value="sitemap">XML Sitemap (Khuyên dùng)</option>
                    <option value="html_listing">Danh mục HTML + Phân trang</option>
                    <option value="json_api">JSON REST API</option>
                    <option value="playwright_listing">Playwright SPA Dynamic</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold mb-1">
                  Start URLs / Sitemap URL (mỗi dòng 1 link)
                </label>
                <textarea
                  className={ui.input}
                  rows={2}
                  placeholder="https://www.nguyenkim.com/sitemap.xml"
                  value={form.start_url_input}
                  onChange={(e) => setForm({ ...form, start_url_input: e.target.value })}
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1">Regex lọc URL sản phẩm (tuỳ chọn)</label>
                  <input
                    className={ui.input}
                    placeholder="(dien-thoai|laptop|ipad)"
                    value={form.url_include_pattern}
                    onChange={(e) => setForm({ ...form, url_include_pattern: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">Chế độ Render JS</label>
                  <select
                    className={ui.input}
                    value={form.render_mode}
                    onChange={(e) => setForm({ ...form, render_mode: e.target.value })}
                  >
                    <option value="auto_escalate">Tự động leo thang (HTTP -&gt; Playwright)</option>
                    <option value="http">Chỉ HTTP tốc độ cao</option>
                    <option value="playwright">Luôn dùng Playwright</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1">CSS Tên SP (để trống = tự động)</label>
                  <input
                    className={ui.input}
                    placeholder="h1.product-title"
                    value={form.name_css}
                    onChange={(e) => setForm({ ...form, name_css: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">CSS Giá bán (để trống = tự động)</label>
                  <input
                    className={ui.input}
                    placeholder=".product-info-price .price"
                    value={form.price_css}
                    onChange={(e) => setForm({ ...form, price_css: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className={ui.secondaryButton}
                >
                  Hủy
                </button>
                <button type="submit" disabled={busy} className={ui.primaryButton}>
                  {busy ? "Đang lưu..." : "Lưu Nguồn Cào"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
