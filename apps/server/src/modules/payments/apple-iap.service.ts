// Phase 4 Feature K.3 — Apple IAP: App Store Server Notifications V2
// (inbound webhook) + client-initiated receipt verification.
//
// Same safety spine as the Razorpay path (CLAUDE.md "Payment Webhook
// Safety"): signature verified BEFORE any state change, 24h Redis
// dedup, the shared `lock:subscription:${userId}` mutex, verbatim
// PaymentEvent audit, and the retention invariant — no code path here
// deletes patient health data; tier transitions only upsert the
// Subscription + flip User.tier.

import { DomainError } from "@swasth/shared-types";
import {
  verifyAppleJws,
  appleNotificationToTransition,
  type SubscriptionTier,
  type TransitionDecision,
} from "@swasth/domain-logic";
import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { prisma } from "../../shared/database.js";
import { redis } from "../../shared/redis.js";
import { env } from "../../config/env.js";
import { getFlag } from "../../shared/flags/flags.js";
import { logger } from "../../shared/logger.js";
import { capture } from "../../shared/analytics/posthog.js";
import { captureUnhandled } from "../../shared/observability/sentry.js";
import { verifyAppleReceipt } from "../../shared/payments/apple-client.js";
import {
  acquireSubscriptionLock,
  releaseSubscriptionLock,
  type RazorpayWebhookResult,
} from "./payments.service.js";

const DEDUP_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_PERIOD_MS = 30 * 86_400_000;

// Result shape reused from the Razorpay path so both webhooks answer the
// controller identically.
type AppleWebhookResult = RazorpayWebhookResult;

const productIdToTier = (productId: string | undefined): SubscriptionTier | undefined => {
  if (!productId) return undefined;
  if (productId === env.APPLE_PRODUCT_ID_PREMIUM) return "premium";
  if (productId === env.APPLE_PRODUCT_ID_FAMILY) return "family";
  return undefined;
};

const asString = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const asNumber = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

const requireEnabled = async (): Promise<void> => {
  const enabled = await getFlag<boolean>("payments_apple_iap_enabled", false);
  if (!enabled) {
    throw new DomainError("PAYMENT_PROVIDER_UNAVAILABLE", "Apple IAP is not enabled.");
  }
};

// ── Webhook (App Store Server Notifications V2) ─────────────────────

export interface AppleWebhookInput {
  /** The `signedPayload` JWS from the notification body. */
  signedPayload: string | undefined;
}

interface AppleNotificationData {
  bundleId?: string;
  signedTransactionInfo?: string;
}

