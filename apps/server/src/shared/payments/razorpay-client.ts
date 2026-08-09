// Phase 4 Feature K.2 — Razorpay outbound API wrapper (subscription
// create). Mirrors the exotel/twilio wrappers: native `fetch`, Basic
// auth, request timeout, typed response guard, throws on any failure so
// the calling service maps it to a single typed DomainError.
//
// This is the ONLY outbound Razorpay call in the app — the webhook path
// is inbound and signature-verified, never calls back out. Keeping the
// HTTP here (not in the service) lets the service integration test stub
// `globalThis.fetch` the same way expo-push.test.ts does.
//
// API reference: https://razorpay.com/docs/api/payments/subscriptions/
//   POST https://api.razorpay.com/v1/subscriptions
//   Basic auth: RAZORPAY_KEY_ID:RAZORPAY_KEY_SECRET
//   JSON body: { plan_id, total_count, quantity, customer_notify, notes }

import { env } from "../../config/env.js";
import { logger } from "../logger.js";

const RAZORPAY_SUBSCRIPTIONS_URL = "https://api.razorpay.com/v1/subscriptions";
const REQUEST_TIMEOUT_MS = 10_000;

/** True when the two credentials needed to sign an API call are set. */
export const razorpayApiConfigured = (): boolean =>
  Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);

export interface CreateSubscriptionParams {
  planId: string;
  /** Number of billing cycles the mandate authorises. */
  totalCount: number;
  /** Surfaced verbatim on the subscription + every webhook so the
   *  inbound handler can resolve the local user + purchased tier. */
  notes: Record<string, string>;
}

export interface RazorpaySubscription {
  id: string;
  status: string;
  /** Hosted-checkout URL Razorpay returns for the subscription. */
  shortUrl: string | null;
}

/** Type guard for the subset of the Razorpay subscription entity we use. */
const isSubscriptionEntity = (
  body: unknown,
): body is { id: string; status?: string; short_url?: string } =>
  typeof body === "object" && body !== null && typeof (body as { id?: unknown }).id === "string";

/**
 * Create a subscription on Razorpay's side. Throws on missing
 * credentials, network failure, non-2xx, or an unexpected response
 * shape — the caller maps every throw to PAYMENT_PROVIDER_UNAVAILABLE.
 */
export const createRazorpaySubscription = async (
  params: CreateSubscriptionParams,
): Promise<RazorpaySubscription> => {
  if (!razorpayApiConfigured()) {
    throw new Error("Razorpay credentials missing (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)");
  }

  const auth = Buffer.from(`${env.RAZORPAY_KEY_ID!}:${env.RAZORPAY_KEY_SECRET!}`).toString(
    "base64",
  );

  const res = await fetch(RAZORPAY_SUBSCRIPTIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      plan_id: params.planId,
      total_count: params.totalCount,
      quantity: 1,
      customer_notify: 1,
      notes: params.notes,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "<unreadable>");
    logger.error(
      { status: res.status, body: text.slice(0, 500) },
      "razorpay create-subscription failed",
    );
    throw new Error(`Razorpay HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const json: unknown = await res.json();
  if (!isSubscriptionEntity(json)) {
    logger.error({ json }, "razorpay create-subscription response missing id");
    throw new Error("Razorpay response missing subscription id");
  }

  return {
    id: json.id,
    status: json.status ?? "created",
    shortUrl: typeof json.short_url === "string" ? json.short_url : null,
  };
};
