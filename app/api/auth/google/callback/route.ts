import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { getOAuthClient } from "@/lib/google";
import { upsertTokens } from "@/lib/db";
import { getSession, requireEnv } from "@/lib/session";
import { ensureUsageRow, upsertUserFromGoogle } from "@/lib/appDb";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await getSession();

  const returnedState = req.nextUrl.searchParams.get("state") ?? "";
  const expectedState = session.oauthState ?? "";
  if (!returnedState || !expectedState || returnedState !== expectedState) {
    return NextResponse.json({ error: "Invalid OAuth state. Please try connecting again." }, { status: 400 });
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
        id_token?: string | null;
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

  const idToken = tokens?.id_token ?? null;
  if (!idToken) {
    return NextResponse.json({ error: "Google did not return an id_token. Ensure openid scope is requested." }, { status: 400 });
  }

  let googleSub: string | undefined;
  let email: string | undefined;
  let name: string | undefined;
  try {
    const ticket = await oauth2.verifyIdToken({
      idToken,
      audience: requireEnv("GOOGLE_CLIENT_ID"),
    });
    const payload = ticket.getPayload();
    googleSub = payload?.sub ?? undefined;
    email = payload?.email ?? undefined;
    name = payload?.name ?? undefined;
  } catch {
    return NextResponse.json({ error: "Failed to verify Google identity. Please try again." }, { status: 400 });
  }

  if (!googleSub || !email) {
    return NextResponse.json({ error: "Missing Google account identity (sub/email)." }, { status: 400 });
  }

  const user = await upsertUserFromGoogle({ googleSub, email, name });
  await ensureUsageRow(user.id);

  session.userId = user.id;
  session.oauthState = undefined;
  await session.save();

  await upsertTokens({
    userId: user.id,
    refreshToken,
    accessToken: tokens?.access_token ?? undefined,
    expiryDate: tokens?.expiry_date ?? undefined,
  });

  return NextResponse.redirect(new URL("/app", req.url));
}
