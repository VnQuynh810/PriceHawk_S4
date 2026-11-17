import "server-only";
import { remember } from "@/server/cache/cacheAdapter";
import {
  recordSearchMissForPoolExpansion,
  recordProductViewForWarmTier,
} from "@/server/services/poolService";
import {
  countAllProducts,
  findProductsPage,
  findProductById,
  searchProductsPage,
  findComparisonsByProductId,
  findAllTimeMaxPrice,
  findPriceHistoryData,
} from "@/server/repositories/productRepository";

export async function getProductByIdService(id) {
  return remember(`product:single:${id}`, 60, () => findProductById(id));
}

export async function getProductsPaginatedService(page = 1, pageSize = 12) {
  const offset = (page - 1) * pageSize;
  return remember(`product:list:${page}:${pageSize}`, 60, async () => {
    const [totalCount, data] = await Promise.all([
      remember("product:totalCount", 120, () => countAllProducts()),
      findProductsPage(pageSize, offset),
    ]);
    return { data, totalCount };
  });
}

export async function searchProductsService(q, page = 1, pageSize = 10) {
  const normalizedQ = q.trim().toLowerCase();
  const offset = (page - 1) * pageSize;

  return remember(`product:search:${normalizedQ}:${page}:${pageSize}`, 60, async () => {
    const { totalCount, data } = await searchProductsPage(q.trim(), pageSize, offset);
    if (
      page === 1 &&
      totalCount < 2 &&
      (process.env.NODE_ENV !== "test" || process.env.ENABLE_POOL_HOOKS_IN_TEST === "1")
    ) {
      recordSearchMissForPoolExpansion(q.trim()).catch(() => {});
    }
    return {
      totalCount,
      page,
      pageSize,
      totalPages: Math.ceil(totalCount / pageSize),
      data,
    };
  });
}

export async function getProductComparisonService(id) {
  if (process.env.NODE_ENV !== "test" || process.env.ENABLE_POOL_HOOKS_IN_TEST === "1") {
    recordProductViewForWarmTier(id).catch(() => {});
  }
  return remember(`product:compare:${id}`, 60, async () => {
    const [product, comparison, historyAllTimeMax] = await Promise.all([
      findProductById(id),
      findComparisonsByProductId(id),
      findAllTimeMaxPrice(id),
    ]);

    const lastCrawledAt =
      product?.[0]?.lastCrawledAt ??
      (comparison?.length
        ? comparison.reduce((latest, row) => {
            if (!row.current_price_at) return latest;
            if (!latest) return row.current_price_at;
            return new Date(row.current_price_at) > new Date(latest)
              ? row.current_price_at
              : latest;
          }, null)
        : null);

    const compMax =
      comparison?.length > 0
        ? Math.max(...comparison.map((c) => Number(c.price) || 0))
        : null;

    const allTimeMax =
      historyAllTimeMax !== null
        ? Math.max(historyAllTimeMax, compMax || 0)
        : compMax || null;

    return {
      product,
      comparison,
      lastCrawledAt,
      allTimeMax,
    };
  });
}

function formatDateKey(dateOrString) {
  if (dateOrString instanceof Date) {
    const y = dateOrString.getFullYear();
    const m = String(dateOrString.getMonth() + 1).padStart(2, "0");
    const d = String(dateOrString.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(dateOrString).slice(0, 10);
}

export async function getPriceHistoryService(id, range = "7d") {
  const rangeDayMap = { "7d": 7, "30d": 30, "90d": 90, "180d": 180 };
  const days = rangeDayMap[range] ?? 7;
  const groupByWeek = days >= 90;

  return remember(`product:history:${id}:${range}`, 180, async () => {
    const { rawRows, periodChange } = await findPriceHistoryData(id, days);

    const bucketMap = new Map();
    for (const row of rawRows) {
      const bucketKey = groupByWeek ? String(row.yearweek) : formatDateKey(row.day);
      const dayLabel = groupByWeek ? formatDateKey(row.week_start) : bucketKey;
      const p = Number(row.price);

      if (!bucketMap.has(bucketKey)) {
        bucketMap.set(bucketKey, {
          day: dayLabel,
          minPrice: p,
          maxPrice: p,
          totalPrice: p,
          count: 1,
          bestRetailer: row.retailer,
        });
      } else {
        const entry = bucketMap.get(bucketKey);
        entry.totalPrice += p;
        entry.count += 1;
        if (p < entry.minPrice) {
          entry.minPrice = p;
          entry.bestRetailer = row.retailer;
        }
        if (p > entry.maxPrice) {
          entry.maxPrice = p;
        }
      }
    }

    const history = Array.from(bucketMap.values())
      .sort((a, b) => b.day.localeCompare(a.day))
      .map((d) => ({
        day: d.day,
        minPrice: d.minPrice,
        maxPrice: d.maxPrice,
        avgPrice: Math.round(d.totalPrice / d.count),
        bestRetailer: d.bestRetailer || null,
      }));

    let periodChangePercent = null;
    let periodChangeTrend = "stable";
    if (periodChange.this_period_min && periodChange.prev_period_min) {
      const change =
        ((Number(periodChange.this_period_min) - Number(periodChange.prev_period_min)) /
          Number(periodChange.prev_period_min)) *
        100;
      periodChangePercent = Math.round(change * 10) / 10;
      if (change < -0.5) periodChangeTrend = "down";
      else if (change > 0.5) periodChangeTrend = "up";
    }

    const allMinPrices = history.map((r) => r.minPrice).filter((p) => p > 0);

    return {
      history,
      range,
      groupBy: groupByWeek ? "week" : "day",
      weekChangePercent: periodChangePercent,
      weekChangeTrend: periodChangeTrend,
      periodChangePercent,
      periodChangeTrend,
      minPrice: allMinPrices.length ? Math.min(...allMinPrices) : null,
      maxPrice: allMinPrices.length ? Math.max(...allMinPrices) : null,
    };
  });
}
