import "server-only";
import { cacheInvalidatePrefix } from "@/server/cache/cacheAdapter";
import {
  findWishlistByUserId,
  existsWishlistItem,
  insertWishlistItem,
  deleteWishlistItem,
} from "@/server/repositories/wishlistRepository";

export async function getWishlistService(userId) {
  if (!userId) return [];
  return findWishlistByUserId(userId);
}

export async function addWishlistItemService(userId, productId) {
  const exists = await existsWishlistItem(userId, productId);
  if (exists) {
    return { ok: false, status: 409, error: "Already in wishlist" };
  }

  try {
    await insertWishlistItem(userId, productId);
    await cacheInvalidatePrefix(`user:summary:${userId}`);
    return { ok: true, status: 201 };
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return { ok: false, status: 409, error: "Already in wishlist" };
    }
    throw err;
  }
}

export async function removeWishlistItemService(userId, productId) {
  await deleteWishlistItem(userId, productId);
  await cacheInvalidatePrefix(`user:summary:${userId}`);
  return { ok: true, status: 200 };
}
