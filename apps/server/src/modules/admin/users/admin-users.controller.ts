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

  const result = await service.changeUserTier({ userId: id, tier });
  await recordAdminAction({
    adminUserId: admin.id,
    action: "user.tier_changed",
    targetType: "user",
    targetId: id,
    metadata: { from: result.previousTier, to: result.tier },
    ip: req.ip,
  });
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

/**
 * Admin "Send test push" — fires a single non-critical push to every
 * device this user's household has registered. Lets ops verify
 * end-to-end push delivery for a specific user without needing a real
 * critical reading. Always audited (success OR zero recipients).
 */
export const sendTestPush = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const admin = req.admin!;

  const result = await service.sendTestPush({ adminId: admin.id, targetUserId: id });

  await recordAdminAction({
    adminUserId: admin.id,
    action: "user.test_push_sent",
    targetType: "user",
    targetId: id,
    metadata: {
      tokensTried: result.tokensTried,
      successCount: result.successCount,
    },
    ip: req.ip,
  });

  ok(res, result);
};
