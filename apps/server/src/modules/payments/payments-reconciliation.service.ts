// Phase 4 §K — RAZORPAY_RECONCILIATION service.
//
// Closes the missed-webhook gap: if a Razorpay `subscription.*` webhook
// is lost during a provider outage, local `Subscription`/`User.tier`
// state drifts from Razorpay's. Once a day this pulls the last 24h of
// subscription state from the Razorpay API and reconciles each local row
// IDEMPOTENTLY, then sweeps locally for cancelled subscriptions whose
// paid period has lapsed (the downgrade that no later webhook fires).
//
// It reuses the EXACT machinery the webhook uses — `resolveUser`,
// `acquireSubscriptionLock`, `applyRazorpayEvent` — so both paths share
// one atomic tier-transition transaction that NEVER deletes health data
// (CLAUDE.md "Tier Downgrade Data-Retention Rule") and serialise on the
// same `lock:subscription:${userId}` mutex. The decision of WHETHER a
// correction is needed (and which webhook event to replay) is the pure
// `reconcileRazorpaySubscription` from @swasth/domain-logic.

import { reconcileRazorpaySubscription } from "@swasth/domain-logic";
import type { SubscriptionTier, SubStatus } from "@swasth/domain-logic";
import { prisma } from "../../shared/database.js";
import { getFlag } from "../../shared/flags/flags.js";
import { logger } from "../../shared/logger.js";
import { capture } from "../../shared/analytics/posthog.js";
import { captureUnhandled } from "../../shared/observability/sentry.js";
import {
  listRazorpaySubscriptions,
  razorpayApiConfigured,
  type RazorpaySubscriptionState,
} from "../../shared/payments/razorpay-client.js";
import {
  acquireSubscriptionLock,
  applyRazorpayEvent,
  releaseSubscriptionLock,
  resolveUser,
} from "./payments.service.js";

const DAY_MS = 86_400_000;

export interface ReconciliationSummary {
  ranApiPass: boolean;
  scanned: number;
  corrected: number;
  lapsedDowngraded: number;
  unresolved: number;
  errors: number;
}

/** Build the local snapshot the pure reconciler compares against. */
const localSnapshot = async (
  userId: string,
  existing: { status: SubStatus; currentPeriodEnd: Date } | null,
): Promise<{
  tier: SubscriptionTier;
  status: SubStatus;
  currentPeriodEndMs: number | null;
} | null> => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { tier: true } });
  if (!user) return null;
  return {
    tier: user.tier,
    status: existing?.status ?? "active",
    currentPeriodEndMs: existing ? existing.currentPeriodEnd.getTime() : null,
  };
};

/**
 * Replay a single reconciliation decision through the shared atomic
 * transition, under the per-user subscription mutex. `body`/`subEntity`
 * shape the audit + period-end exactly as the webhook path would.
 */
const applyUnderLock = async (args: {
  userId: string;
  eventType: string;
  auditEventType: string;
  subEntity: { id?: string; current_end?: number; notes?: Record<string, unknown> } | undefined;
  existing: Awaited<ReturnType<typeof resolveUser>>;
}): Promise<boolean> => {
  const lockToken = await acquireSubscriptionLock(args.userId);
  if (!lockToken) {
    logger.warn({ userId: args.userId }, "reconciliation: subscription busy, skipping this row");
    return false;
  }
  try {
    await applyRazorpayEvent({
      userId: args.userId,
      eventType: args.eventType,
      auditEventType: args.auditEventType,
      body: {
        event: args.auditEventType,
        payload: {
          subscription: args.subEntity ? { entity: args.subEntity } : {},
        },
      },
      subEntity: args.subEntity,
      existing: args.existing?.existing ?? null,
      provider: "razorpay",
    });
    return true;
  } finally {
    await releaseSubscriptionLock(args.userId, lockToken);
  }
};

/** Phase A — reconcile each subscription the Razorpay API reports. */
const reconcileFromApi = async (
  entity: RazorpaySubscriptionState,
  nowMs: number,
  summary: ReconciliationSummary,
): Promise<void> => {
  const resolved = await resolveUser(entity.id, entity.notes);
  if (!resolved) {
    summary.unresolved += 1;
    return;
  }

  const snap = await localSnapshot(resolved.userId, resolved.existing);
  const decision = reconcileRazorpaySubscription({
    providerStatus: entity.status,
    providerCurrentEndMs: entity.currentEnd !== null ? entity.currentEnd * 1000 : null,
    nowMs,
    local: snap,
  });
  if (!decision.apply) return;

  const applied = await applyUnderLock({
    userId: resolved.userId,
    eventType: decision.eventType,
    auditEventType: `reconcile:${entity.status}`,
    subEntity: {
      id: entity.id,
      ...(entity.currentEnd !== null ? { current_end: entity.currentEnd } : {}),
      notes: entity.notes,
    },
    existing: resolved,
  });
  if (applied) {
    summary.corrected += 1;
    logger.info(
      { userId: resolved.userId, providerStatus: entity.status, reason: decision.reason },
      "reconciliation: corrected local subscription state",
    );
  }
};

