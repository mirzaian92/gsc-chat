import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { retrieveCheckoutSession, retrieveSubscription, unixSecondsToDate } from "@/lib/stripeApi";
import { upsertStripeCustomer, upsertSubscription } from "@/lib/appDb";
import { getValidatedUserIdForRoute } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await getSession();
  const userId = await getValidatedUserIdForRoute(session);
  if (!userId) {
    return NextResponse.json(
      { error: "Session expired or invalid. Please continue with Google again." },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const sessionId = (body as { sessionId?: unknown } | null | undefined)?.sessionId;
  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    return NextResponse.json({ error: "Missing sessionId." }, { status: 400 });
  }

  const checkout = await retrieveCheckoutSession(sessionId.trim());
  if (checkout.status !== "complete") {
    return NextResponse.json({ error: "Checkout is not complete." }, { status: 400 });
  }
  if (checkout.client_reference_id && checkout.client_reference_id !== userId) {
    return NextResponse.json({ error: "Checkout session does not match this user." }, { status: 403 });
  }
  if (!checkout.customer || !checkout.subscription) {
    return NextResponse.json({ error: "Checkout session missing customer or subscription." }, { status: 400 });
  }

  await upsertStripeCustomer(userId, checkout.customer);

  const sub = await retrieveSubscription(checkout.subscription);
  await upsertSubscription({
    userId,
    stripeSubscriptionId: sub.id,
    status: sub.status,
    currentPeriodEnd: unixSecondsToDate(sub.current_period_end),
  });

  return NextResponse.json({ ok: true, status: sub.status });
}
