import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getNavbarSummaryService } from "@/server/services/alertService";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id ? Number(session.user.id) : null;
    const summary = await getNavbarSummaryService(userId);
    return NextResponse.json(summary, {
      status: 200,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("[GET /api/me/summary] Error:", error);
    return NextResponse.json({ wishlistCount: 0, triggeredAlertCount: 0 }, { status: 200 });
  }
}