/**
 * Phase B — local sweep for cancelled subscriptions whose paid period
 * has lapsed. A user cancels → we keep the tier until `currentPeriodEnd`
 * (schedule_cancel); Razorpay sends no further webhook when that date
 * passes, so the downgrade must be driven locally. (Past-due grace
 * lapses are SUBSCRIPTION_GRACE_DOWNGRADE's job, not this one.)
 */
const downgradeLapsedCancellations = async (
  nowMs: number,
  summary: ReconciliationSummary,
): Promise<void> => {
  const lapsed = await prisma.subscription.findMany({
    where: {
      status: "cancelled",
      cancelAtPeriodEnd: true,
      currentPeriodEnd: { lte: new Date(nowMs) },
      userId: { not: null },
      user: { tier: { not: "free" } },
    },
  });

  for (const row of lapsed) {
    if (!row.userId) continue;
    try {
      // Pass the real row as `existing` so the transaction keeps the
      // already-lapsed `currentPeriodEnd` instead of pushing it forward.
      const applied = await applyUnderLock({
        userId: row.userId,
        eventType: "subscription.expired",
        auditEventType: "reconcile:cancel_lapsed",
        subEntity: undefined,
        existing: { userId: row.userId, existing: row },
      });
      if (applied) {
        summary.lapsedDowngraded += 1;
        logger.info({ userId: row.userId }, "reconciliation: downgraded lapsed cancellation");
      }
    } catch (err) {
      summary.errors += 1;
      captureUnhandled(err instanceof Error ? err : new Error(String(err)), {
        tags: { surface: "payments", op: "reconciliation_lapsed" },
      });
    }
  }
};

/**
 * Run one reconciliation pass. Gated by `payments_razorpay_enabled`; a
 * missing/failed Razorpay API only skips the API pass — the local lapsed
 * sweep still runs so cancellations always downgrade on schedule.
 */
export const runRazorpayReconciliation = async (
  opts: {
    nowMs?: number;
  } = {},
): Promise<ReconciliationSummary> => {
  const summary: ReconciliationSummary = {
    ranApiPass: false,
    scanned: 0,
    corrected: 0,
    lapsedDowngraded: 0,
    unresolved: 0,
    errors: 0,
  };

  const enabled = await getFlag<boolean>("payments_razorpay_enabled", false);
  if (!enabled) {
    logger.info("razorpay-reconciliation: disabled by flag — skipping run");
    return summary;
  }

  const nowMs = opts.nowMs ?? Date.now();

  // Phase A — API reconcile (only when credentials are configured).
  if (razorpayApiConfigured()) {
    try {
      const toUnix = Math.floor(nowMs / 1000);
      const fromUnix = Math.floor((nowMs - DAY_MS) / 1000);
      const subs = await listRazorpaySubscriptions({ fromUnix, toUnix });
      summary.ranApiPass = true;
      summary.scanned = subs.length;
      for (const entity of subs) {
        try {
          await reconcileFromApi(entity, nowMs, summary);
        } catch (err) {
          summary.errors += 1;
          captureUnhandled(err instanceof Error ? err : new Error(String(err)), {
            tags: { surface: "payments", op: "reconciliation_api" },
          });
        }
      }
    } catch (err) {
      // A provider outage during reconciliation must never corrupt local
      // state — log, page Sentry, and fall through to the local sweep.
      summary.errors += 1;
      captureUnhandled(err instanceof Error ? err : new Error(String(err)), {
        tags: { surface: "payments", op: "reconciliation_list" },
      });
      logger.warn({ err }, "razorpay-reconciliation: API list failed — local sweep only");
    }
  } else {
    logger.info("razorpay-reconciliation: API not configured — local lapsed sweep only");
  }

  // Phase B — local lapsed-cancellation downgrade (no API needed).
  await downgradeLapsedCancellations(nowMs, summary);

  capture("payment_reconciliation_completed", "system", {
    ran_api_pass: summary.ranApiPass,
    scanned: summary.scanned,
    corrected: summary.corrected,
    lapsed_downgraded: summary.lapsedDowngraded,
    unresolved: summary.unresolved,
    errors: summary.errors,
  });
  logger.info({ summary }, "razorpay-reconciliation: run complete");
  return summary;
};
