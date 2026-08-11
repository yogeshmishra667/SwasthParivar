// Pure reconciliation decision (Phase 4 §K — RAZORPAY_RECONCILIATION).
//
// The webhook path (`razorpayEventToTransition`) is EVENT-driven: it sees
// "what just happened". Reconciliation is STATE-driven: once a day it
// pulls each subscription's *current* status from the Razorpay API and
// asks "does our local row still agree?". A missed webhook (Razorpay
// outage) shows up here as drift between the provider's status and ours.
//
// This function stays pure — it takes the provider status + our local
// snapshot and decides (a) whether a correction is needed at all, and
// (b) which existing webhook event vocabulary to replay through
// `razorpayEventToTransition` so the service applies exactly ONE code
// path for both webhooks and reconciliation. No IO, no Prisma.
//
// IDEMPOTENCY is the whole point: when local state already agrees with
// the provider, `apply` is false and the caller writes nothing (no
// PaymentEvent, no tier write). Running the cron twice in a row is a
// no-op on the second pass.

import type { SubscriptionTier, SubStatus } from "./transitions.js";

/** Local Subscription snapshot the reconciler compares against. Null
 *  when we have no local row for a provider subscription yet (a fully
 *  missed activation webhook). */
export interface LocalSubscriptionSnapshot {
  tier: SubscriptionTier;
  status: SubStatus;
  /** currentPeriodEnd as epoch ms, or null when unknown. */
  currentPeriodEndMs: number | null;
}

export interface ReconcileInput {
  /** Razorpay subscription `status` (active | authenticated | pending |
   *  halted | paused | cancelled | completed | expired | …). */
  providerStatus: string;
  /** Razorpay `current_end` as epoch ms, or null when absent. */
  providerCurrentEndMs: number | null;
  nowMs: number;
  /** Our local row, or null when none exists. */
  local: LocalSubscriptionSnapshot | null;
}

export interface ReconcileDecision {
  /** False → local already agrees; caller does nothing (idempotent). */
  apply: boolean;
  /** The webhook event type to replay through
   *  `razorpayEventToTransition`. Empty string when `apply` is false. */
  eventType: string;
  /** Short machine reason for logging / telemetry. */
  reason: string;
}

const NOOP: ReconcileDecision = { apply: false, eventType: "", reason: "consistent" };

/**
 * Decide whether local subscription state must be corrected to match the
 * provider, and if so which webhook event to replay. Pure.
 */
export const reconcileRazorpaySubscription = (input: ReconcileInput): ReconcileDecision => {
  const { providerStatus, providerCurrentEndMs, nowMs, local } = input;
  const localActivePremium = local !== null && local.tier !== "free" && local.status === "active";

  switch (providerStatus) {
    case "active":
    case "authenticated": {
      // Provider says active. If we don't hold an active paid tier, we
      // missed the activation webhook → replay it.
      if (!localActivePremium) {
        return { apply: true, eventType: "subscription.activated", reason: "missed_activation" };
      }
      // Already active — the only drift left is a period that advanced
      // (a missed `subscription.charged`). Extend when the provider's
      // period end is strictly later than ours.
      if (
        providerCurrentEndMs !== null &&
        (local.currentPeriodEndMs === null || providerCurrentEndMs > local.currentPeriodEndMs)
      ) {
        return { apply: true, eventType: "subscription.charged", reason: "missed_renewal" };
      }
      return NOOP;
    }

    case "pending":
    case "halted": {
      // Billing is failing. Soft state — never downgrades here.
      if (local?.status !== "past_due") {
        return { apply: true, eventType: "subscription.halted", reason: "missed_past_due" };
      }
      return NOOP;
    }

    case "paused": {
      if (local?.status !== "grace") {
        return { apply: true, eventType: "subscription.paused", reason: "missed_grace" };
      }
      return NOOP;
    }

    case "cancelled": {
      // A cancel that has already passed its paid period → the tier must
      // drop now. A cancel still inside the paid period → keep the tier,
      // just flag cancelAtPeriodEnd (schedule_cancel).
      const lapsed = providerCurrentEndMs !== null && providerCurrentEndMs <= nowMs;
      if (lapsed) {
        if (local !== null && local.tier !== "free") {
          return { apply: true, eventType: "subscription.expired", reason: "cancel_lapsed" };
        }
        return NOOP;
      }
      if (local?.status !== "cancelled") {
        return { apply: true, eventType: "subscription.cancelled", reason: "missed_cancel" };
      }
      return NOOP;
    }

    case "completed":
    case "expired": {
      // The paid term is truly over → revert to free (once).
      if (local !== null && local.tier !== "free") {
        return { apply: true, eventType: "subscription.expired", reason: "period_ended" };
      }
      return NOOP;
    }

    default:
      // created / a status we don't model → nothing to correct.
      return NOOP;
  }
};
