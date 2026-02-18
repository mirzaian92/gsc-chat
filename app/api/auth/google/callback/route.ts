import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { getOAuthClient } from "@/lib/google";
import { upsertTokens } from "@/lib/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await getSession();

  if (!session.userId) {
    session.userId = crypto.randomUUID();
    await session.save();
  }

  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: "Missing `code` query parameter." }, { status: 400 });
  }

  const oauth2 = getOAuthClient();

  let tokens:
    | {
        refresh_token?: string | null;
        access_token?: string | null;
        expiry_date?: number | null;
      }
    | undefined;

  try {
    const res = await oauth2.getToken(code);
    tokens = res.tokens;
  } catch {
    return NextResponse.json(
      { error: "Failed to exchange authorization code for tokens. Please try connecting again." },
      { status: 400 },
    );
  }

  const refreshToken = tokens?.refresh_token ?? null;
  if (!refreshToken) {
    return NextResponse.json(
      {
        error:
          "Google did not return a refresh_token. Remove this app from your Google Account permissions and reconnect. Ensure access_type=offline and prompt=consent are used.",
      },
      { status: 400 },
    );
  }

  await upsertTokens({
    userId: session.userId,
    refreshToken,
    accessToken: tokens?.access_token ?? undefined,
    expiryDate: tokens?.expiry_date ?? undefined,
  });

  return NextResponse.redirect(new URL("/", req.url));
}

