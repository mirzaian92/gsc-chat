import "server-only";

import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { gscSitesList } from "@/lib/gsc";
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

  try {
    const sites = await gscSitesList(userId);
    return NextResponse.json(
      sites.flatMap((s) =>
        s.siteUrl && s.permissionLevel ? [{ siteUrl: s.siteUrl, permissionLevel: s.permissionLevel }] : [],
      ),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.toLowerCase().includes("not connected")) {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    throw err;
  }
}
