// Phase 4 §K.6 — admin billing console (server side).
//
// Read surfaces (subscription table + MRR/churn tiles) plus the
// refund-trigger resolver. Per phase4.md the server NEVER refunds
// directly — it resolves the provider deep-link and records the intent
// in the audit trail; ops completes the refund on the provider side so
// the provider stays the authoritative source. The refund WEBHOOK is
// what later reverts the tier (retention-safe, no data loss).

import { DomainError } from "@swasth/shared-types";
import type { SubscriptionProvider, SubscriptionStatus, Tier } from "@prisma/client";
import { prisma } from "../../../shared/database.js";

// Monthly list prices (INR) — used ONLY for the MRR estimate tile. The
// provider holds the authoritative charged amount; we don't persist it,
// so MRR is a headline estimate from the active tier mix.
const MONTHLY_PRICE_INR: Record<Exclude<Tier, "free">, number> = {
  premium: 199,
  family: 399,
};

export interface AdminSubscriptionRow {
  userId: string | null;
  patientName: string | null;
  patientPhone: string | null;
  tier: Tier;
  provider: SubscriptionProvider;
  providerSubscriptionId: string | null;
  status: SubscriptionStatus;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  cancelledAt: string | null;
  createdAt: string;
}

export interface AdminSubscriptionPage {
  records: AdminSubscriptionRow[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export const listSubscriptions = async (params: {
  status?: SubscriptionStatus;
  provider?: SubscriptionProvider;
  limit: number;
  offset: number;
}): Promise<AdminSubscriptionPage> => {
  const where = {
    ...(params.status ? { status: params.status } : {}),
    ...(params.provider ? { provider: params.provider } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.subscription.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: params.limit,
      skip: params.offset,
      include: { user: { select: { name: true, phone: true } } },
    }),
    prisma.subscription.count({ where }),
  ]);

  const records: AdminSubscriptionRow[] = rows.map((r) => ({
    userId: r.userId,
    patientName: r.user?.name ?? null,
    patientPhone: r.user?.phone ?? null,
    tier: r.tier,
    provider: r.provider,
    providerSubscriptionId: r.providerSubscriptionId,
    status: r.status,
    currentPeriodEnd: r.currentPeriodEnd.toISOString(),
    cancelAtPeriodEnd: r.cancelAtPeriodEnd,
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));

  return {
    records,
    total,
    limit: params.limit,
    offset: params.offset,
    hasMore: params.offset + rows.length < total,
  };
};

export interface BillingMetrics {
  /** Estimated monthly recurring revenue in INR from active subs. */
  mrrInr: number;
  activeSubscriptions: number;
  byStatus: Record<string, number>;
  byProvider: Record<string, number>;
  /** Subscriptions whose cancellation landed in the current month. */
  churnedThisMonth: number;
  /** churnedThisMonth / (active + churnedThisMonth), 0–100. */
  churnRatePct: number;
}

export const getBillingMetrics = async (): Promise<BillingMetrics> => {
  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [activeByTier, byStatusRows, byProviderRows, churnedThisMonth] = await Promise.all([
    prisma.subscription.groupBy({
      by: ["tier"],
      where: { status: "active" },
      _count: { _all: true },
    }),
    prisma.subscription.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.subscription.groupBy({ by: ["provider"], _count: { _all: true } }),
    prisma.subscription.count({
      where: { status: "cancelled", cancelledAt: { gte: startOfMonth } },
    }),
  ]);

  let mrrInr = 0;
  let activeSubscriptions = 0;
  for (const row of activeByTier) {
    const count = row._count._all;
    activeSubscriptions += count;
    if (row.tier !== "free") mrrInr += count * MONTHLY_PRICE_INR[row.tier];
  }

  const byStatus: Record<string, number> = {};
  for (const row of byStatusRows) byStatus[row.status] = row._count._all;
  const byProvider: Record<string, number> = {};
  for (const row of byProviderRows) byProvider[row.provider] = row._count._all;

  const denom = activeSubscriptions + churnedThisMonth;
  const churnRatePct = denom === 0 ? 0 : Math.round((churnedThisMonth / denom) * 1000) / 10;

  return { mrrInr, activeSubscriptions, byStatus, byProvider, churnedThisMonth, churnRatePct };
};

export interface RefundResolution {
  provider: SubscriptionProvider;
  providerSubscriptionId: string | null;
  status: SubscriptionStatus;
  tier: Tier;
  /** Provider dashboard deep-link where ops completes the refund. */
  refundUrl: string | null;
  note: string;
}

const buildRefundUrl = (
  provider: SubscriptionProvider,
  providerSubscriptionId: string | null,
): string | null => {
  switch (provider) {
    case "razorpay":
      return providerSubscriptionId
        ? `https://dashboard.razorpay.com/app/subscriptions/${providerSubscriptionId}`
        : "https://dashboard.razorpay.com/app/subscriptions";
    case "apple_iap":
      // Apple refunds are issued from App Store Connect (or the customer
      // via reportaproblem) — there is no per-transaction deep link.
      return "https://appstoreconnect.apple.com/";
    case "manual":
      // Comped / ops-granted tier — nothing to refund on a provider.
      return null;
  }
};

/**
 * Resolve the refund target for a user's subscription. Does NOT issue a
 * refund — returns the provider deep-link + context so the controller
 * can audit the intent. Throws SUBSCRIPTION_NOT_FOUND when the user has
 * no subscription row.
 */
export const resolveSubscriptionForRefund = async (userId: string): Promise<RefundResolution> => {
  const sub = await prisma.subscription.findUnique({ where: { userId } });
  if (!sub) {
    throw new DomainError("SUBSCRIPTION_NOT_FOUND", "no subscription for this user");
  }
  return {
    provider: sub.provider,
    providerSubscriptionId: sub.providerSubscriptionId,
    status: sub.status,
    tier: sub.tier,
    refundUrl: buildRefundUrl(sub.provider, sub.providerSubscriptionId),
    note:
      sub.provider === "manual"
        ? "Manual/comped subscription — no provider refund. Adjust the tier via /admin/users/:id/tier."
        : "Complete the refund on the provider dashboard. The refund webhook will revert the tier (no data loss).",
  };
};
