import { DomainError } from "@swasth/shared-types";
import {
  classifyRespiratoryReading,
  planMultiCategoryBypassDispatch,
  type MultiCategoryBypassDispatch,
} from "@swasth/domain-logic";
import { Prisma, type RespiratoryLog } from "@prisma/client";
import { prisma } from "../../shared/database.js";
import { logger } from "../../shared/logger.js";
import { createQueue, enqueueBestEffort, QUEUE_NAMES } from "../../shared/queue.js";
import { checkIdempotent } from "../../shared/idempotency.js";
import { getFlag } from "../../shared/flags/index.js";
import { bypassOwner, getLastBypass, markBypassed } from "../../shared/critical-bypass-cooldown.js";
import type { CriticalAlertMultiCategoryJob } from "../../workers/critical-alert.processor.js";
import {
  enqueueCriticalAlert,
  isFreshForReplayDispatch,
} from "../../workers/critical-alert.enqueue.js";
import type { AnalyzeReadingJob } from "../../workers/analyze-reading.processor.js";

const analyzeQueue = createQueue<AnalyzeReadingJob>(QUEUE_NAMES.ANALYZE_READING);

interface CreateRespiratoryInput {
  userId: string;
  clientUuid: string;
  peakFlow?: number | undefined;
  /**
   * Optional caller-supplied baseline. When omitted, the service
   * snapshots the user's stored baseline so the row is self-describing
   * (a baseline change on the User row never retroactively re-
   * classifies a historical log).
   */
  baselinePeakFlow?: number | undefined;
  inhalerUsed: boolean;
  inhalerType?: string | undefined;
  puffs?: number | undefined;
  triggerNote?: string | undefined;
  symptomSeverity: "none" | "mild" | "moderate" | "severe";
  notes?: string | undefined;
  source: "manual" | "voice" | "device";
  measuredAt: string;
  version: number;
  requestId?: string;
}

export interface CreateRespiratoryResult {
  reading: RespiratoryLog;
  critical: {
    isCritical: boolean;
    primaryReason: string;
    withinCooldown: boolean;
  };
}

/**
 * Plans the respiratory critical-bypass dispatch: per-category cooldown +
 * emergency contacts. The fresh path runs this BEFORE saving the row, so
 * no lookup can fail between the save and the hand-off (audit P5).
 *
 * CLAUDE.md "Phase 4 Invariants — Multi-condition Critical-Bypass
 * Dispatch": cooldown is **per-category**, kept in its own Redis key.
 */
