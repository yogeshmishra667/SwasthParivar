/**
 * Phase 3 — AI Chat retention sweep (processor)
 * Kill switch flag: chat_retention_sweep_enabled (default OFF)
 * Rollback runbook: docs/runbooks/rollback.md#chat
 * Owner: @phase3-chat-team
 *
 * CHAT_RETENTION_SWEEP BullMQ processor — fires weekly. Enforces the
 * CC.11 §5 DPDP data-retention policy for AI-chat content:
 *
 *   - Archive  — a ChatSession older than 90 days gets `archivedAt`
 *     set. `chat.service.listSessions` filters `archivedAt: null`, so
 *     an archived thread drops off the patient's session list while
 *     its rows are retained for the audit window.
 *   - Hard-delete — a ChatSession older than 1 year is deleted. The
 *     `onDelete: Cascade` on ChatMessage.session removes its messages.
 *
 * Age is measured from `ChatSession.startedAt`. Right-to-be-forgotten
 * is handled separately by the User-delete cascade (already wired via
 * `onDelete: Cascade` ChatSession → User in the schema).
 *
 * Kill switch: the sweep is destructive (hard-delete), so it is gated
 * behind `chat_retention_sweep_enabled` and ships OFF. Ops enables it
 * deliberately once retention behaviour is verified; flipping it off
 * pauses all deletion within 30s without a redeploy.
 */

import type { Job } from "bullmq";
import { prisma } from "../shared/database.js";
import { logger } from "../shared/logger.js";
import { getFlag } from "../shared/flags/index.js";

const DAY_MS = 86_400_000;
// Retention periods are compliance values — kept inline (auditable)
// rather than env, to prevent per-environment drift.
const ARCHIVE_AFTER_DAYS = 90;
const HARD_DELETE_AFTER_DAYS = 365;

export interface ChatRetentionSweepJob {
  tick: true;
}

export const processChatRetentionSweep = async (
  _job: Job<ChatRetentionSweepJob>,
): Promise<void> => {
  const enabled = await getFlag<boolean>("chat_retention_sweep_enabled", false);
  if (!enabled) {
    logger.info("chat retention sweep skipped — chat_retention_sweep_enabled is off");
    return;
  }

  const now = Date.now();
  const archiveCutoff = new Date(now - ARCHIVE_AFTER_DAYS * DAY_MS);
  const deleteCutoff = new Date(now - HARD_DELETE_AFTER_DAYS * DAY_MS);

  // Hard-delete first — sessions past the 1-year window. Cascade
  // removes their ChatMessage rows.
  const deleted = await prisma.chatSession.deleteMany({
    where: { startedAt: { lt: deleteCutoff } },
  });

  // Soft-archive — sessions past 90 days not yet archived. Sessions
  // already deleted above are gone; this only touches the 90d–1y band.
  const archived = await prisma.chatSession.updateMany({
    where: { startedAt: { lt: archiveCutoff }, archivedAt: null },
    data: { archivedAt: new Date() },
  });

  logger.info(
    { archived: archived.count, hardDeleted: deleted.count },
    "chat retention sweep complete",
  );
};
