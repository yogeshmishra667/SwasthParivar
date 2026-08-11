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
// Razorpay caps `count` at 100 per page; the reconciliation cron pages
// through with `skip` until fewer than a full page comes back.
const LIST_PAGE_SIZE = 100;
const LIST_MAX_PAGES = 50; // hard ceiling — 5000 subs/day is well past any realistic volume

/** True when the two credentials needed to sign an API call are set. */
export const razorpayApiConfigured = (): boolean =>
  Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);

const basicAuthHeader = (): string =>
  `Basic ${Buffer.from(`${env.RAZORPAY_KEY_ID!}:${env.RAZORPAY_KEY_SECRET!}`).toString("base64")}`;

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

  const res = await fetch(RAZORPAY_SUBSCRIPTIONS_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
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

// ── List subscriptions (Phase 4 §K — RAZORPAY_RECONCILIATION) ────────
//
// The reconciliation cron pulls the last 24h of subscription state to
// close the missed-webhook gap (Razorpay outages). This is the ONLY
// other outbound call besides create; it is READ-only. Kept here (not in
// the worker) so the reconciliation integration test can stub
// `globalThis.fetch` exactly like the create-subscription test does.
//   GET https://api.razorpay.com/v1/subscriptions?from=&to=&count=&skip=

/** The subset of the Razorpay subscription entity reconciliation reads. */
export interface RazorpaySubscriptionState {
  id: string;
  status: string;
  /** Unix seconds; absent on some statuses. */
  currentEnd: number | null;
  notes: Record<string, unknown>;
}

interface RawSubscriptionEntity {
  id?: unknown;
  status?: unknown;
  current_end?: unknown;
  notes?: unknown;
}

const toSubscriptionState = (raw: RawSubscriptionEntity): RazorpaySubscriptionState | null => {
  if (typeof raw.id !== "string") return null;
  return {
    id: raw.id,
    status: typeof raw.status === "string" ? raw.status : "unknown",
    currentEnd: typeof raw.current_end === "number" ? raw.current_end : null,
    notes:
      typeof raw.notes === "object" && raw.notes !== null
        ? (raw.notes as Record<string, unknown>)
        : {},
  };
};

/**
 * List subscriptions whose activity falls in `[fromUnix, toUnix]` (unix
 * seconds), paging through Razorpay's 100-per-page collection. Throws on
 * missing credentials, network failure, non-2xx, or an unusable shape —
 * the caller (reconciliation cron) logs + skips the run on any throw so
 * a provider hiccup never corrupts local state.
 */
export const listRazorpaySubscriptions = async (params: {
  fromUnix: number;
  toUnix: number;
}): Promise<RazorpaySubscriptionState[]> => {
  if (!razorpayApiConfigured()) {
    throw new Error("Razorpay credentials missing (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)");
  }

  const out: RazorpaySubscriptionState[] = [];
  for (let page = 0; page < LIST_MAX_PAGES; page += 1) {
    const url = new URL(RAZORPAY_SUBSCRIPTIONS_URL);
    url.searchParams.set("from", String(params.fromUnix));
    url.searchParams.set("to", String(params.toUnix));
    url.searchParams.set("count", String(LIST_PAGE_SIZE));
    url.searchParams.set("skip", String(page * LIST_PAGE_SIZE));

    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: basicAuthHeader(), Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "<unreadable>");
      logger.error(
        { status: res.status, body: text.slice(0, 500) },
        "razorpay list-subscriptions failed",
      );
      throw new Error(`Razorpay HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const json: unknown = await res.json();
    const items = (json as { items?: unknown }).items;
    if (!Array.isArray(items)) {
      throw new Error("Razorpay list-subscriptions response missing items[]");
    }
    for (const raw of items as RawSubscriptionEntity[]) {
      const state = toSubscriptionState(raw);
      if (state) out.push(state);
    }
    if (items.length < LIST_PAGE_SIZE) break; // last page
  }
  return out;
};
