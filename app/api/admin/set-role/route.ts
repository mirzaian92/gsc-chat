import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { getValidatedUserIdForRoute } from "@/lib/auth";
import { getUserById, setUserRoleByEmail } from "@/lib/appDb";

export const runtime = "nodejs";

const BodySchema = z.object({
  email: z.string().email(),
  role: z.enum(["user", "admin"]),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  const userId = await getValidatedUserIdForRoute(session);
  if (!userId) {
    return NextResponse.json(
      { error: "Session expired or invalid. Please continue with Google again." },
      { status: 401 },
    );
  }

  const me = await getUserById(userId);
  if (!me || me.role !== "admin") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body.", issues: parsed.error.issues }, { status: 400 });
  }

  const email = parsed.data.email.trim();
  const role = parsed.data.role;

  if (me.email.toLowerCase() === email.toLowerCase() && role === "user") {
    return NextResponse.json(
      { error: "Refusing to remove admin from the currently logged-in user." },
      { status: 400 },
    );
  }

  const updated = await setUserRoleByEmail({ email, role });
  if (!updated) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  return NextResponse.json(updated);
}

