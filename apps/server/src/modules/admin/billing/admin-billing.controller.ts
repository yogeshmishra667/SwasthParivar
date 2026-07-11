import type { Request, Response } from "express";
import type { SubscriptionProvider, SubscriptionStatus } from "@prisma/client";
import { ok } from "../../../shared/http.js";
import { recordAdminAction } from "../../../shared/admin/audit.js";
import * as service from "./admin-billing.service.js";

export const listSubscriptions = async (req: Request, res: Response): Promise<void> => {
  const q = req.query as unknown as {
    status?: SubscriptionStatus;
    provider?: SubscriptionProvider;
    limit: number;
    offset: number;
  };
  ok(
    res,
    await service.listSubscriptions({
      ...(q.status ? { status: q.status } : {}),
      ...(q.provider ? { provider: q.provider } : {}),
      limit: q.limit,
      offset: q.offset,
    }),
  );
};

export const getMetrics = async (_req: Request, res: Response): Promise<void> => {
  ok(res, await service.getBillingMetrics());
};

// super_admin only (gated on the route). The server does not refund
// directly — it records the intent and returns the provider deep-link.
export const triggerRefund = async (req: Request, res: Response): Promise<void> => {
  const { userId } = req.params as { userId: string };
  const { reason } = req.body as { reason: string };
  const admin = req.admin!;

  const result = await service.resolveSubscriptionForRefund(userId);
  await recordAdminAction({
    adminUserId: admin.id,
    action: "billing.refund_triggered",
    targetType: "subscription",
    targetId: userId,
    metadata: {
      reason,
      provider: result.provider,
      providerSubscriptionId: result.providerSubscriptionId,
    },
    ip: req.ip,
  });
  ok(res, result);
};
