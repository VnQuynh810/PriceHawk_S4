import { NextResponse } from "next/server";
import { chatRequestSchema } from "@/server/validators/schemas";

export const dynamic = "force-dynamic";

const CHATBOT_URL = process.env.CHATBOT_SERVICE_URL || "http://localhost:8000";

export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Message is required" },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(`${CHATBOT_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[POST /api/chat] Upstream error:", response.status, errorText);
      return NextResponse.json({ error: "Chatbot service unavailable" }, { status: 502 });
    }

    const data = await response.json();
    return NextResponse.json(data, { status: 200 });
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return NextResponse.json({ error: "Request timeout. Please try again." }, { status: 504 });
    }
    console.error("[POST /api/chat] Error:", err.message);
    return NextResponse.json(
      { error: "Chatbot service is not running. Please start the Python service." },
      { status: 503 }
    );
  }
}
