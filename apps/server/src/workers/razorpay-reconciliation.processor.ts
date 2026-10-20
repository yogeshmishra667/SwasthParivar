// RAZORPAY_RECONCILIATION BullMQ processor — Phase 4 §K.
//
// Daily tick. Delegates entirely to the payments module's
// `runRazorpayReconciliation`, which pulls the last 24h of Razorpay
// subscription state, reconciles local rows idempotently through the
// shared atomic tier-transition path, and downgrades cancelled
// subscriptions whose paid period has lapsed. Gated by
// `payments_razorpay_enabled` inside the service (cheap early-return
// when off). Side-effecting logic lives in the service; tests import
// that directly. This processor is a one-liner over it so BullMQ retries
// are safe — every operation inside is idempotent.

import type { Job } from "bullmq";

import { runRazorpayReconciliation } from "../modules/payments/payments-reconciliation.service.js";

export interface RazorpayReconciliationJob {
  tick: true;
}

export const processRazorpayReconciliation = async (
  _job: Job<RazorpayReconciliationJob>,
): Promise<void> => {
  await runRazorpayReconciliation();
};
