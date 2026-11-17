import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { extensionSaveSchema } from "@/server/validators/schemas";
import { isDynamicallyTrustedRetailerUrl } from "@/server/services/crawlSourceService";
import { saveExtensionProductService } from "@/server/services/extensionService";

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
  const configuredKey = process.env.EXTENSION_API_KEY;
  const headerKey = request.headers.get("x-extension-key");
  const hasValidApiKey = Boolean(configuredKey) && headerKey === configuredKey;

  let isAuthenticated = hasValidApiKey;
  if (!isAuthenticated) {
    const session = await getServerSession(authOptions);
    isAuthenticated = Boolean(session?.user?.id);
  }

  if (!isAuthenticated) {
    return NextResponse.json(
      { error: "Unauthorized: valid session or X-Extension-Key required" },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS_HEADERS });
  }

  const parsed = extensionSaveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid payload" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // Dynamically trusts both static ALLOWED_RETAILER_DOMAINS and active domains in `crawl_source`
  const trusted = await isDynamicallyTrustedRetailerUrl(parsed.data.sourceUrl);
  if (!trusted) {
    return NextResponse.json(
      { error: "Domain nhà bán lẻ không nằm trong danh sách tin cậy" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  try {
    const result = await saveExtensionProductService(parsed.data);
    return NextResponse.json(result.body, { status: result.status, headers: CORS_HEADERS });
  } catch (error) {
    console.error("[POST /api/extension/save] Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
