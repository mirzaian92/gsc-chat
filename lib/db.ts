import "server-only";

import { sql } from "@vercel/postgres";

export type GscTokenRow = {
  user_id: string;
  refresh_token: string;
  access_token: string | null;
  expiry_date: number | null;
};

type DbGscTokenRow = {
  user_id: string;
  refresh_token: string;
  access_token: string | null;
  expiry_date: string | number | null;
};

let initPromise: Promise<void> | undefined;

export function initDb(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS gsc_tokens (
          user_id TEXT PRIMARY KEY,
          refresh_token TEXT NOT NULL,
          access_token TEXT,
          expiry_date BIGINT
        );
      `;
    })();
  }
  return initPromise;
}

export async function upsertTokens(input: {
  userId: string;
  refreshToken: string;
  accessToken?: string;
  expiryDate?: number;
}): Promise<void> {
  await initDb();

  const accessToken = input.accessToken ?? null;
  const expiryDate = input.expiryDate ?? null;

  await sql`
    INSERT INTO gsc_tokens (user_id, refresh_token, access_token, expiry_date)
    VALUES (${input.userId}, ${input.refreshToken}, ${accessToken}, ${expiryDate})
    ON CONFLICT (user_id) DO UPDATE SET
      refresh_token = EXCLUDED.refresh_token,
      access_token = EXCLUDED.access_token,
      expiry_date = EXCLUDED.expiry_date
  `;
}

export async function getTokens(userId: string): Promise<GscTokenRow | undefined> {
  await initDb();

  const result = await sql<DbGscTokenRow>`
    SELECT user_id, refresh_token, access_token, expiry_date
    FROM gsc_tokens
    WHERE user_id = ${userId}
    LIMIT 1
  `;

  const row = result.rows[0];
  if (!row) return undefined;

  const expiry =
    row.expiry_date === null
      ? null
      : typeof row.expiry_date === "number"
        ? row.expiry_date
        : Number(row.expiry_date);

  if (expiry !== null && !Number.isFinite(expiry)) {
    throw new Error("Invalid expiry_date stored in gsc_tokens.");
  }

  return {
    user_id: row.user_id,
    refresh_token: row.refresh_token,
    access_token: row.access_token,
    expiry_date: expiry,
  };
}