export const processAppleWebhook = async (
  input: AppleWebhookInput,
): Promise<AppleWebhookResult> => {
  await requireEnabled();
  const now = new Date();
  const rootPem = env.APPLE_ROOT_CA_PEM ?? "";

  // Signature failure → 401, NO state change, paged to Sentry.
  const outer = verifyAppleJws(input.signedPayload, rootPem, now);
  if (!outer.valid || !outer.payload) {
    captureUnhandled(new Error("apple webhook JWS verification failed"), {
      tags: { surface: "payments", provider: "apple_iap" },
    });
    throw new DomainError("PAYMENT_WEBHOOK_INVALID_SIGNATURE", "invalid notification signature");
  }

  const payload = outer.payload;
  const notificationType = asString(payload.notificationType) ?? "unknown";
  const subtype = asString(payload.subtype);
  const notificationUUID = asString(payload.notificationUUID);
  const data = (payload.data ?? {}) as AppleNotificationData;

  // Idempotency — same notificationUUID (or body hash) within 24h.
  const dedupId =
    notificationUUID ??
    createHash("sha256")
      .update(input.signedPayload ?? "")
      .digest("hex")
      .slice(0, 32);
  const fresh = await redis.set(
    `payment:apple:event:${dedupId}`,
    "1",
    "EX",
    DEDUP_TTL_SECONDS,
    "NX",
  );
  if (fresh !== "OK") {
    return { ok: true, idempotentReplay: true, action: "duplicate" };
  }

  // The nested transaction info is a second JWS on the same Apple chain.
  const tx = data.signedTransactionInfo
    ? verifyAppleJws(data.signedTransactionInfo, rootPem, now)
    : null;
  if (data.signedTransactionInfo && !tx?.valid) {
    captureUnhandled(new Error("apple webhook transaction-info JWS invalid"), {
      tags: { surface: "payments", provider: "apple_iap" },
    });
    throw new DomainError("PAYMENT_WEBHOOK_INVALID_SIGNATURE", "invalid transaction signature");
  }

  const txInfo = tx?.payload ?? {};
  const originalTransactionId = asString(txInfo.originalTransactionId);
  const appAccountToken = asString(txInfo.appAccountToken);
  const productId = asString(txInfo.productId);
  const expiresDateMs = asNumber(txInfo.expiresDate);

  const userId = await resolveUserId(originalTransactionId, appAccountToken);
  if (!userId) {
    // Verified but unattributable — store for audit, acknowledge (200).
    await prisma.paymentEvent.create({
      data: {
        provider: "apple_iap",
        eventType: subtype ? `${notificationType}.${subtype}` : notificationType,
        rawPayload: payload as unknown as Prisma.InputJsonValue,
        signatureValid: true,
        errorMessage: "could not resolve user from notification",
      },
    });
    return { ok: true, idempotentReplay: false, action: "unattributed" };
  }

  const currentTier = await currentTierOf(userId);
  const purchasedTier = productIdToTier(productId);
  const decision = appleNotificationToTransition({
    notificationType,
    ...(subtype ? { subtype } : {}),
    currentTier,
    ...(purchasedTier ? { purchasedTier } : {}),
  });

  const periodEnd = expiresDateMs
    ? new Date(expiresDateMs)
    : new Date(Date.now() + DEFAULT_PERIOD_MS);

  const locked = await acquireSubscriptionLock(userId);
  if (!locked) throw new DomainError("PAYMENT_PROVIDER_UNAVAILABLE", "subscription is busy, retry");
  try {
    return await applyAppleDecision({
      userId,
      currentTier,
      decision,
      providerSubscriptionId: originalTransactionId,
      periodEnd,
      eventType: subtype ? `${notificationType}.${subtype}` : notificationType,
      rawPayload: payload as unknown as Prisma.InputJsonValue,
    });
  } finally {
    await releaseSubscriptionLock(userId);
  }
};

// ── Receipt verification (client-initiated) ─────────────────────────

export interface VerifyReceiptResult {
  tier: SubscriptionTier;
  providerSubscriptionId: string;
  currentPeriodEnd: Date;
}

export const verifyAppleReceiptForUser = async (input: {
  userId: string;
  receiptData: string;
}): Promise<VerifyReceiptResult> => {
  await requireEnabled();

  let receipt;
  try {
    receipt = await verifyAppleReceipt(input.receiptData);
  } catch (err) {
    captureUnhandled(err instanceof Error ? err : new Error(String(err)), {
      tags: { surface: "payments", provider: "apple_iap", op: "verify_receipt" },
    });
    throw new DomainError("PAYMENT_PROVIDER_UNAVAILABLE", "Could not reach Apple. Try again.");
  }

  if (receipt.status !== 0 || !receipt.info) {
    throw new DomainError("PAYMENT_RECEIPT_INVALID", "Apple could not validate this receipt.");
  }
  if (
    env.APPLE_BUNDLE_ID &&
    receipt.info.bundleId &&
    receipt.info.bundleId !== env.APPLE_BUNDLE_ID
  ) {
    throw new DomainError("PAYMENT_RECEIPT_INVALID", "Receipt is for a different app.");
  }

  const purchasedTier = productIdToTier(receipt.info.productId);
  if (!purchasedTier) {
    throw new DomainError("PAYMENT_RECEIPT_INVALID", "Receipt is for an unknown product.");
  }

  const currentTier = await currentTierOf(input.userId);
  const decision = appleNotificationToTransition({
    notificationType: "SUBSCRIBED",
    currentTier,
    purchasedTier,
  });
  const periodEnd = receipt.info.expiresDateMs
    ? new Date(receipt.info.expiresDateMs)
    : new Date(Date.now() + DEFAULT_PERIOD_MS);

  const locked = await acquireSubscriptionLock(input.userId);
  if (!locked) throw new DomainError("PAYMENT_PROVIDER_UNAVAILABLE", "subscription is busy, retry");
  try {
    await applyAppleDecision({
      userId: input.userId,
      currentTier,
      decision,
      providerSubscriptionId: receipt.info.originalTransactionId,
      periodEnd,
      eventType: "verify_receipt",
      rawPayload: receipt as unknown as Prisma.InputJsonValue,
    });
  } finally {
    await releaseSubscriptionLock(input.userId);
  }

  return {
    tier: decision.targetTier,
    providerSubscriptionId: receipt.info.originalTransactionId,
    currentPeriodEnd: periodEnd,
  };
};

