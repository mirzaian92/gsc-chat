import "server-only";

import { ensureUsageRow, getSubscriptionRow, getUsageRow, getUserById } from "@/lib/appDb";

export type UserEntitlements = {
  isAdmin: boolean;
  isPro: boolean;
  questionsUsed: number;
  remainingFree: number;
  pendingQuestion: string | null;
  planLabel: "Free" | "Pro";
  role: "user" | "admin";
  subscription?: { status: string; currentPeriodEnd: string | null };
};

function isSubscriptionActive(input: { status: string; currentPeriodEnd: string | null }): boolean {
  const status = input.status;
  const cpe = input.currentPeriodEnd ? new Date(input.currentPeriodEnd) : null;
  const now = Date.now();

  if (status === "active" || status === "trialing" || status === "past_due") {
    if (!cpe) return true;
    return cpe.getTime() >= now;
  }

  if (status === "canceled") {
    if (!cpe) return false;
    return cpe.getTime() >= now;
  }

  return false;
}

export async function getUserEntitlements(userId: string): Promise<UserEntitlements> {
  await ensureUsageRow(userId);

  const [usage, sub, user] = await Promise.all([getUsageRow(userId), getSubscriptionRow(userId), getUserById(userId)]);
  const questionsUsed = usage?.questions_used ?? 0;
  const pendingQuestion = usage?.pending_question ?? null;

  const role: "user" | "admin" = user?.role === "admin" ? "admin" : "user";
  const isAdmin = role === "admin";

  const subscription = sub ? { status: sub.status, currentPeriodEnd: sub.current_period_end } : undefined;
  const isPro = isAdmin ? true : subscription ? isSubscriptionActive(subscription) : false;
  const remainingFree = isAdmin ? 999999 : isPro ? 0 : Math.max(0, 3 - questionsUsed);

  return {
    isAdmin,
    isPro,
    questionsUsed,
    remainingFree,
    pendingQuestion,
    planLabel: isPro ? "Pro" : "Free",
    role,
    subscription,
  };
}
