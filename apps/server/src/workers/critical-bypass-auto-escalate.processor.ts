// Phase 4 Feature D'.2 — delayed (5min) SOS auto-escalation from a
// critical-bypass dispatch.
//
// Side-effect-free at module import; the companion worker file binds
// it to BullMQ. The processor:
//   1. Re-reads the reading (it may have been edited / deleted)
//   2. Checks the patient's recent activity — a fresh manual reading
//      of any category that is not itself critical counts as
//      "responded", and we skip.
//   3. Otherwise calls `autoTriggerSOSFromCriticalBypass`, which
//      itself guards on `sos_enabled` + the per-source flag.
//
// Failure mode: ANY exception drops the auto-escalation silently
// (Sentry captures) rather than retry. A retried real-call SOS for
// the same critical-bypass would be worse than missing one.

import type { Job } from "bullmq";
import { isCriticalBP, isCriticalGlucose } from "@swasth/shared-types";
import { shouldTriggerCardiacBypass, shouldTriggerRespiratoryBypass } from "@swasth/domain-logic";
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

/** Rows read per table; a few minutes of manual logging never comes close. */
const RESPONSE_SCAN_LIMIT = 20;

/**
 * Did the patient respond after the critical reading? A newer reading of
 * ANY category counts, unless it is itself critical (a re-measure that is
 * still critical is no all-clear) or device-sourced (a wearable syncing in
 * the background is not the patient) — P4 review W3.
 */
const patientResponded = async (userId: string, readingMeasuredAt: Date): Promise<boolean> => {
  const where = {
    userId,
    measuredAt: { gt: new Date(readingMeasuredAt.getTime() + 1_000) },
    source: { not: "device" as const },
  };
  const take = RESPONSE_SCAN_LIMIT;
  const [glucose, bp, cardiac, respiratory] = await Promise.all([
    prisma.glucoseReading.findMany({ where, take, select: { valueMgDl: true } }),
    prisma.bPReading.findMany({ where, take, select: { systolic: true, diastolic: true } }),
    prisma.cardiacLog.findMany({
      where,
      take,
      select: {
        heartRate: true,
        rhythmStatus: true,
        chestPain: true,
        painSeverity: true,
        exerciseTolerance: true,
      },
    }),
    prisma.respiratoryLog.findMany({
      where,
      take,
      select: { peakFlow: true, baselinePeakFlow: true, inhalerUsed: true, symptomSeverity: true },
    }),
  ]);
  return (
    glucose.some((r) => !isCriticalGlucose(r.valueMgDl)) ||
    bp.some((r) => !isCriticalBP(r.systolic, r.diastolic)) ||
    cardiac.some((r) => !shouldTriggerCardiacBypass({ ...r, heartRateBpm: r.heartRate })) ||
    respiratory.some((r) => !shouldTriggerRespiratoryBypass(r))
  );
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
    log.info("patient logged a fresh non-critical reading — skipping auto-escalation");
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
