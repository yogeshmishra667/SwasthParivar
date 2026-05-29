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
  readonly requestId?: string;
}

const FIVE_MINUTES_MS = 5 * 60_000;

const patientResponded = async (userId: string, readingMeasuredAt: Date): Promise<boolean> => {
  // Any glucose reading newer than the critical one = patient is
  // engaging with the app, no need to auto-escalate.
  const since = new Date(readingMeasuredAt.getTime() + 1_000);
  const fresh = await prisma.glucoseReading.findFirst({
    where: { userId, measuredAt: { gt: since } },
    select: { id: true },
  });
  return fresh !== null;
};

export const processCriticalBypassAutoEscalate = async (
  job: Job<CriticalBypassAutoEscalateJob>,
): Promise<void> => {
  const { userId, readingId, requestId } = job.data;
  const log = logger.child({
    queue: "critical-bypass-auto-escalate",
    jobId: job.id ?? undefined,
    userId,
    readingId,
    ...(requestId ? { requestId } : {}),
  });

  // Pull the reading to find its measuredAt; we tolerate "reading
  // deleted" as "patient definitely engaged" → skip.
  const reading = await prisma.glucoseReading.findFirst({
    where: { id: readingId },
    select: { measuredAt: true, userId: true },
  });
  if (!reading) {
    log.info("reading missing — patient likely engaged, skipping auto-escalation");
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
