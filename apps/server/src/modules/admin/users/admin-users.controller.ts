import type { Request, Response } from "express";
import { ok } from "../../../shared/http.js";
import { recordAdminAction } from "../../../shared/admin/audit.js";
import * as service from "./admin-users.service.js";

export const listUsers = async (req: Request, res: Response): Promise<void> => {
  const query = req.query as unknown as { search?: string; limit: number; offset: number };
  ok(res, await service.listUsers(query));
};

export const getUser = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  ok(res, await service.getUserDetail(id));
};

export const getUserResource = async (req: Request, res: Response): Promise<void> => {
  const { id, key } = req.params as { id: string; key: string };
  const { limit, offset } = req.query as unknown as { limit: number; offset: number };
  const admin = req.admin!;

  const result = await service.getUserResource({
    userId: id,
    key,
    role: admin.role,
    limit,
    offset,
  });

  // Viewing raw patient health data leaves an access trail.
  if (result.sensitive) {
    await recordAdminAction({
      adminUserId: admin.id,
      action: "patient_data_viewed",
      targetType: "user",
      targetId: id,
      metadata: { resource: key },
      ip: req.ip,
    });
  }
  ok(res, result);
};

export const getUserFeatureMap = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  ok(res, await service.getUserFeatureMap(id));
};

export const changeUserTier = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const { tier } = req.body as { tier: "free" | "premium" | "family" };
  const admin = req.admin!;

  const result = await service.changeUserTier({ userId: id, tier, adminUserId: admin.id });
  // PR 2: tier moved from User to Household. The audit action key
  // moves with it (`household.tier_changed`). Historical
  // `user.tier_changed` rows remain readable in the audit timeline —
  // the reader treats both as the same logical event for one cycle.
  // Idempotent re-apply (previousTier === tier) skips the audit write
  // so the table only records actual changes.
  if (result.previousTier !== result.tier) {
    await recordAdminAction({
      adminUserId: admin.id,
      action: "household.tier_changed",
      targetType: "household",
      targetId: result.householdId,
      metadata: {
        userId: id,
        from: result.previousTier,
        to: result.tier,
        previousMemberLimit: result.previousMemberLimit,
        memberLimit: result.memberLimit,
        memberCount: result.memberCount,
        overCap: result.overCap,
      },
      ip: req.ip,
    });
  }
  ok(res, result);
};

// ── Soft-disable (Phase 4 Week 13 admin carry-over) ─────────────────
//
// Both endpoints write to AdminAuditLog ONLY on a real transition.
// Reapplying the same state is a no-op and skips the audit row — the
// audit table stays a clean list of "what actually changed when".

export const deactivateUser = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const { reason } = req.body as { reason: string };
  const admin = req.admin!;

  const result = await service.deactivateUser({
    userId: id,
    reason,
    adminUserId: admin.id,
  });

  if (result.previouslyActive) {
    await recordAdminAction({
      adminUserId: admin.id,
      action: "user.deactivated",
      targetType: "user",
      targetId: id,
      metadata: { reason },
      ip: req.ip,
    });
  }
  ok(res, result);
};

export const reactivateUser = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const admin = req.admin!;

  const result = await service.reactivateUser(id);

  if (!result.previouslyActive) {
    await recordAdminAction({
      adminUserId: admin.id,
      action: "user.reactivated",
      targetType: "user",
      targetId: id,
      ip: req.ip,
    });
  }
  ok(res, result);
};
