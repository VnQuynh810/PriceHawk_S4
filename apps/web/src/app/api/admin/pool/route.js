import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { poolBulkSeedSchema, poolQueueDeleteSchema } from "@/server/validators/schemas";
import {
  getPoolDashboardService,
  bulkEnqueuePoolSeedsService,
  removePoolQueueItemService,
} from "@/server/services/poolService";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session) return { ok: false, status: 401, error: "Unauthorized" };
  if (session.user?.role !== "admin") return { ok: false, status: 403, error: "Forbidden" };
  return { ok: true };
}

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    const data = await getPoolDashboardService();
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    console.error("[GET /api/admin/pool] Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(request) {
  const guard = await requireAdmin();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = poolBulkSeedSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Dữ liệu hạt giống không hợp lệ" },
      { status: 400 }
    );
  }

  try {
    const result = await bulkEnqueuePoolSeedsService({
      seedsInput: parsed.data.seeds,
      category: parsed.data.category || null,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(
      {
        message: `Đã đẩy ${result.queuedCount} hạt giống vào hàng đợi tự mở rộng Pool`,
        queuedCount: result.queuedCount,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[POST /api/admin/pool] Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(request) {
  const guard = await requireAdmin();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = poolQueueDeleteSchema.safeParse(body);
  if (!parsed.success || (!parsed.data.id && !parsed.data.purgeFinished)) {
    return NextResponse.json({ error: "id hoặc purgeFinished là bắt buộc" }, { status: 400 });
  }

  try {
    const result = await removePoolQueueItemService(parsed.data);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("[DELETE /api/admin/pool] Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
