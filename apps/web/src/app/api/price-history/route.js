import { NextResponse } from "next/server";
import { priceHistoryQuerySchema } from "@/server/validators/schemas";
import { getPriceHistoryService } from "@/server/services/productService";

export const dynamic = "force-dynamic";

const PUBLIC_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=180, stale-while-revalidate=600",
};

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const rawId = searchParams.get("id");
  if (!rawId) {
    return NextResponse.json({ error: "Missing product ID" }, { status: 400 });
  }

  const parsed = priceHistoryQuerySchema.safeParse({
    id: rawId,
    range: searchParams.get("range") || "7d",
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
  }

  try {
    const payload = await getPriceHistoryService(parsed.data.id, parsed.data.range);
    return NextResponse.json(payload, { status: 200, headers: PUBLIC_CACHE_HEADERS });
  } catch (error) {
    console.error("[GET /api/price-history] Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
