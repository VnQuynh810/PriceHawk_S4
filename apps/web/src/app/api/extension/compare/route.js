import { NextResponse } from "next/server";
import { extensionCompareSchema } from "@/server/validators/schemas";
import { compareExtensionProductService } from "@/server/services/extensionService";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Extension-Key",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS_HEADERS });
  }

  const parsed = extensionCompareSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "name is required" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  try {
    const result = await compareExtensionProductService(parsed.data);
    return NextResponse.json(result.body, { status: result.status, headers: CORS_HEADERS });
  } catch (error) {
    console.error("[POST /api/extension/compare] Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
