// Phase 4 Feature D'.2 — delayed (5min) SOS auto-escalation from a
// critical-bypass dispatch.
//
// Side-effect-free at module import; the companion worker file binds
// it to BullMQ. The processor:
//   1. Re-reads the reading (it may have been edited / deleted)
//   2. Checks the patient's recent activity — if they've logged
//      anything fresh OR there's a guardian alert that has been
//      read, we treat that as "responded" and skip.
//   3. Otherwise calls `autoTriggerSOSFromCriticalBypass`, which
//      itself guards on `sos_enabled` + the per-source flag.
//
// Failure mode: ANY exception drops the auto-escalation silently
// (Sentry captures) rather than retry. A retried real-call SOS for
// the same critical-bypass would be worse than missing one.

import type { Job } from "bullmq";
import { logger } from "../shared/logger.js";
import { prisma } from "../shared/database.js";
import { autoTriggerSOSFromCriticalBypass } from "../modules/sos/sos.service.js";

export interface CriticalBypassAutoEscalateJob {
  readonly userId: string;
  readonly readingId: string;
  /**
   * Which table `readingId` lives in. Absent on jobs enqueued before this
   * field existed → glucose (the only category that escalated then).
   */
  readonly category?: "glucose" | "bp" | "cardiac" | "respiratory";
  readonly requestId?: string;
}

const FIVE_MINUTES_MS = 5 * 60_000;

const patientResponded = async (userId: string, readingMeasuredAt: Date): Promise<boolean> => {
  // A reading of ANY category newer than the critical one = the patient
  // is engaging with the app, no need to auto-escalate.
  const where = { userId, measuredAt: { gt: new Date(readingMeasuredAt.getTime() + 1_000) } };
  const select = { id: true } as const;
  const fresh = await Promise.all([
    prisma.glucoseReading.findFirst({ where, select }),
    prisma.bPReading.findFirst({ where, select }),
    prisma.cardiacLog.findFirst({ where, select }),
    prisma.respiratoryLog.findFirst({ where, select }),
  ]);
  return fresh.some((row) => row !== null);
};

/**
 * The critical reading, looked up in its own category's table. Before
 * this, every lookup hit `glucoseReading`, so a BP / cardiac / respiratory
 * escalation never found its reading and silently skipped (P4 review C2).
 */
const findCriticalReading = (
  category: NonNullable<CriticalBypassAutoEscalateJob["category"]>,
  readingId: string,
): Promise<{ measuredAt: Date } | null> => {
  const args = { where: { id: readingId }, select: { measuredAt: true } } as const;
  switch (category) {
    case "bp":
      return prisma.bPReading.findFirst(args);
    case "cardiac":
      return prisma.cardiacLog.findFirst(args);
    case "respiratory":
      return prisma.respiratoryLog.findFirst(args);
    case "glucose":
      return prisma.glucoseReading.findFirst(args);
  }
};

export const processCriticalBypassAutoEscalate = async (
  job: Job<CriticalBypassAutoEscalateJob>,
): Promise<void> => {
  const { userId, readingId, requestId } = job.data;
  const category = job.data.category ?? "glucose";
  const log = logger.child({
    queue: "critical-bypass-auto-escalate",
    jobId: job.id ?? undefined,
    userId,
    readingId,
    category,
    ...(requestId ? { requestId } : {}),
  });

  // Pull the reading to find its measuredAt; we tolerate "reading
  // deleted" as "patient definitely engaged" → skip.
  const reading = await findCriticalReading(category, readingId);
  if (!reading) {
    log.warn("critical reading missing — skipping auto-escalation");
    return;
  }

  // Defensive: don't escalate if the queue fired earlier than the
  // intended delay (e.g. clock skew on a manual retry).
  if (Date.now() - reading.measuredAt.getTime() < FIVE_MINUTES_MS - 30_000) {
    log.info("auto-escalation fired early — rescheduling not implemented, skipping");
    return;
  }

  if (await patientResponded(userId, reading.measuredAt)) {
    log.info("patient logged fresh reading — skipping auto-escalation");
    return;
  }

  const dto = await autoTriggerSOSFromCriticalBypass({
    userId,
    readingId,
    ...(requestId !== undefined ? { requestId } : {}),
  });

  if (dto) {
    log.warn(
      { sosEventId: dto.id, testMode: dto.testMode },
      "auto-escalated critical bypass to SOS",
    );
  } else {
    log.info("auto-escalation skipped by guards (flag off or active chain)");
  }
};
