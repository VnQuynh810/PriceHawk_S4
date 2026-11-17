import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { wishlistBodySchema } from "@/server/validators/schemas";
import {
  getWishlistService,
  addWishlistItemService,
  removeWishlistItemService,
} from "@/server/services/wishlistService";

export const dynamic = "force-dynamic";

async function resolveUserId() {
  const session = await getServerSession(authOptions);
  return session?.user?.id ? Number(session.user.id) : null;
}

export async function GET() {
  try {
    const userId = await resolveUserId();
    const data = await getWishlistService(userId);
    return NextResponse.json({ data }, { status: 200 });
  } catch (error) {
    console.error("[GET /api/wishlist] Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(request) {
  const userId = await resolveUserId();
  if (!userId) {
    return NextResponse.json(
      { error: "Bạn cần đăng nhập để thêm vào wishlist" },
      { status: 401 }
    );
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = wishlistBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "productId is required" }, { status: 400 });
  }

  try {
    const result = await addWishlistItemService(userId, parsed.data.productId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ message: "Added to wishlist" }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/wishlist] Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(request) {
  const userId = await resolveUserId();
  if (!userId) {
    return NextResponse.json(
      { error: "Bạn cần đăng nhập để xóa khỏi wishlist" },
      { status: 401 }
    );
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = wishlistBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "productId is required" }, { status: 400 });
  }

  try {
    await removeWishlistItemService(userId, parsed.data.productId);
    return NextResponse.json({ message: "Removed from wishlist" }, { status: 200 });
  } catch (error) {
    console.error("[DELETE /api/wishlist] Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
