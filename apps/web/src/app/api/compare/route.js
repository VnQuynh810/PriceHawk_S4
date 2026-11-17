import { NextResponse } from "next/server";
import { idQuerySchema } from "@/server/validators/schemas";
import { getProductComparisonService } from "@/server/services/productService";

export const dynamic = "force-dynamic";

const PUBLIC_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
};

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const rawId = searchParams.get("id");
  if (!rawId) {
    return NextResponse.json({ error: "Missing product ID" }, { status: 400 });
  }

  const parsed = idQuerySchema.safeParse({ id: rawId });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid product ID" }, { status: 400 });
  }

  try {
    const payload = await getProductComparisonService(parsed.data.id);
    return NextResponse.json(payload, { status: 200, headers: PUBLIC_CACHE_HEADERS });
  } catch (error) {
    console.error("[GET /api/compare] Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
