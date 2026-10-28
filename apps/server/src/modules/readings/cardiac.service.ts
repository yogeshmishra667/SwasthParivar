import { DomainError } from "@swasth/shared-types";
import {
  classifyCardiacReading,
  planMultiCategoryBypassDispatch,
  type MultiCategoryBypassDispatch,
} from "@swasth/domain-logic";
import { Prisma, type CardiacLog } from "@prisma/client";
import { prisma } from "../../shared/database.js";
import { logger } from "../../shared/logger.js";
import { createQueue, enqueueBestEffort, QUEUE_NAMES } from "../../shared/queue.js";
import { checkIdempotent } from "../../shared/idempotency.js";
import { isFeatureEnabledFor } from "../../shared/feature-gate.js";
import { bypassOwner, getLastBypass, markBypassed } from "../../shared/critical-bypass-cooldown.js";
import type {
  CriticalAlertMultiCategoryJob,
  LateCriticalReading,
} from "../../workers/critical-alert.processor.js";
import {
  enqueueCriticalAlert,
  isFreshForReplayDispatch,
  lateCriticalOf,
} from "../../workers/critical-alert.enqueue.js";
import type { AnalyzeReadingJob } from "../../workers/analyze-reading.processor.js";

const analyzeQueue = createQueue<AnalyzeReadingJob>(QUEUE_NAMES.ANALYZE_READING);

interface CreateCardiacInput {
  userId: string;
  clientUuid: string;
  heartRate: number;
  rhythmStatus: "regular" | "irregular" | "unknown";
  chestPain: boolean;
  painSeverity?: number | undefined;
  exerciseTolerance: "normal" | "reduced" | "severe";
  notes?: string | undefined;
  source: "manual" | "voice" | "device";
  measuredAt: string;
  /** When the device sent it (device clock), for the late-reading check (P33). */
  sentAt?: string | undefined;
  version: number;
  requestId?: string;
}

export interface CreateCardiacResult {
  reading: CardiacLog;
  critical: {
    isCritical: boolean;
    /**
     * One of the classifier's `reasons[]` (e.g. `critical.hr_low`). Surfaced
     * so the mobile client can show the matching i18n string in the
     * fullscreen alert without re-running the classifier on-device.
     */
    primaryReason: string;
    withinCooldown: boolean;
  };
}

/**
 * Plans the cardiac critical-bypass dispatch: per-category cooldown +
 * emergency contacts. The fresh path runs this BEFORE saving the row, so
 * no lookup can fail between the save and the hand-off (audit P5).
 *
 * CLAUDE.md "Phase 4 Invariants — Multi-condition Critical-Bypass
 * Dispatch": cooldown is **per-category**, kept in its own Redis key.
 */
const planCardiacBypass = async (
  userId: string,
  reasons: Parameters<typeof planMultiCategoryBypassDispatch>[0]["reasons"],
  nowIso: string,
  /** Replays only: this reading version's own stamp owner. */
  replayOf?: string,
): Promise<MultiCategoryBypassDispatch> => {
  const last = await getLastBypass("cardiac", userId);
  // A replay must not read its OWN earlier dispatch as a cooldown — that
  // stamp proves the original was outside it — or a job that failed for
  // good could never be revived (P5 review N2).
  const lastBypassIso = last !== null && last.owner !== replayOf ? last.atIso : null;
  const contacts = await prisma.emergencyContact.findMany({
    where: { userId },
    orderBy: { priority: "asc" },
    select: { id: true, priority: true, isGuardian: true },
  });
  return planMultiCategoryBypassDispatch({
    category: "cardiac",
    reasons,
    nowIso,
    lastBypassTriggeredAtIso: lastBypassIso,
    emergencyContacts: contacts.map((ec) => ({
      contactId: ec.id,
      priority: ec.priority,
      isGuardian: ec.isGuardian,
    })),
  });
};

/**
 * Hands a planned dispatch off, then stamps the cooldown. Never throws. A
 * replay doesn't re-stamp, so retries can't stretch the cooldown.
 */
