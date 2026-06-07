import { DomainError } from "@swasth/shared-types";
import { classifyCardiacReading, planMultiCategoryBypassDispatch } from "@swasth/domain-logic";
import { Prisma, type CardiacLog } from "@prisma/client";
import { prisma } from "../../shared/database.js";
import { logger } from "../../shared/logger.js";
import { createQueue, QUEUE_NAMES } from "../../shared/queue.js";
import { checkIdempotent } from "../../shared/idempotency.js";
import { getFlag } from "../../shared/flags/index.js";
import { getLastBypassIso, markBypassed } from "../../shared/critical-bypass-cooldown.js";
import type {
  CriticalAlertJob,
  CriticalAlertMultiCategoryJob,
} from "../../workers/critical-alert.processor.js";
import type { AnalyzeReadingJob } from "../../workers/analyze-reading.processor.js";

const criticalQueue = createQueue<CriticalAlertJob>(QUEUE_NAMES.CRITICAL_ALERT);
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
 * Idempotent replay response — fired when a client retries a POST with the
 * same {clientUuid, version} we already persisted. Returns the existing
 * reading without re-running the classifier or re-enqueueing the bypass.
 */
const buildReplayResult = (reading: CardiacLog): CreateCardiacResult => {
  const classification = classifyCardiacReading({
    heartRateBpm: reading.heartRate,
    rhythmStatus: reading.rhythmStatus,
    chestPain: reading.chestPain,
    painSeverity: reading.painSeverity,
    exerciseTolerance: reading.exerciseTolerance,
  });
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
  // Kill-switch (default off — set by ops once cohort-ramping per
  // phase4-progress.md). Hardcoded medical thresholds (HR < 40, > 150,
  // chest pain ≥ 7) stay alive on classifier read-paths even when the
  // write surface is disabled, so an existing CardiacLog still drives
  // bypass on its next sync if a guardian opens it later.
  const enabled = await getFlag<boolean>("cardiac_logging_enabled", false);
  if (!enabled) {
    throw new DomainError(
      "CARDIAC_DISABLED",
      "Cardiac logging is currently unavailable. Try again later.",
    );
  }

  const idem = await checkIdempotent(prisma.cardiacLog, input.clientUuid, input.version);
  if (idem.kind === "stale") {
    throw new DomainError("READING_STALE_VERSION", "incoming version not newer than stored");
  }
  if (idem.kind === "replay") {
    return buildReplayResult(idem.existing);
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
          where: { clientUuid: input.clientUuid },
        });
        if (winner) {
          logger.info(
            { clientUuid: input.clientUuid, userId: input.userId },
            "cardiac concurrent create resolved as idempotent replay",
          );
          return buildReplayResult(winner);
        }
      }
      throw err;
    }
  }

  let withinCooldown = false;
  if (classification.severity === "critical_bypass") {
    // CLAUDE.md "Phase 4 Invariants — Multi-condition Critical-Bypass
    // Dispatch": cooldown is **per-category**. Glucose's cooldown lives
    // in `FeedbackEvent.feedbackType=critical_warn`; cardiac uses the
    // Redis-backed module so the two never inhibit each other.
    const lastBypassIso = await getLastBypassIso("cardiac", input.userId);
    const contacts = await prisma.emergencyContact.findMany({
      where: { userId: input.userId },
      orderBy: { priority: "asc" },
      select: { id: true, priority: true, isGuardian: true },
    });
    const dispatch = planMultiCategoryBypassDispatch({
      category: "cardiac",
      reasons: classification.reasons,
      nowIso: new Date().toISOString(),
      lastBypassTriggeredAtIso: lastBypassIso,
      emergencyContacts: contacts.map((c) => ({
        contactId: c.id,
        priority: c.priority,
        isGuardian: c.isGuardian,
      })),
    });
    withinCooldown = dispatch.withinCooldown;
    if (!dispatch.withinCooldown) {
      const job: CriticalAlertMultiCategoryJob = {
        category: "cardiac",
        readingId: reading.id,
        userId: input.userId,
        dispatch,
        copyParams: {
          heartRateBpm: reading.heartRate,
          ...(reading.painSeverity !== null ? { painSeverity: reading.painSeverity } : {}),
        },
        ...(input.requestId ? { requestId: input.requestId } : {}),
      };
      await criticalQueue.add("dispatch", job);
      // Stamp the Redis cooldown AFTER the enqueue succeeds — a Redis
      // outage before the queue add would silence the dispatch, which is
      // the opposite of safety-first. Order: enqueue, then stamp.
      await markBypassed("cardiac", input.userId, new Date().toISOString());
    }
  }

  // Phase 4 §E follow-up — ANALYZE_READING enqueue parity with glucose.
  // Runs detectCardiacTrend across 5/14/30-day windows in the worker;
  // the window-pattern de-dup pass in the processor collapses repeats
  // within 24h so an idempotent replay (same clientUuid) does not
  // double-publish an insight card. 3 retries + exp backoff come from
  // queue defaults.
  await analyzeQueue.add("analyze", {
    category: "cardiac",
    readingId: reading.id,
    userId: input.userId,
    ...(input.requestId ? { requestId: input.requestId } : {}),
  });

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
