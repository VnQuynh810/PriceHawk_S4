import { NextResponse } from "next/server";
import { searchQuerySchema } from "@/server/validators/schemas";
import { searchProductsService } from "@/server/services/productService";

export const dynamic = "force-dynamic";

const PUBLIC_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
};

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const rawQuery = {
    q: searchParams.get("q") ?? "",
    page: searchParams.get("page") || undefined,
    pageSize: searchParams.get("pageSize") || undefined,
  };

  const parsed = searchQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Missing search term" },
      { status: 400 }
    );
  }

  try {
    const { q, page, pageSize } = parsed.data;
    const payload = await searchProductsService(q, page, pageSize);
    return NextResponse.json(payload, { status: 200, headers: PUBLIC_CACHE_HEADERS });
  } catch (error) {
    console.error("[GET /api/pagination] Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
