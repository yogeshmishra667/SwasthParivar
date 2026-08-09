// Pure mapping from a Razorpay webhook event → the tier/subscription
// transition it implies (Phase 4 §K.4 "Tier-transition rules"). No IO,
// no Prisma — the worker applies the decision atomically; this just
// decides WHAT should happen. Mirrors the Prisma `Tier` /
// `SubscriptionStatus` string unions so the service maps 1:1.
//
// CRITICAL invariant encoded here: a cancellation does NOT change the
// tier immediately — the user keeps premium until `currentPeriodEnd`
// (cancelAtPeriodEnd). Only a refund downgrades on the spot. And NO
// transition ever implies deleting health data — that guarantee lives
// in the service, but no `action` here means "purge".

export type SubscriptionTier = "free" | "premium" | "family";
export type SubStatus = "active" | "past_due" | "grace" | "cancelled";

export type SubscriptionAction =
  | "activate" // upgrade now (subscription.activated)
  | "extend" // renew the paid period (subscription.charged)
  | "schedule_cancel" // cancel at period end — keep tier until then
  | "grace" // provider paused — keep tier, grace window
  | "past_due" // charge failed — soft, keep tier, no downgrade
  | "downgrade" // immediate revert to free (refund)
  | "ignore"; // event we don't act on

export interface TransitionDecision {
  action: SubscriptionAction;
  /** Resulting tier the user should hold AFTER this event. */
  targetTier: SubscriptionTier;
  /** Resulting subscription status. */
  status: SubStatus;
  /** Whether `User.tier` must be written now (false = tier unchanged). */
  changesTier: boolean;
  /** Whether to flag the row `cancelAtPeriodEnd`. */
  cancelAtPeriodEnd: boolean;
}

export interface TransitionInput {
  eventType: string;
  /** The tier the user holds right now. */
  currentTier: SubscriptionTier;
  /**
   * Tier being purchased, resolved from the Razorpay plan id by the
   * caller (premium vs family). Only consulted for `activate`.
   */
  purchasedTier?: SubscriptionTier;
}

export const razorpayEventToTransition = (input: TransitionInput): TransitionDecision => {
  const keepTier = input.currentTier;
  switch (input.eventType) {
    case "subscription.activated":
    case "subscription.authenticated": {
      const targetTier = input.purchasedTier ?? "premium";
      return {
        action: "activate",
        targetTier,
        status: "active",
        changesTier: true,
        cancelAtPeriodEnd: false,
      };
    }
    case "subscription.charged":
      // Renewal — period extends, tier/status stay active.
      return {
        action: "extend",
        targetTier: keepTier,
        status: "active",
        changesTier: false,
        cancelAtPeriodEnd: false,
      };
    case "subscription.cancelled":
      // Keep the tier until currentPeriodEnd; a reconciliation pass
      // downgrades when the period actually lapses.
      return {
        action: "schedule_cancel",
        targetTier: keepTier,
        status: "cancelled",
        changesTier: false,
        cancelAtPeriodEnd: true,
      };
    case "subscription.paused":
      return {
        action: "grace",
        targetTier: keepTier,
        status: "grace",
        changesTier: false,
        cancelAtPeriodEnd: false,
      };
    case "subscription.halted":
    case "payment.failed":
      // Soft signal — notify, do NOT downgrade yet.
      return {
        action: "past_due",
        targetTier: keepTier,
        status: "past_due",
        changesTier: false,
        cancelAtPeriodEnd: false,
      };
    case "refund.created":
    case "refund.processed":
      // Money returned → revert to free immediately. Health data is
      // retained (service guarantee), only the tier flips.
      return {
        action: "downgrade",
        targetTier: "free",
        status: "cancelled",
        changesTier: keepTier !== "free",
        cancelAtPeriodEnd: false,
      };
    default:
      return {
        action: "ignore",
        targetTier: keepTier,
        status: "active",
        changesTier: false,
        cancelAtPeriodEnd: false,
      };
  }
};

// ── Apple App Store Server Notifications V2 (Phase 4 §K.3) ──────────
//
// Same decision shape as Razorpay so the service applies both providers
// through one atomic path. Apple splits the "what happened" across
// `notificationType` + `subtype` (e.g. DID_CHANGE_RENEWAL_STATUS is a
// cancel OR a re-enable depending on subtype). The critical invariants
// are identical: auto-renew-off keeps the tier until expiry
// (cancelAtPeriodEnd), only EXPIRED / REFUND / REVOKE downgrade on the
// spot, and no transition ever implies deleting data.

export interface AppleTransitionInput {
  notificationType: string;
  subtype?: string;
  currentTier: SubscriptionTier;
  /** Tier resolved from the Apple productId (premium vs family). */
  purchasedTier?: SubscriptionTier;
}

export const appleNotificationToTransition = (input: AppleTransitionInput): TransitionDecision => {
  const keepTier = input.currentTier;
  const activate = (): TransitionDecision => ({
    action: "activate",
    targetTier: input.purchasedTier ?? "premium",
    status: "active",
    changesTier: true,
    cancelAtPeriodEnd: false,
  });

  switch (input.notificationType) {
    case "SUBSCRIBED":
    case "OFFER_REDEEMED":
      return activate();
    case "DID_RENEW":
      return {
        action: "extend",
        targetTier: keepTier,
        status: "active",
        changesTier: false,
        cancelAtPeriodEnd: false,
      };
    case "DID_CHANGE_RENEWAL_STATUS":
      // AUTO_RENEW_DISABLED → cancel at period end (keep tier until
      // expiry). AUTO_RENEW_ENABLED (re-enable) → nothing to change.
      if (input.subtype === "AUTO_RENEW_DISABLED") {
        return {
          action: "schedule_cancel",
          targetTier: keepTier,
          status: "cancelled",
          changesTier: false,
          cancelAtPeriodEnd: true,
        };
      }
      return {
        action: "ignore",
        targetTier: keepTier,
        status: "active",
        changesTier: false,
        cancelAtPeriodEnd: false,
      };
    case "DID_FAIL_TO_RENEW":
      // GRACE_PERIOD subtype → still in grace (keep tier); otherwise a
      // hard billing failure — past_due, no downgrade yet.
      return input.subtype === "GRACE_PERIOD"
        ? {
            action: "grace",
            targetTier: keepTier,
            status: "grace",
            changesTier: false,
            cancelAtPeriodEnd: false,
          }
        : {
            action: "past_due",
            targetTier: keepTier,
            status: "past_due",
            changesTier: false,
            cancelAtPeriodEnd: false,
          };
    case "EXPIRED":
    case "GRACE_PERIOD_EXPIRED":
    case "REFUND":
    case "REVOKE":
      // Access truly ends → revert to free now. Health data retained by
      // the service; only the tier flips.
      return {
        action: "downgrade",
        targetTier: "free",
        status: "cancelled",
        changesTier: keepTier !== "free",
        cancelAtPeriodEnd: false,
      };
    default:
      return {
        action: "ignore",
        targetTier: keepTier,
        status: "active",
        changesTier: false,
        cancelAtPeriodEnd: false,
      };
  }
};
