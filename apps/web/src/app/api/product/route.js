import { NextResponse } from "next/server";
import { paginationQuerySchema } from "@/server/validators/schemas";
import {
  getProductByIdService,
  getProductsPaginatedService,
} from "@/server/services/productService";

export const dynamic = "force-dynamic";

const PUBLIC_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
};

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const rawQuery = {
    id: searchParams.get("id") || undefined,
    page: searchParams.get("page") || undefined,
    pageSize: searchParams.get("pageSize") || undefined,
  };

  const parsed = paginationQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid query parameters" },
      { status: 400 }
    );
  }

  const { id, page, pageSize } = parsed.data;

  try {
    if (id) {
      const result = await getProductByIdService(id);
      return NextResponse.json(result, { status: 200, headers: PUBLIC_CACHE_HEADERS });
    }

    const payload = await getProductsPaginatedService(page, pageSize);
    return NextResponse.json(payload, { status: 200, headers: PUBLIC_CACHE_HEADERS });
  } catch (error) {
    console.error("[GET /api/product] Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
