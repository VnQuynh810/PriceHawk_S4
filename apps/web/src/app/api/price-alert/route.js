import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  createAlertSchema,
  updateAlertSchema,
  deleteAlertSchema,
} from "@/server/validators/schemas";
import {
  getUserAlertsService,
  checkUserTriggeredAlertsService,
  createPriceAlertService,
  updateAlertStatusService,
  deleteAlertService,
  runBatchAlertTriggersService,
} from "@/server/services/alertService";

export const dynamic = "force-dynamic";

async function resolveSession() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id ? Number(session.user.id) : null;
  const role = session?.user?.role || null;
  return { userId, role };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");
  const { userId, role } = await resolveSession();

  try {
    if (action === "check-triggers") {
      const result = await checkUserTriggeredAlertsService(userId);
      return NextResponse.json(result, { status: 200 });
    }

    if (action === "run-triggers") {
      const cronSecret = process.env.INTERNAL_CRON_SECRET;
      const providedSecret = request.headers.get("x-cron-secret");
      const isAuthorized =
        role === "admin" || (Boolean(cronSecret) && providedSecret === cronSecret);

      if (!isAuthorized) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const result = await runBatchAlertTriggersService();
      return NextResponse.json(result, { status: 200 });
    }

    const status = searchParams.get("status") || "active";
    const data = await getUserAlertsService(userId, status);
    return NextResponse.json({ data }, { status: 200 });
  } catch (error) {
    console.error("[GET /api/price-alert] Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(request) {
  const { userId } = await resolveSession();
  if (!userId) {
    return NextResponse.json(
      { error: "Bạn cần đăng nhập để tạo price alert" },
      { status: 401 }
    );
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createAlertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "productId and targetPrice are required" },
      { status: 400 }
    );
  }

  try {
    const result = await createPriceAlertService({
      userId,
      productId: parsed.data.productId,
      targetPrice: parsed.data.targetPrice,
      note: parsed.data.note,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ message: "Price alert created successfully" }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/price-alert] Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PUT(request) {
  const { userId } = await resolveSession();
  if (!userId) {
    return NextResponse.json(
      { error: "Bạn cần đăng nhập để cập nhật alert" },
      { status: 401 }
    );
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateAlertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "alertId and status are required" }, { status: 400 });
  }

  try {
    const result = await updateAlertStatusService({
      userId,
      alertId: parsed.data.alertId,
      status: parsed.data.status,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ message: "Alert status updated" }, { status: 200 });
  } catch (error) {
    console.error("[PUT /api/price-alert] Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(request) {
  const { userId } = await resolveSession();
  if (!userId) {
    return NextResponse.json(
      { error: "Bạn cần đăng nhập để xóa alert" },
      { status: 401 }
    );
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = deleteAlertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "alertId is required" }, { status: 400 });
  }

  try {
    const result = await deleteAlertService({
      userId,
      alertId: parsed.data.alertId,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ message: "Price alert deleted" }, { status: 200 });
  } catch (error) {
    console.error("[DELETE /api/price-alert] Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
