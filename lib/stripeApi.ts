import "server-only";

import crypto from "node:crypto";
import { requireEnv } from "@/lib/session";

type StripeMode = "subscription";

function stripeSecretKey(): string {
  return requireEnv("STRIPE_SECRET_KEY");
}

function stripeApiBase(): string {
  return "https://api.stripe.com/v1";
}

function encodeForm(data: Record<string, string | number | boolean | null | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (v === null) continue;
    params.set(k, String(v));
  }
  return params;
}

async function stripeRequest<T>(input: {
  method: "GET" | "POST";
  path: string;
  form?: URLSearchParams;
  idempotencyKey?: string;
}): Promise<T> {
  const url = `${stripeApiBase()}${input.path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${stripeSecretKey()}`,
  };
  if (input.idempotencyKey) headers["Idempotency-Key"] = input.idempotencyKey;
  if (input.method === "POST") headers["Content-Type"] = "application/x-www-form-urlencoded";

  const res = await fetch(url, {
    method: input.method,
    headers,
    body: input.method === "POST" ? input.form?.toString() : undefined,
    cache: "no-store",
  });

  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : {};

  if (!res.ok) {
    const msg =
      typeof (json as { error?: { message?: unknown } }).error?.message === "string"
        ? (json as { error: { message: string } }).error.message
        : `Stripe API request failed (${res.status}).`;
    throw new Error(msg);
  }

  return json as T;
}

export async function createStripeCustomer(input: {
  email: string;
  name?: string | null;
  userId: string;
}): Promise<{ id: string }> {
  const form = new URLSearchParams();
  form.set("email", input.email);
  if (input.name) form.set("name", input.name);
  form.set("metadata[user_id]", input.userId);

  return stripeRequest<{ id: string }>({
    method: "POST",
    path: "/customers",
    form,
    idempotencyKey: `cust_${input.userId}`,
  });
}

export async function createCheckoutSession(input: {
  mode: StripeMode;
  customerId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  userId: string;
}): Promise<{ id: string; url: string | null }> {
  const form = new URLSearchParams();
  form.set("mode", input.mode);
  form.set("customer", input.customerId);
  form.set("success_url", input.successUrl);
  form.set("cancel_url", input.cancelUrl);
  form.set("client_reference_id", input.userId);
  form.set("subscription_data[metadata][user_id]", input.userId);
  form.set("line_items[0][price]", input.priceId);
  form.set("line_items[0][quantity]", "1");

  return stripeRequest<{ id: string; url: string | null }>({
    method: "POST",
    path: "/checkout/sessions",
    form,
    idempotencyKey: `co_${input.userId}_${crypto.randomUUID()}`,
  });
}

export type StripeCheckoutSession = {
  id: string;
  customer: string | null;
  subscription: string | null;
  payment_status: string | null;
  status: string | null;
  client_reference_id?: string | null;
};

export async function retrieveCheckoutSession(sessionId: string): Promise<StripeCheckoutSession> {
  // Stripe supports expand params, but for minimal parsing this is enough.
  return stripeRequest<StripeCheckoutSession>({
    method: "GET",
    path: `/checkout/sessions/${encodeURIComponent(sessionId)}`,
  });
}

export type StripeSubscription = {
  id: string;
  customer: string;
  status: string;
  current_period_end: number | null;
};

export async function retrieveSubscription(subscriptionId: string): Promise<StripeSubscription> {
  return stripeRequest<StripeSubscription>({
    method: "GET",
    path: `/subscriptions/${encodeURIComponent(subscriptionId)}`,
  });
}

function timingSafeEqualHex(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, "hex");
  const b = Buffer.from(bHex, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function verifyStripeWebhookSignature(input: {
  payload: string;
  signatureHeader: string;
  webhookSecret: string;
}): void {
  // Stripe signature format: "t=...,v1=...,v0=..."
  const parts = input.signatureHeader.split(",").map((p) => p.trim());
  const tPart = parts.find((p) => p.startsWith("t="));
  const v1Parts = parts.filter((p) => p.startsWith("v1="));
  if (!tPart || v1Parts.length === 0) {
    throw new Error("Invalid Stripe-Signature header.");
  }

  const timestamp = tPart.slice(2);
  const signedPayload = `${timestamp}.${input.payload}`;
  const expected = crypto
    .createHmac("sha256", input.webhookSecret)
    .update(signedPayload, "utf8")
    .digest("hex");

  const ok = v1Parts.some((p) => timingSafeEqualHex(expected, p.slice(3)));
  if (!ok) throw new Error("Invalid Stripe webhook signature.");
}

export function unixSecondsToDate(seconds: number | null | undefined): Date | null {
  if (!seconds || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000);
}
