import { NextResponse } from "next/server";
import { pingDatabase } from "@/server/db/pool";

export const dynamic = "force-dynamic";

export async function GET() {
  const dbOk = await pingDatabase();
  return NextResponse.json(
    {
      status: "ok",
      db: dbOk,
      timestamp: new Date().toISOString(),
    },
    { status: 200 }
  );
}