const handOffCardiacBypass = async (
  reading: CardiacLog,
  dispatch: MultiCategoryBypassDispatch,
  requestId: string | undefined,
  stamp: boolean,
  /** Audit P33: taken > 2h before it reached us — a late notice, no cooldown. */
  late: LateCriticalReading | null,
): Promise<void> => {
  if (dispatch.withinCooldown) return;
  const job: CriticalAlertMultiCategoryJob = {
    category: "cardiac",
    readingId: reading.id,
    userId: reading.userId,
    dispatch,
    copyParams: {
      heartRateBpm: reading.heartRate,
      ...(reading.painSeverity !== null ? { painSeverity: reading.painSeverity } : {}),
    },
    ...(requestId ? { requestId } : {}),
    ...(late ? { late } : {}),
  };
  await enqueueCriticalAlert(job, reading.version);
  // Stamp the Redis cooldown AFTER the hand-off — a Redis outage before it
  // would silence the dispatch, which is the opposite of safety-first.
  // A late reading doesn't start the cooldown: a real critical reading
  // soon after must still reach the family (audit P33).
  if (stamp && !late) {
    await markBypassed(
      "cardiac",
      reading.userId,
      new Date().toISOString(),
      bypassOwner(reading.id, reading.version),
    );
  }
};

/**
 * Idempotent replay response — fired when a client retries a POST with the
 * same {clientUuid, version} we already persisted. Returns the existing
 * reading. A fresh critical reading's dispatch is re-ensured, not re-sent:
 * the original request may have died before the hand-off (audit P5); if it
 * didn't, the per-version jobId makes this a no-op (or revives a failed job).
 */
const buildReplayResult = async (
  reading: CardiacLog,
  requestId?: string,
): Promise<CreateCardiacResult> => {
  const classification = classifyCardiacReading({
    heartRateBpm: reading.heartRate,
    rhythmStatus: reading.rhythmStatus,
    chestPain: reading.chestPain,
    painSeverity: reading.painSeverity,
    exerciseTolerance: reading.exerciseTolerance,
  });
  if (
    classification.severity === "critical_bypass" &&
    isFreshForReplayDispatch(reading.updatedAt)
  ) {
    // Plan as of the moment this version was saved: the cooldown stamp is
    // kept for twice the window, so a reading another dispatch suppressed
    // is still suppressed. Its own earlier dispatch is ignored, so the
    // hand-off re-ensures (or revives) that job — a no-op when it's fine.
    const dispatch = await planCardiacBypass(
      reading.userId,
      classification.reasons,
      reading.updatedAt.toISOString(),
      bypassOwner(reading.id, reading.version),
    );
    await handOffCardiacBypass(
      reading,
      dispatch,
      requestId,
      false,
      lateCriticalOf({ measuredAt: reading.measuredAt, receivedAt: reading.updatedAt }),
    );
  }
  return {
    reading,
    critical: {
      isCritical: classification.severity === "critical_bypass",
      primaryReason: classification.reason,
      withinCooldown: false,
    },
  };
};

