import "server-only";

import { NextResponse } from "next/server";
import { getOAuthClient } from "@/lib/google";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

const WEBMASTERS_READONLY_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

export async function GET() {
  const session = await getSession();

  if (!session.userId) {
    session.userId = crypto.randomUUID();
    await session.save();
  }

  const oauth2 = getOAuthClient();
  const authUrl = oauth2.generateAuthUrl({
    scope: [WEBMASTERS_READONLY_SCOPE],
    access_type: "offline",
    prompt: "consent",
  });

  return NextResponse.redirect(authUrl);
}

