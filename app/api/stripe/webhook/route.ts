import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireEnv } from "@/lib/session";
import {
  markStripeEventProcessed,
  getUserIdByStripeCustomerId,
  upsertStripeCustomer,
  upsertSubscription,
} from "@/lib/appDb";
import { unixSecondsToDate, verifyStripeWebhookSignature } from "@/lib/stripeApi";

export const runtime = "nodejs";

type StripeEvent = {
  id: string;
  type: string;
  data: { object: unknown };
};

function asString(x: unknown): string | undefined {
  return typeof x === "string" && x.trim() ? x : undefined;
}

function isStripeEvent(x: unknown): x is StripeEvent {
  const e = x as StripeEvent;
  return typeof e?.id === "string" && typeof e?.type === "string" && typeof e?.data === "object" && e.data !== null;
}

export async function POST(req: NextRequest) {
  const payload = await req.text();
  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "Missing Stripe-Signature header." }, { status: 400 });

  try {
    verifyStripeWebhookSignature({
      payload,
      signatureHeader: sig,
      webhookSecret: requireEnv("STRIPE_WEBHOOK_SECRET"),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid signature.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload) as unknown;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  if (!isStripeEvent(parsed)) return NextResponse.json({ error: "Invalid Stripe event." }, { status: 400 });

  const shouldProcess = await markStripeEventProcessed(parsed.id, parsed.type);
  if (!shouldProcess) return NextResponse.json({ ok: true, deduped: true });

  // Handlers
  if (parsed.type === "checkout.session.completed") {
    const obj = parsed.data.object as {
      customer?: unknown;
      client_reference_id?: unknown;
    };
    const customerId = asString(obj.customer);
    const userId = asString(obj.client_reference_id);
    if (customerId && userId) {
      await upsertStripeCustomer(userId, customerId);
    }
    return NextResponse.json({ ok: true });
  }

  if (
    parsed.type === "customer.subscription.created" ||
    parsed.type === "customer.subscription.updated" ||
    parsed.type === "customer.subscription.deleted"
  ) {
    const sub = parsed.data.object as {
      id?: unknown;
      customer?: unknown;
      status?: unknown;
      current_period_end?: unknown;
      metadata?: unknown;
    };

    const subscriptionId = asString(sub.id) ?? null;
    const customerId = asString(sub.customer);
    const status = asString(sub.status);
    const cpeSeconds = typeof sub.current_period_end === "number" ? sub.current_period_end : null;

    if (!customerId || !status) return NextResponse.json({ ok: true });

    const metadata = (sub.metadata ?? {}) as { user_id?: unknown };
    const userIdFromMetadata = asString(metadata.user_id);
    const userId = userIdFromMetadata ?? (await getUserIdByStripeCustomerId(customerId));
    if (!userId) return NextResponse.json({ ok: true });

    await upsertSubscription({
      userId,
      stripeSubscriptionId: subscriptionId,
      status,
      currentPeriodEnd: unixSecondsToDate(cpeSeconds),
    });

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true });
}
