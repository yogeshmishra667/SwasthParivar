// Admin audit trail. Every admin mutation (flag write, tier change,
// account change, …) and every sensitive-data view records one row via
// `recordAdminAction`. Best-effort: an audit-write failure is logged but
// never breaks the operation it describes — the row is written to the
// same Postgres the operation used, so an independent failure is rare.

import * as Sentry from "@sentry/node";
import type { Prisma } from "@prisma/client";
import { prisma } from "../database.js";
import { logger } from "../logger.js";

export interface RecordAdminActionInput {
  /** Acting admin's id (`req.admin.id`). */
  adminUserId: string;
  /** Free-form action key, e.g. "flag.set", "user.tier_changed". */
  action: string;
  /** Coarse target label, e.g. "flag" | "user" | "admin_user". */
  targetType?: string;
  /** Flag key or UUID the action touched. */
  targetId?: string;
  /** Structured before/after or context payload — never patient free-text. */
  metadata?: Record<string, unknown>;
  /** Caller IP (`req.ip`). */
  ip?: string;
}

export const recordAdminAction = async (input: RecordAdminActionInput): Promise<void> => {
  try {
    await prisma.adminAuditLog.create({
      data: {
        adminUserId: input.adminUserId,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        ip: input.ip ?? null,
        ...(input.metadata !== undefined
          ? { metadata: input.metadata as Prisma.InputJsonValue }
          : {}),
      },
    });
  } catch (err) {
    // Never let an audit failure surface to the operator — log it loudly
    // instead so the gap is visible without aborting the real action.
    logger.error({ err, action: input.action }, "admin audit write failed");
    Sentry.captureException(err);
  }
};
