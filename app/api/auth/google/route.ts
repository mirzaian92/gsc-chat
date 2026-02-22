import "server-only";

import { NextResponse } from "next/server";
import { getOAuthClient } from "@/lib/google";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

const WEBMASTERS_READONLY_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const OPENID_SCOPE = "openid";
const EMAIL_SCOPE = "email";
const PROFILE_SCOPE = "profile";

export async function GET() {
  const session = await getSession();

  session.oauthState = crypto.randomUUID();
  await session.save();

  const oauth2 = getOAuthClient();
  const authUrl = oauth2.generateAuthUrl({
    scope: [WEBMASTERS_READONLY_SCOPE, OPENID_SCOPE, EMAIL_SCOPE, PROFILE_SCOPE],
    access_type: "offline",
    prompt: "consent",
    state: session.oauthState,
  });

  return NextResponse.redirect(authUrl);
}