export const createCardiacLog = async (input: CreateCardiacInput): Promise<CreateCardiacResult> => {
  const receivedAt = new Date();
  // Kill-switch (default off — set by ops once cohort-ramping per
  // phase4-progress.md). Hardcoded medical thresholds (HR < 40, > 150,
  // chest pain ≥ 7) stay alive on classifier read-paths even when the
  // write surface is disabled, so an existing CardiacLog still drives
  // bypass on its next sync if a guardian opens it later.
  const enabled = await isFeatureEnabledFor("cardiac_logging_enabled", input.userId);
  if (!enabled) {
    throw new DomainError(
      "CARDIAC_DISABLED",
      "Cardiac logging is currently unavailable. Try again later.",
    );
  }

  // Scoped to the caller: a clientUuid owned by another profile is never
  // replayed back or updated (as BP, P4 review W5; P8 safety review W3).
  const idem = await checkIdempotent(
    prisma.cardiacLog,
    input.clientUuid,
    input.version,
    input.userId,
  );
  if (idem.kind === "stale") {
    throw new DomainError("READING_STALE_VERSION", "incoming version not newer than stored");
  }
  if (idem.kind === "replay") {
    return await buildReplayResult(idem.existing, input.requestId);
  }
  const existing = idem.kind === "update" ? idem.existing : null;

  // FK validation — surfaces a cleaner error than the raw Prisma error
  // if the JWT references a deleted user.
  await prisma.user.findUniqueOrThrow({ where: { id: input.userId } });

  const classification = classifyCardiacReading({
    heartRateBpm: input.heartRate,
    rhythmStatus: input.rhythmStatus,
    chestPain: input.chestPain,
    painSeverity: input.painSeverity ?? null,
    exerciseTolerance: input.exerciseTolerance,
  });

  const plannedBypass =
    classification.severity === "critical_bypass"
      ? await planCardiacBypass(input.userId, classification.reasons, new Date().toISOString())
      : null;

  let reading: CardiacLog;
  if (existing) {
    reading = await prisma.cardiacLog.update({
      where: {
        clientUuid_measuredAt: {
          clientUuid: existing.clientUuid,
          measuredAt: existing.measuredAt,
        },
      },
      data: {
        heartRate: input.heartRate,
        rhythmStatus: input.rhythmStatus,
        chestPain: input.chestPain,
        ...(input.painSeverity !== undefined ? { painSeverity: input.painSeverity } : {}),
        exerciseTolerance: input.exerciseTolerance,
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        source: input.source,
        version: input.version,
      },
    });
  } else {
    try {
      reading = await prisma.cardiacLog.create({
        data: {
          clientUuid: input.clientUuid,
          heartRate: input.heartRate,
          rhythmStatus: input.rhythmStatus,
          chestPain: input.chestPain,
          ...(input.painSeverity !== undefined ? { painSeverity: input.painSeverity } : {}),
          exerciseTolerance: input.exerciseTolerance,
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          source: input.source,
          measuredAt: new Date(input.measuredAt),
          version: input.version,
          user: { connect: { id: input.userId } },
        },
      });
    } catch (err) {
      // P2002 on (clientUuid, measuredAt) means a concurrent request lost
      // the findFirst race. Re-fetch and treat as replay so the client
      // sees a deterministic 200 instead of a 500 on legitimate retries.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const winner = await prisma.cardiacLog.findFirst({
          where: { clientUuid: input.clientUuid, userId: input.userId },
        });
        if (winner) {
          logger.info(
            { clientUuid: input.clientUuid, userId: input.userId },
            "cardiac concurrent create resolved as idempotent replay",
          );
          return await buildReplayResult(winner, input.requestId);
        }
      }
      throw err;
    }
  }

  if (plannedBypass) {
    await handOffCardiacBypass(
      reading,
      plannedBypass,
      input.requestId,
      true,
      lateCriticalOf({ measuredAt: input.measuredAt, sentAt: input.sentAt, receivedAt }),
    );
  }
  const withinCooldown = plannedBypass?.withinCooldown ?? false;

  // Phase 4 §E follow-up — ANALYZE_READING enqueue parity with glucose.
  // Runs detectCardiacTrend across 5/14/30-day windows in the worker;
  // the window-pattern de-dup pass in the processor collapses repeats
  // within 24h so an idempotent replay (same clientUuid) does not
  // double-publish an insight card. 3 retries + exp backoff come from
  // queue defaults.
  await enqueueBestEffort(QUEUE_NAMES.ANALYZE_READING, () =>
    analyzeQueue.add("analyze", {
      category: "cardiac",
      readingId: reading.id,
      userId: input.userId,
      ...(input.requestId ? { requestId: input.requestId } : {}),
    }),
  );

  return {
    reading,
    critical: {
      isCritical: classification.severity === "critical_bypass",
      primaryReason: classification.reason,
      withinCooldown,
    },
  };
};

export const deleteCardiacLog = async (params: { userId: string; id: string }): Promise<void> => {
  const existing = await prisma.cardiacLog.findFirst({
    where: { id: params.id, userId: params.userId },
  });
  if (!existing) {
    throw new DomainError("READING_NOT_FOUND", "cardiac log does not exist");
  }
  await prisma.cardiacLog.delete({
    where: {
      clientUuid_measuredAt: {
        clientUuid: existing.clientUuid,
        measuredAt: existing.measuredAt,
      },
    },
  });
};

export const listCardiacLogs = async (params: {
  userId: string;
  from?: Date;
  to?: Date;
  limit: number;
  cursor?: string;
}): Promise<{ data: CardiacLog[]; cursor: string | null; hasMore: boolean }> => {
  const where: Prisma.CardiacLogWhereInput = {
    userId: params.userId,
    ...(params.from || params.to
      ? {
          measuredAt: {
            ...(params.from ? { gte: params.from } : {}),
            ...(params.to ? { lte: params.to } : {}),
          },
        }
      : {}),
  };

  const cursorClause = params.cursor
    ? (() => {
        const parts = params.cursor.split("_");
        const cuid = parts[0];
        const measuredAt = parts[1];
        if (!cuid || !measuredAt) {
          throw new DomainError("VALIDATION_ERROR", "malformed cursor");
        }
        return {
          skip: 1,
          cursor: {
            clientUuid_measuredAt: {
              clientUuid: cuid,
              measuredAt: new Date(measuredAt),
            },
          },
        };
      })()
    : {};

  const rows = await prisma.cardiacLog.findMany({
    where,
    orderBy: { measuredAt: "desc" },
    take: params.limit + 1,
    ...cursorClause,
  });

  const hasMore = rows.length > params.limit;
  const data = hasMore ? rows.slice(0, params.limit) : rows;
  const last = data[data.length - 1];
  const cursor = hasMore && last ? `${last.clientUuid}_${last.measuredAt.toISOString()}` : null;
  return { data, cursor, hasMore };
};
