import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { GscQuerySchema, gscSearchAnalyticsQuery } from "@/lib/gsc";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "Not connected to Google Search Console." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = GscQuerySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const data = await gscSearchAnalyticsQuery(session.userId, parsed.data);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.toLowerCase().includes("not connected")) {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    throw err;
  }
}

