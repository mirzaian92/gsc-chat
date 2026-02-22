import "server-only";

import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getUserEntitlements } from "@/lib/entitlements";
import { getValidatedUserIdForRoute } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  const userId = await getValidatedUserIdForRoute(session);
  if (!userId) {
    return NextResponse.json(
      { error: "Session expired or invalid. Please continue with Google again." },
      { status: 401 },
    );
  }

  const ent = await getUserEntitlements(userId);
  return NextResponse.json(ent);
}