const planRespiratoryBypass = async (
  userId: string,
  reasons: Parameters<typeof planMultiCategoryBypassDispatch>[0]["reasons"],
  nowIso: string,
  /** Replays only: this reading version's own stamp owner. */
  replayOf?: string,
): Promise<MultiCategoryBypassDispatch> => {
  const last = await getLastBypass("respiratory", userId);
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
    category: "respiratory",
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
const handOffRespiratoryBypass = async (
  reading: RespiratoryLog,
  dispatch: MultiCategoryBypassDispatch,
  requestId: string | undefined,
  stamp: boolean,
): Promise<void> => {
  if (dispatch.withinCooldown) return;
  const job: CriticalAlertMultiCategoryJob = {
    category: "respiratory",
    readingId: reading.id,
    userId: reading.userId,
    dispatch,
    copyParams: {
      ...(reading.peakFlow !== null ? { peakFlow: reading.peakFlow } : {}),
      ...(reading.baselinePeakFlow !== null ? { baselinePeakFlow: reading.baselinePeakFlow } : {}),
    },
    ...(requestId ? { requestId } : {}),
  };
  await enqueueCriticalAlert(job, reading.version);
  // Stamp the Redis cooldown AFTER the hand-off — a Redis outage before it
  // would silence the dispatch, which is the opposite of safety-first.
  if (stamp) {
    await markBypassed(
      "respiratory",
      reading.userId,
      new Date().toISOString(),
      bypassOwner(reading.id, reading.version),
    );
  }
};

/**
 * Idempotent replay response. A fresh critical reading's dispatch is
 * re-ensured, not re-sent (audit P5) — see cardiac.service.ts.
 */
const buildReplayResult = async (
  reading: RespiratoryLog,
  requestId?: string,
): Promise<CreateRespiratoryResult> => {
  const classification = classifyRespiratoryReading({
    peakFlow: reading.peakFlow,
    baselinePeakFlow: reading.baselinePeakFlow,
    inhalerUsed: reading.inhalerUsed,
    symptomSeverity: reading.symptomSeverity,
  });
  if (
    classification.severity === "critical_bypass" &&
    isFreshForReplayDispatch(reading.updatedAt)
  ) {
    // Plan as of the moment this version was saved: the cooldown stamp is
    // kept for twice the window, so a reading another dispatch suppressed
    // is still suppressed. Its own earlier dispatch is ignored, so the
    // hand-off re-ensures (or revives) that job — a no-op when it's fine.
    const dispatch = await planRespiratoryBypass(
      reading.userId,
      classification.reasons,
      reading.updatedAt.toISOString(),
      bypassOwner(reading.id, reading.version),
    );
    await handOffRespiratoryBypass(reading, dispatch, requestId, false);
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

export const createRespiratoryLog = async (
  input: CreateRespiratoryInput,
): Promise<CreateRespiratoryResult> => {
  const enabled = await getFlag<boolean>("respiratory_logging_enabled", false);
  if (!enabled) {
    throw new DomainError(
      "RESPIRATORY_DISABLED",
      "Respiratory logging is currently unavailable. Try again later.",
    );
  }

  const idem = await checkIdempotent(prisma.respiratoryLog, input.clientUuid, input.version);
  if (idem.kind === "stale") {
    throw new DomainError("READING_STALE_VERSION", "incoming version not newer than stored");
  }
  if (idem.kind === "replay") {
    return await buildReplayResult(idem.existing, input.requestId);
  }
  const existing = idem.kind === "update" ? idem.existing : null;

  await prisma.user.findUniqueOrThrow({ where: { id: input.userId } });

  // Baseline snapshot. The Phase 4 baseline lives on `User` and gains
  // its own update endpoint in Feature I (wearables); until then, an
  // explicit `baselinePeakFlow` on the request wins. Stored on the
  // log row so reclassification cannot drift if the user later
  // updates their personal-best.
  const baselineForClassifier = input.baselinePeakFlow ?? null;

  const classification = classifyRespiratoryReading({
    peakFlow: input.peakFlow ?? null,
    baselinePeakFlow: baselineForClassifier,
    inhalerUsed: input.inhalerUsed,
    symptomSeverity: input.symptomSeverity,
  });

  const plannedBypass =
    classification.severity === "critical_bypass"
      ? await planRespiratoryBypass(input.userId, classification.reasons, new Date().toISOString())
      : null;

  let reading: RespiratoryLog;
  if (existing) {
    reading = await prisma.respiratoryLog.update({
      where: {
        clientUuid_measuredAt: {
          clientUuid: existing.clientUuid,
          measuredAt: existing.measuredAt,
        },
      },
      data: {
        ...(input.peakFlow !== undefined ? { peakFlow: input.peakFlow } : { peakFlow: null }),
        ...(input.baselinePeakFlow !== undefined
          ? { baselinePeakFlow: input.baselinePeakFlow }
          : {}),
        inhalerUsed: input.inhalerUsed,
        ...(input.inhalerType !== undefined ? { inhalerType: input.inhalerType } : {}),
        ...(input.puffs !== undefined ? { puffs: input.puffs } : {}),
        ...(input.triggerNote !== undefined ? { triggerNote: input.triggerNote } : {}),
        symptomSeverity: input.symptomSeverity,
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        source: input.source,
        version: input.version,
      },
    });
  } else {
    try {
      reading = await prisma.respiratoryLog.create({
        data: {
          clientUuid: input.clientUuid,
          ...(input.peakFlow !== undefined ? { peakFlow: input.peakFlow } : {}),
          ...(input.baselinePeakFlow !== undefined
            ? { baselinePeakFlow: input.baselinePeakFlow }
            : {}),
          inhalerUsed: input.inhalerUsed,
          ...(input.inhalerType !== undefined ? { inhalerType: input.inhalerType } : {}),
          ...(input.puffs !== undefined ? { puffs: input.puffs } : {}),
          ...(input.triggerNote !== undefined ? { triggerNote: input.triggerNote } : {}),
          symptomSeverity: input.symptomSeverity,
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          source: input.source,
          measuredAt: new Date(input.measuredAt),
          version: input.version,
          user: { connect: { id: input.userId } },
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const winner = await prisma.respiratoryLog.findFirst({
          where: { clientUuid: input.clientUuid },
        });
        if (winner) {
          logger.info(
            { clientUuid: input.clientUuid, userId: input.userId },
            "respiratory concurrent create resolved as idempotent replay",
          );
          return await buildReplayResult(winner, input.requestId);
        }
      }
      throw err;
    }
  }

  if (plannedBypass) await handOffRespiratoryBypass(reading, plannedBypass, input.requestId, true);
  const withinCooldown = plannedBypass?.withinCooldown ?? false;

  // Phase 4 §E follow-up — ANALYZE_READING enqueue parity with glucose.
  // Runs detectRespiratoryTrend across 5/14/30-day windows in the
  // worker; null-peakFlow rows are filtered at the worker boundary.
  await enqueueBestEffort(QUEUE_NAMES.ANALYZE_READING, () =>
    analyzeQueue.add("analyze", {
      category: "respiratory",
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

export const deleteRespiratoryLog = async (params: {
  userId: string;
  id: string;
}): Promise<void> => {
  const existing = await prisma.respiratoryLog.findFirst({
    where: { id: params.id, userId: params.userId },
  });
  if (!existing) {
    throw new DomainError("READING_NOT_FOUND", "respiratory log does not exist");
  }
  await prisma.respiratoryLog.delete({
    where: {
      clientUuid_measuredAt: {
        clientUuid: existing.clientUuid,
        measuredAt: existing.measuredAt,
      },
    },
  });
};

export const listRespiratoryLogs = async (params: {
  userId: string;
  from?: Date;
  to?: Date;
  limit: number;
  cursor?: string;
}): Promise<{ data: RespiratoryLog[]; cursor: string | null; hasMore: boolean }> => {
  const where: Prisma.RespiratoryLogWhereInput = {
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

  const rows = await prisma.respiratoryLog.findMany({
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
