import { DomainError } from "@swasth/shared-types";
import {
  razorpayEventToTransition,
  verifyRazorpaySignature,
  type SubscriptionTier,
} from "@swasth/domain-logic/subscription-state";
import type { Prisma, Subscription, SubscriptionProvider } from "@prisma/client";
import { prisma } from "../../shared/database.js";
import { redis } from "../../shared/redis.js";
import { env } from "../../config/env.js";
import { getFlag } from "../../shared/flags/flags.js";
import { logger } from "../../shared/logger.js";
import { capture } from "../../shared/analytics/posthog.js";
import { captureUnhandled } from "../../shared/observability/sentry.js";
import {
  createRazorpaySubscription,
  razorpayApiConfigured,
} from "../../shared/payments/razorpay-client.js";
import { createHash, randomUUID } from "node:crypto";

// Billing cycles the mandate authorises at checkout. Monthly plan × 12
// = one year of authorised charges; `subscription.charged` webhooks
// extend `currentPeriodEnd` each cycle.
const SUBSCRIPTION_TOTAL_COUNT = 12;

// CLAUDE.md "Payment Webhook Safety": dedup 24h TTL; subscription mutex
// 5s lease.
const DEDUP_TTL_SECONDS = 24 * 60 * 60;
const MUTEX_LEASE_MS = 5_000;
const MUTEX_RETRY_MS = 100;
const MUTEX_MAX_WAIT_MS = 5_000;

export interface RazorpayWebhookInput {
  rawBody: Buffer;
  signature: string | undefined;
  /** `x-razorpay-event-id` header — the idempotency key when present. */
  eventId: string | undefined;
}

export interface RazorpayWebhookResult {
  ok: true;
  idempotentReplay: boolean;
  action: string;
}

