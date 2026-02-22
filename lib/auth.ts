import "server-only";

import type { IronSession } from "iron-session";
import type { SessionData } from "@/lib/session";
import { getUserById } from "@/lib/appDb";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function getValidatedUserId(session: IronSession<SessionData>): Promise<string | null> {
  const userId = session.userId;
  if (!userId || typeof userId !== "string" || !isUuid(userId)) {
    // NOTE: In Next.js App Router, cookies can only be mutated in Route Handlers or Server Actions.
    // Callers in Server Components (e.g. layouts) must not destroy the session here.
    return null;
  }

  const user = await getUserById(userId);
  if (!user) {
    return null;
  }

  return userId;
}

export async function getValidatedUserIdForRoute(session: IronSession<SessionData>): Promise<string | null> {
  const userId = await getValidatedUserId(session);
  if (userId) return userId;
  session.destroy();
  return null;
}
