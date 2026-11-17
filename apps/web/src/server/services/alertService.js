import "server-only";
import { cacheInvalidatePrefix, remember } from "@/server/cache/cacheAdapter";
import { findProductPriceById } from "@/server/repositories/productRepository";
import {
  findAlertsByUser,
  findCheckableAlertsByUser,
  insertPriceAlert,
  updatePriceAlertStatus,
  deletePriceAlertById,
  triggerMetPriceAlertsBatch,
  getUserNavbarSummary,
} from "@/server/repositories/alertRepository";

export async function getUserAlertsService(userId, status = "active") {
  if (!userId) return [];
  return findAlertsByUser(userId, status);
}

export async function checkUserTriggeredAlertsService(userId) {
  const timestamp = new Date().toISOString();
  if (!userId) {
    return {
      success: true,
      checked: 0,
      triggered: 0,
      triggeredIds: [],
      details: [],
      timestamp,
    };
  }

  const alerts = await findCheckableAlertsByUser(userId);
  if (!alerts.length) {
    return {
      success: true,
      checked: 0,
      triggered: 0,
      triggeredIds: [],
      details: [],
      timestamp,
    };
  }

  const triggeredIds = [];
  const details = alerts.map((alert) => {
    const isTriggered =
      alert.latest_price !== null && Number(alert.latest_price) <= Number(alert.target_price);
    if (isTriggered) triggeredIds.push(alert.id);
    return {
      alertId: alert.id,
      productId: alert.product_id,
      productName: alert.name,
      brand: alert.brand,
      targetPrice: Number(alert.target_price),
      currentPrice: Number(alert.latest_price),
      dbStatus: alert.status,
      triggered: isTriggered,
    };
  });

  return {
    success: true,
    checked: alerts.length,
    triggered: triggeredIds.length,
    triggeredIds,
    details,
    timestamp,
  };
}

export async function createPriceAlertService({ userId, productId, targetPrice, note }) {
  const product = await findProductPriceById(productId);
  if (!product) {
    return { ok: false, status: 404, error: "Product not found" };
  }

  const currentPrice = Number(product.current_price);
  if (Number.isFinite(currentPrice) && currentPrice > 0 && targetPrice >= currentPrice) {
    const formattedPrice = new Intl.NumberFormat("vi-VN").format(currentPrice);
    return {
      ok: false,
      status: 400,
      error: `Giá mục tiêu phải thấp hơn giá hiện tại (${formattedPrice} đ). Giá của sản phẩm hiện tại đã thấp hơn hoặc bằng giá trị bạn mong đợi, hãy xem và mua ngay!`,
    };
  }

  try {
    await insertPriceAlert({
      productId,
      userId,
      targetPrice: Math.round(targetPrice),
      currentPrice: Number.isFinite(currentPrice) ? Math.round(currentPrice) : null,
      note,
    });
    await cacheInvalidatePrefix(`user:summary:${userId}`);
    return { ok: true, status: 201 };
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return { ok: false, status: 409, error: "Price alert already exists for this product" };
    }
    throw err;
  }
}

export async function updateAlertStatusService({ userId, alertId, status }) {
  const res = await updatePriceAlertStatus(alertId, userId, status);
  if (!res?.affectedRows) {
    return { ok: false, status: 404, error: "Alert not found" };
  }
  await cacheInvalidatePrefix(`user:summary:${userId}`);
  return { ok: true, status: 200 };
}

export async function deleteAlertService({ userId, alertId }) {
  const res = await deletePriceAlertById(alertId, userId);
  if (!res?.affectedRows) {
    return { ok: false, status: 404, error: "Alert not found" };
  }
  await cacheInvalidatePrefix(`user:summary:${userId}`);
  return { ok: true, status: 200 };
}

export async function runBatchAlertTriggersService() {
  const triggered = await triggerMetPriceAlertsBatch();
  return {
    success: true,
    triggered,
    timestamp: new Date().toISOString(),
  };
}

export async function getNavbarSummaryService(userId) {
  if (!userId) return { wishlistCount: 0, triggeredAlertCount: 0 };
  return remember(`user:summary:${userId}`, 15, () => getUserNavbarSummary(userId));
}
