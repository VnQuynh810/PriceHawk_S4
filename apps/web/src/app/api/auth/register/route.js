import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { registerBodySchema } from "@/server/validators/schemas";
import {
  findUserByEmail,
  createCredentialUser,
} from "@/server/repositories/userRepository";

export const dynamic = "force-dynamic";

export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body?.email || !body?.password) {
    return NextResponse.json({ error: "Email và password là bắt buộc" }, { status: 400 });
  }

  const parsed = registerBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Dữ liệu không hợp lệ" },
      { status: 400 }
    );
  }

  const { email, password } = parsed.data;

  try {
    const existing = await findUserByEmail(email);
    if (existing) {
      return NextResponse.json({ error: "Email đã được sử dụng" }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const id = await createCredentialUser(email, passwordHash);

    return NextResponse.json({ id, email, role: "user" }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/auth/register] Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
