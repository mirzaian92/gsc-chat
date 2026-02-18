import "server-only";

import { google, type searchconsole_v1 } from "googleapis";
import { getTokens, upsertTokens } from "./db";
import { requireEnv } from "./session";

export function getOAuthClient() {
  const clientId = requireEnv("GOOGLE_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_CLIENT_SECRET");
  const redirectUri = requireEnv("GOOGLE_REDIRECT_URI");

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function isExpiringSoon(expiryDateMs: number | null | undefined): boolean {
  if (!expiryDateMs) return true;
  return expiryDateMs - Date.now() < 60_000;
}

export async function getAuthedClients(userId: string): Promise<{
  oauth2: InstanceType<typeof google.auth.OAuth2>;
  searchconsole: searchconsole_v1.Searchconsole;
}> {
  const tokenRow = await getTokens(userId);
  if (!tokenRow?.refresh_token) {
    throw new Error("Not connected to Google Search Console.");
  }

  const oauth2 = getOAuthClient();
  oauth2.setCredentials({
    refresh_token: tokenRow.refresh_token,
    access_token: tokenRow.access_token ?? undefined,
    expiry_date: tokenRow.expiry_date ?? undefined,
  });

  const needsRefresh =
    !oauth2.credentials.access_token || isExpiringSoon(oauth2.credentials.expiry_date);
  if (needsRefresh) {
    const refreshToken = oauth2.credentials.refresh_token;
    if (!refreshToken) {
      throw new Error("Not connected to Google Search Console.");
    }

    try {
      await oauth2.getAccessToken();
    } catch {
      throw new Error("Failed to refresh Google access token. Reconnect Google Search Console and try again.");
    }

    await upsertTokens({
      userId,
      refreshToken,
      accessToken: oauth2.credentials.access_token ?? undefined,
      expiryDate: oauth2.credentials.expiry_date ?? undefined,
    });
  }

  const searchconsole = google.searchconsole({ version: "v1", auth: oauth2 });
  return { oauth2, searchconsole };
}
