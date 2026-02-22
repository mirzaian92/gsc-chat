import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { getSession, requireEnv } from "@/lib/session";
import { getUserEntitlements } from "@/lib/entitlements";
import { createCheckoutSession, createStripeCustomer } from "@/lib/stripeApi";
import { getStripeCustomerId, getUserById, upsertStripeCustomer } from "@/lib/appDb";
import { getValidatedUserIdForRoute } from "@/lib/auth";

export const runtime = "nodejs";

function getAppUrl(req: NextRequest): string {
  const configured = process.env.APP_URL;
  if (configured && configured.trim()) return configured.replace(/\/+$/, "");
  return new URL(req.url).origin;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  const userId = await getValidatedUserIdForRoute(session);
  if (!userId) {
    return NextResponse.json(
      { error: "Session expired or invalid. Please continue with Google again." },
      { status: 401 },
    );
  }

  const ent = await getUserEntitlements(userId);
  if (ent.isPro) {
    return NextResponse.json({ error: "Already subscribed." }, { status: 400 });
  }

  const priceId = requireEnv("STRIPE_PRICE_ID");
  const appUrl = getAppUrl(req);

  let customerId = await getStripeCustomerId(userId);
  if (!customerId) {
    const user = await getUserById(userId);
    if (!user?.email) {
      return NextResponse.json({ error: "User profile not found." }, { status: 500 });
    }

    const customer = await createStripeCustomer({ email: user.email, name: user.name, userId });
    customerId = customer.id;
    await upsertStripeCustomer(userId, customerId);
  }

  const successUrl = `${appUrl}/app?checkout=success&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${appUrl}/app?checkout=cancel`;

  const checkout = await createCheckoutSession({
    mode: "subscription",
    customerId,
    priceId,
    successUrl,
    cancelUrl,
    userId,
  });

  return NextResponse.json({ url: checkout.url, id: checkout.id });
}