interface RazorpayBody {
  event?: string;
  payload?: {
    subscription?: { entity?: RazorpaySubscriptionEntity };
    refund?: { entity?: { notes?: Record<string, unknown> } };
  };
}
interface RazorpaySubscriptionEntity {
  id?: string;
  current_end?: number; // unix seconds
  notes?: Record<string, unknown>;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Exported so the Apple IAP service (K.3) shares one subscription mutex
// with the Razorpay path — a Razorpay and an Apple webhook for the same
// user still serialise on `lock:subscription:${userId}`.
// Returns a unique ownership token on success, or null on timeout. The
// token is required to release — a fixed value would let a worker whose
// lease already expired (and was re-acquired by someone else) delete the
// new holder's lock.
export const acquireSubscriptionLock = async (userId: string): Promise<string | null> => {
  const key = `lock:subscription:${userId}`;
  const owner = randomUUID();
  const deadline = Date.now() + MUTEX_MAX_WAIT_MS;
  for (;;) {
    const res = await redis.set(key, owner, "PX", MUTEX_LEASE_MS, "NX");
    if (res === "OK") return owner;
    if (Date.now() >= deadline) return null;
    await sleep(MUTEX_RETRY_MS);
  }
};

// Ownership-checked release: only clear the lock if it still holds OUR
// owner id, so a lease that already expired and was re-acquired by
// another worker is never deleted out from under it. The short lease is
// the backstop for the residual GET→DEL window.
export const releaseSubscriptionLock = async (userId: string, owner: string): Promise<void> => {
  const key = `lock:subscription:${userId}`;
  try {
    if ((await redis.get(key)) === owner) {
      await redis.del(key);
    }
  } catch {
    /* lease expires on its own */
  }
};

const asString = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/**
 * Resolve the local user a webhook concerns: prefer an existing
 * Subscription row keyed by the Razorpay subscription id, else fall back
 * to `notes.user_id`/`notes.userId` set at create-subscription time.
 */
export const resolveUser = async (
  providerSubscriptionId: string | undefined,
  notes: Record<string, unknown> | undefined,
): Promise<{ userId: string; existing: Subscription | null } | null> => {
  if (providerSubscriptionId) {
    const existing = await prisma.subscription.findFirst({
      where: { providerSubscriptionId },
    });
    if (existing?.userId) return { userId: existing.userId, existing };
  }
  const fromNotes = asString(notes?.user_id) ?? asString(notes?.userId);
  if (fromNotes) {
    const existing = providerSubscriptionId
      ? await prisma.subscription.findFirst({ where: { providerSubscriptionId } })
      : await prisma.subscription.findUnique({ where: { userId: fromNotes } });
    return { userId: fromNotes, existing };
  }
  return null;
};

export const processRazorpayWebhook = async (
  input: RazorpayWebhookInput,
): Promise<RazorpayWebhookResult> => {
  const enabled = await getFlag<boolean>("payments_razorpay_enabled", false);
  if (!enabled) {
    throw new DomainError("PAYMENT_PROVIDER_UNAVAILABLE", "Razorpay payments are not enabled.");
  }

  const secret = env.RAZORPAY_WEBHOOK_SECRET ?? "";
  // Signature failure → 401, NO state change, paged to Sentry. We do not
  // persist an attacker-controllable PaymentEvent on a bad signature.
  if (!verifyRazorpaySignature(input.rawBody, input.signature, secret)) {
    captureUnhandled(new Error("razorpay webhook signature verification failed"), {
      tags: { surface: "payments", provider: "razorpay" },
    });
    throw new DomainError("PAYMENT_WEBHOOK_INVALID_SIGNATURE", "invalid webhook signature");
  }

  // Idempotency — same event id (or body hash) within 24h → no-op.
  const dedupId =
    input.eventId ?? createHash("sha256").update(input.rawBody).digest("hex").slice(0, 32);
  const dedupKey = `payment:razorpay:event:${dedupId}`;
  const fresh = await redis.set(dedupKey, "1", "EX", DEDUP_TTL_SECONDS, "NX");
  if (fresh !== "OK") {
    return { ok: true, idempotentReplay: true, action: "duplicate" };
  }

  // The dedup slot is claimed BEFORE processing to serialise concurrent
  // duplicates. If processing then fails, release the slot so the
  // provider's retry re-processes instead of being deduped into a no-op.
  try {
    const body = JSON.parse(input.rawBody.toString("utf8")) as RazorpayBody;
    const eventType = body.event ?? "unknown";
    const subEntity = body.payload?.subscription?.entity;
    const notes = subEntity?.notes ?? body.payload?.refund?.entity?.notes;

    const resolved = await resolveUser(subEntity?.id, notes);
    if (!resolved) {
      // Verified but unattributable — store for audit, acknowledge (200).
      await prisma.paymentEvent.create({
        data: {
          provider: "razorpay",
          eventType,
          rawPayload: body as unknown as Prisma.InputJsonValue,
          signatureValid: true,
          errorMessage: "could not resolve user from payload",
        },
      });
      return { ok: true, idempotentReplay: false, action: "unattributed" };
    }

    const { userId, existing } = resolved;
    const lockToken = await acquireSubscriptionLock(userId);
    if (!lockToken) {
      throw new DomainError("PAYMENT_PROVIDER_UNAVAILABLE", "subscription is busy, retry");
    }

    try {
      return await applyRazorpayEvent({
        userId,
        eventType,
        body,
        subEntity,
        existing,
        provider: "razorpay",
      });
    } finally {
      await releaseSubscriptionLock(userId, lockToken);
    }
  } catch (err) {
    await redis.del(dedupKey).catch(() => undefined);
    throw err;
  }
};

interface ApplyInput {
  userId: string;
  /** The webhook event vocabulary that drives the pure transition. */
  eventType: string;
  body: RazorpayBody;
  subEntity: RazorpaySubscriptionEntity | undefined;
  existing: Subscription | null;
  provider: SubscriptionProvider;
  /**
   * Label recorded verbatim in `PaymentEvent.eventType` when it should
   * differ from `eventType` — the reconciliation cron replays webhook
   * events but tags the audit row `reconcile:<status>` so ops can tell a
   * correction from a real webhook. Defaults to `eventType`.
   */
  auditEventType?: string;
}

// Exported so the reconciliation cron (Phase 4 §K) drives tier
// transitions through the EXACT same atomic path as the webhook — one
// upsert + optional tier write + PaymentEvent audit, in one transaction,
// never deleting any patient-health row.
export const applyRazorpayEvent = async (a: ApplyInput): Promise<RazorpayWebhookResult> => {
  const user = await prisma.user.findUnique({ where: { id: a.userId }, select: { tier: true } });
  const currentTier: SubscriptionTier = user?.tier ?? "free";
  // Validate rather than blind-cast: an unexpected `notes.tier` must not
  // reach the DB as a bogus enum. Unknown → undefined (the transition
  // helper then defaults `activate` to premium).
  const rawTier = asString(a.subEntity?.notes?.tier);
  const purchased: SubscriptionTier | undefined =
    rawTier === "premium" || rawTier === "family" ? rawTier : undefined;

  const decision = razorpayEventToTransition({
    eventType: a.eventType,
    currentTier,
    ...(purchased ? { purchasedTier: purchased } : {}),
  });

  const periodEnd =
    typeof a.subEntity?.current_end === "number"
      ? new Date(a.subEntity.current_end * 1000)
      : (a.existing?.currentPeriodEnd ?? new Date(Date.now() + 30 * 86_400_000));

  // One atomic transaction: never deletes any patient-health row — only
  // upserts the Subscription and (when the decision says so) writes
  // User.tier. CLAUDE.md "Tier Downgrade Data-Retention Rule".
  await prisma.$transaction(async (tx) => {
    if (a.eventType !== "unknown" && decision.action !== "ignore") {
      await tx.subscription.upsert({
        where: { userId: a.userId },
        create: {
          userId: a.userId,
          tier: decision.targetTier,
          provider: a.provider,
          ...(a.subEntity?.id ? { providerSubscriptionId: a.subEntity.id } : {}),
          status: decision.status,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: decision.cancelAtPeriodEnd,
          ...(decision.action === "downgrade" || decision.action === "schedule_cancel"
            ? { cancelledAt: new Date() }
            : {}),
        },
        update: {
          tier: decision.targetTier,
          status: decision.status,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: decision.cancelAtPeriodEnd,
          ...(a.subEntity?.id ? { providerSubscriptionId: a.subEntity.id } : {}),
          ...(decision.action === "downgrade" || decision.action === "schedule_cancel"
            ? { cancelledAt: new Date() }
            : {}),
        },
      });
    }

    if (decision.changesTier) {
      await tx.user.update({ where: { id: a.userId }, data: { tier: decision.targetTier } });
    }

    await tx.paymentEvent.create({
      data: {
        userId: a.userId,
        provider: a.provider,
        eventType: a.auditEventType ?? a.eventType,
        rawPayload: a.body as unknown as Prisma.InputJsonValue,
        signatureValid: true,
        processedAt: new Date(),
      },
    });
  });

  if (decision.changesTier) {
    const reason =
      decision.action === "activate"
        ? "purchase"
        : // A refund event downgrades for a refund; a
          // completed/expired/lapsed downgrade is not a refund.
          decision.action === "downgrade"
          ? a.eventType.startsWith("refund")
            ? "refund"
            : "expired"
          : "cancelled";
    capture("tier_changed", a.userId, {
      from: currentTier,
      to: decision.targetTier,
      reason,
      provider: a.provider,
    });
  }
  capture("payment_webhook_processed", a.userId, {
    provider: a.provider,
    event_type: a.eventType,
    action: decision.action,
    idempotent_replay: false,
  });
  logger.info(
    { userId: a.userId, eventType: a.eventType, action: decision.action },
    "razorpay webhook processed",
  );

  return { ok: true, idempotentReplay: false, action: decision.action };
};

export const getSubscriptionForUser = async (userId: string): Promise<Subscription | null> =>
  await prisma.subscription.findUnique({ where: { userId } });

// ── Create-subscription (phase4.md §K.2) ────────────────────────────

export type PurchasableTier = "premium" | "family";

export interface CreateSubscriptionResult {
  providerSubscriptionId: string;
  status: string;
  /** Hosted-checkout URL, if Razorpay returned one. */
  shortUrl: string | null;
  /** Public key id the mobile checkout SDK needs. Never the secret. */
  keyId: string;
  tier: PurchasableTier;
}

const planIdForTier = (tier: PurchasableTier): string | undefined =>
  tier === "premium" ? env.RAZORPAY_PLAN_ID_PREMIUM : env.RAZORPAY_PLAN_ID_FAMILY;

/**
 * Create a subscription on Razorpay's side and return the checkout
 * config the client needs. Does NOT change the caller's tier or write a
 * local Subscription row — tier only moves when the signature-verified
 * `subscription.activated` webhook lands. The `notes.user_id`/`tier`
 * we attach here are exactly what that webhook's `resolveUser` reads to
 * attribute the activation back to this user.
 */
export const createRazorpaySubscriptionForUser = async (input: {
  userId: string;
  tier: PurchasableTier;
}): Promise<CreateSubscriptionResult> => {
  const enabled = await getFlag<boolean>("payments_razorpay_enabled", false);
  if (!enabled) {
    throw new DomainError("PAYMENT_PROVIDER_UNAVAILABLE", "Razorpay payments are not enabled.");
  }

  const planId = planIdForTier(input.tier);
  if (!razorpayApiConfigured() || !planId) {
    throw new DomainError(
      "PAYMENT_PROVIDER_UNAVAILABLE",
      `Razorpay is not configured for the ${input.tier} plan.`,
    );
  }

  let subscription;
  try {
    subscription = await createRazorpaySubscription({
      planId,
      totalCount: SUBSCRIPTION_TOTAL_COUNT,
      notes: { user_id: input.userId, tier: input.tier },
    });
  } catch (err) {
    captureUnhandled(err instanceof Error ? err : new Error(String(err)), {
      tags: { surface: "payments", provider: "razorpay", op: "create_subscription" },
    });
    throw new DomainError(
      "PAYMENT_PROVIDER_UNAVAILABLE",
      "Could not start the payment. Try again.",
    );
  }

  logger.info(
    { userId: input.userId, tier: input.tier, providerSubscriptionId: subscription.id },
    "razorpay subscription created",
  );

  return {
    providerSubscriptionId: subscription.id,
    status: subscription.status,
    shortUrl: subscription.shortUrl,
    keyId: env.RAZORPAY_KEY_ID!,
    tier: input.tier,
  };
};
