import "server-only";

import { sql } from "@vercel/postgres";

export type UserRow = {
  id: string;
  google_sub: string;
  email: string;
  name: string | null;
  role: "user" | "admin";
  created_at: string;
};

export type SubscriptionRow = {
  user_id: string;
  stripe_subscription_id: string | null;
  status: string;
  current_period_end: string | null;
  updated_at: string;
};

export type UsageRow = {
  user_id: string;
  questions_used: number;
  pending_question: string | null;
  updated_at: string;
};

export async function upsertUserFromGoogle(input: {
  googleSub: string;
  email: string;
  name?: string | null;
}): Promise<{ id: string; email: string; name: string | null }> {
  const result = await sql<Pick<UserRow, "id" | "email" | "name">>`
    INSERT INTO users (google_sub, email, name)
    VALUES (${input.googleSub}, ${input.email}, ${input.name ?? null})
    ON CONFLICT (google_sub) DO UPDATE SET
      email = EXCLUDED.email,
      name = EXCLUDED.name
    RETURNING id, email, name
  `;

  const row = result.rows[0];
  if (!row) throw new Error("Failed to upsert user.");
  return { id: row.id, email: row.email, name: row.name };
}

export async function getUserById(
  userId: string,
): Promise<{ id: string; email: string; name: string | null; role: "user" | "admin" } | undefined> {
  const result = await sql<Pick<UserRow, "id" | "email" | "name" | "role">>`
    SELECT id, email, name, role
    FROM users
    WHERE id = ${userId}
    LIMIT 1
  `;
  return result.rows[0];
}

export async function getUserRoleById(userId: string): Promise<"user" | "admin" | undefined> {
  const result = await sql<Pick<UserRow, "role">>`
    SELECT role
    FROM users
    WHERE id = ${userId}
    LIMIT 1
  `;
  const role = result.rows[0]?.role;
  if (role === "admin" || role === "user") return role;
  return undefined;
}

export type AdminUserListRow = {
  id: string;
  email: string;
  name: string | null;
  role: "user" | "admin";
  created_at: string;
  questions_used: number;
};

export async function listUsersForAdmin(): Promise<AdminUserListRow[]> {
  const result = await sql<AdminUserListRow>`
    SELECT
      u.id,
      u.email,
      u.name,
      u.role,
      u.created_at,
      COALESCE(us.questions_used, 0) AS questions_used
    FROM users u
    LEFT JOIN usage us ON us.user_id = u.id
    ORDER BY u.created_at DESC
    LIMIT 500
  `;
  return result.rows;
}

export async function setUserRoleByEmail(input: {
  email: string;
  role: "user" | "admin";
}): Promise<Pick<UserRow, "id" | "email" | "name" | "role" | "created_at"> | undefined> {
  const result = await sql<Pick<UserRow, "id" | "email" | "name" | "role" | "created_at">>`
    UPDATE users
    SET role = ${input.role}
    WHERE lower(email) = lower(${input.email})
    RETURNING id, email, name, role, created_at
  `;
  return result.rows[0];
}

export async function ensureUsageRow(userId: string): Promise<void> {
  try {
    await sql`
      INSERT INTO usage (user_id, questions_used)
      VALUES (${userId}, 0)
      ON CONFLICT (user_id) DO NOTHING
    `;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/relation\s+\"usage\"\s+does\s+not\s+exist/i.test(msg)) {
      throw new Error('Database is missing billing/paywall tables. Run `npm run migrate` (or execute `migrations/001_paywall.sql`).');
    }
    if (/violates foreign key constraint \"usage_user_id_fkey\"/i.test(msg)) {
      throw new Error("Session user is not present in `users`. Please log out and continue with Google again.");
    }
    throw err;
  }
}

export async function getUsageRow(userId: string): Promise<UsageRow | undefined> {
  const result = await sql<UsageRow>`
    SELECT user_id, questions_used, pending_question, updated_at
    FROM usage
    WHERE user_id = ${userId}
    LIMIT 1
  `;
  return result.rows[0];
}

export async function incrementQuestionsUsed(userId: string): Promise<number | undefined> {
  const result = await sql<{ questions_used: number }>`
    UPDATE usage
    SET questions_used = questions_used + 1, updated_at = now()
    WHERE user_id = ${userId} AND questions_used < 3
    RETURNING questions_used
  `;
  return result.rows[0]?.questions_used;
}

export async function setPendingQuestion(userId: string, question: string): Promise<void> {
  await sql`
    INSERT INTO usage (user_id, questions_used, pending_question)
    VALUES (${userId}, 0, ${question})
    ON CONFLICT (user_id) DO UPDATE SET
      pending_question = EXCLUDED.pending_question,
      updated_at = now()
  `;
}

export async function clearPendingQuestion(userId: string): Promise<void> {
  await sql`
    UPDATE usage
    SET pending_question = NULL, updated_at = now()
    WHERE user_id = ${userId}
  `;
}

export async function getStripeCustomerId(userId: string): Promise<string | undefined> {
  const result = await sql<{ stripe_customer_id: string }>`
    SELECT stripe_customer_id
    FROM stripe_customers
    WHERE user_id = ${userId}
    LIMIT 1
  `;
  return result.rows[0]?.stripe_customer_id;
}

export async function upsertStripeCustomer(userId: string, stripeCustomerId: string): Promise<void> {
  await sql`
    INSERT INTO stripe_customers (user_id, stripe_customer_id)
    VALUES (${userId}, ${stripeCustomerId})
    ON CONFLICT (user_id) DO UPDATE SET
      stripe_customer_id = EXCLUDED.stripe_customer_id
  `;
}

export async function getSubscriptionRow(userId: string): Promise<SubscriptionRow | undefined> {
  const result = await sql<SubscriptionRow>`
    SELECT user_id, stripe_subscription_id, status, current_period_end, updated_at
    FROM subscriptions
    WHERE user_id = ${userId}
    LIMIT 1
  `;
  return result.rows[0];
}

export async function upsertSubscription(input: {
  userId: string;
  stripeSubscriptionId: string | null;
  status: string;
  currentPeriodEnd: Date | null;
}): Promise<void> {
  const cpe = input.currentPeriodEnd ? input.currentPeriodEnd.toISOString() : null;
  await sql`
    INSERT INTO subscriptions (user_id, stripe_subscription_id, status, current_period_end, updated_at)
    VALUES (${input.userId}, ${input.stripeSubscriptionId}, ${input.status}, ${cpe}, now())
    ON CONFLICT (user_id) DO UPDATE SET
      stripe_subscription_id = EXCLUDED.stripe_subscription_id,
      status = EXCLUDED.status,
      current_period_end = EXCLUDED.current_period_end,
      updated_at = now()
  `;
}

export async function getUserIdByStripeCustomerId(stripeCustomerId: string): Promise<string | undefined> {
  const result = await sql<{ user_id: string }>`
    SELECT user_id
    FROM stripe_customers
    WHERE stripe_customer_id = ${stripeCustomerId}
    LIMIT 1
  `;
  return result.rows[0]?.user_id;
}

export async function markStripeEventProcessed(eventId: string, type: string): Promise<boolean> {
  const result = await sql<{ event_id: string }>`
    INSERT INTO stripe_events (event_id, type)
    VALUES (${eventId}, ${type})
    ON CONFLICT (event_id) DO NOTHING
    RETURNING event_id
  `;
  return Boolean(result.rows[0]?.event_id);
}