// ── Shared apply (webhook + receipt) ────────────────────────────────

const resolveUserId = async (
  originalTransactionId: string | undefined,
  appAccountToken: string | undefined,
): Promise<string | null> => {
  if (originalTransactionId) {
    const existing = await prisma.subscription.findFirst({
      where: { providerSubscriptionId: originalTransactionId },
    });
    if (existing?.userId) return existing.userId;
  }
  // appAccountToken is our userId, set by the client at purchase time.
  if (appAccountToken) {
    const user = await prisma.user.findUnique({ where: { id: appAccountToken } });
    if (user) return user.id;
  }
  return null;
};

const currentTierOf = async (userId: string): Promise<SubscriptionTier> => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { tier: true } });
  return user?.tier ?? "free";
};

interface ApplyAppleInput {
  userId: string;
  currentTier: SubscriptionTier;
  decision: TransitionDecision;
  providerSubscriptionId: string | undefined;
  periodEnd: Date;
  eventType: string;
  rawPayload: Prisma.InputJsonValue;
}

const applyAppleDecision = async (a: ApplyAppleInput): Promise<AppleWebhookResult> => {
  const { decision } = a;
  const endsMandate = decision.action === "downgrade" || decision.action === "schedule_cancel";

  await prisma.$transaction(async (tx) => {
    if (decision.action !== "ignore") {
      await tx.subscription.upsert({
        where: { userId: a.userId },
        create: {
          userId: a.userId,
          tier: decision.targetTier,
          provider: "apple_iap",
          ...(a.providerSubscriptionId ? { providerSubscriptionId: a.providerSubscriptionId } : {}),
          status: decision.status,
          currentPeriodEnd: a.periodEnd,
          cancelAtPeriodEnd: decision.cancelAtPeriodEnd,
          ...(endsMandate ? { cancelledAt: new Date() } : {}),
        },
        update: {
          tier: decision.targetTier,
          provider: "apple_iap",
          status: decision.status,
          currentPeriodEnd: a.periodEnd,
          cancelAtPeriodEnd: decision.cancelAtPeriodEnd,
          ...(a.providerSubscriptionId ? { providerSubscriptionId: a.providerSubscriptionId } : {}),
          ...(endsMandate ? { cancelledAt: new Date() } : {}),
        },
      });
    }

    if (decision.changesTier) {
      await tx.user.update({ where: { id: a.userId }, data: { tier: decision.targetTier } });
    }

    await tx.paymentEvent.create({
      data: {
        userId: a.userId,
        provider: "apple_iap",
        eventType: a.eventType,
        rawPayload: a.rawPayload,
        signatureValid: true,
        processedAt: new Date(),
      },
    });
  });

  if (decision.changesTier) {
    const reason =
      decision.action === "activate"
        ? "purchase"
        : decision.action === "downgrade"
          ? "refund"
          : "cancelled";
    capture("tier_changed", a.userId, {
      from: a.currentTier,
      to: decision.targetTier,
      reason,
      provider: "apple_iap",
    });
  }
  capture("payment_webhook_processed", a.userId, {
    provider: "apple_iap",
    event_type: a.eventType,
    action: decision.action,
    idempotent_replay: false,
  });
  logger.info(
    { userId: a.userId, eventType: a.eventType, action: decision.action },
    "apple iap event processed",
  );

  return { ok: true, idempotentReplay: false, action: decision.action };
};
