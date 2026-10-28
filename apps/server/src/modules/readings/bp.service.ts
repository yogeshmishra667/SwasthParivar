import { bpCriticalDirection, DomainError } from "@swasth/shared-types";
import {
  classifyBPReading,
  planMultiCategoryBypassDispatch,
  type MultiCategoryBypassDispatch,
} from "@swasth/domain-logic";
import { Prisma, type BPReading } from "@prisma/client";
import { prisma } from "../../shared/database.js";
import { logger } from "../../shared/logger.js";
import { createQueue, enqueueBestEffort, QUEUE_NAMES } from "../../shared/queue.js";
import { checkIdempotent } from "../../shared/idempotency.js";
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

interface CreateBPInput {
  userId: string;
  clientUuid: string;
  systolic: number;
  diastolic: number;
  pulse?: number | undefined;
  context: "normal" | "festive";
  notes?: string | undefined;
  source: "manual" | "voice" | "device";
  measuredAt: string;
  /** When the device sent it (device clock), for the late-reading check (P33). */
  sentAt?: string | undefined;
  version: number;
  requestId?: string;
}

export interface CreateBPResult {
  reading: BPReading;
  critical: {
    isCritical: boolean;
    /** Classifier reason, e.g. `critical.sys_high` — for the app's copy. */
    primaryReason: string;
    direction: "low" | "high" | null;
    withinCooldown: boolean;
  };
}

/**
 * Plans the BP critical-bypass dispatch: per-category cooldown + emergency
 * contacts. Runs BEFORE the save, so no lookup can fail between the save
 * and the hand-off (audit P5). CLAUDE.md "Phase 4 Invariants": BP shares
 * the critical-alert chain and has its own per-category cooldown.
 */
const planBPBypass = async (
  userId: string,
  reasons: Parameters<typeof planMultiCategoryBypassDispatch>[0]["reasons"],
  nowIso: string,
  /** Replays only: this reading version's own stamp owner. */
  replayOf?: string,
): Promise<MultiCategoryBypassDispatch> => {
  const last = await getLastBypass("bp", userId);
  // A replay must not read its OWN earlier dispatch as a cooldown.
  const lastBypassIso = last !== null && last.owner !== replayOf ? last.atIso : null;
  const contacts = await prisma.emergencyContact.findMany({
    where: { userId },
    orderBy: { priority: "asc" },
    select: { id: true, priority: true, isGuardian: true },
  });
  return planMultiCategoryBypassDispatch({
    category: "bp",
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

/** Hands a planned dispatch off, then stamps the cooldown. Never throws. */
const handOffBPBypass = async (
  reading: BPReading,
  dispatch: MultiCategoryBypassDispatch,
  requestId: string | undefined,
  stamp: boolean,
  /** Audit P33: taken > 2h before it reached us — a late notice, no cooldown. */
  late: LateCriticalReading | null,
): Promise<void> => {
  if (dispatch.withinCooldown) return;
  const job: CriticalAlertMultiCategoryJob = {
    category: "bp",
    readingId: reading.id,
    userId: reading.userId,
    dispatch,
    copyParams: { systolic: reading.systolic, diastolic: reading.diastolic },
    ...(requestId ? { requestId } : {}),
    ...(late ? { late } : {}),
  };
  await enqueueCriticalAlert(job, reading.version);
  // A late reading doesn't start the cooldown: a real critical reading
  // soon after must still reach the family (audit P33).
  if (stamp && !late) {
    await markBypassed(
      "bp",
      reading.userId,
      new Date().toISOString(),
      bypassOwner(reading.id, reading.version),
    );
  }
};

const criticalView = (
  reading: { systolic: number; diastolic: number },
  withinCooldown: boolean,
): CreateBPResult["critical"] => {
  const classification = classifyBPReading(reading);
  return {
    isCritical: classification.severity === "critical_bypass",
    primaryReason: classification.reason,
    direction: bpCriticalDirection(reading.systolic, reading.diastolic),
    withinCooldown,
  };
};

/**
 * Idempotent replay — the client resent the same {clientUuid, version}.
 * A fresh critical reading's dispatch is re-ensured, not re-sent (P5).
 */
const buildReplayResult = async (
  reading: BPReading,
  requestId?: string,
): Promise<CreateBPResult> => {
  const classification = classifyBPReading(reading);
  if (
    classification.severity === "critical_bypass" &&
    isFreshForReplayDispatch(reading.updatedAt)
  ) {
    const dispatch = await planBPBypass(
      reading.userId,
      classification.reasons,
      reading.updatedAt.toISOString(),
      bypassOwner(reading.id, reading.version),
    );
    await handOffBPBypass(
      reading,
      dispatch,
      requestId,
      false,
      lateCriticalOf({ measuredAt: reading.measuredAt, receivedAt: reading.updatedAt }),
    );
  }
  return { reading, critical: criticalView(reading, false) };
};

export const createBPReading = async (input: CreateBPInput): Promise<CreateBPResult> => {
  const receivedAt = new Date();
  // Scoped to the caller: a clientUuid owned by another user is never
  // replayed back or updated (P4 review W5).
  const idem = await checkIdempotent(
    prisma.bPReading,
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

  // Ownership check: the user row must exist (Prisma FK enforces this on
  // create, but we surface a cleaner error if the JWT references a deleted
  // user).
  await prisma.user.findUniqueOrThrow({ where: { id: input.userId } });

  // CLAUDE.md BP thresholds (HARDCODED): sys < 90 or dia < 60, sys > 180 or
  // dia > 110 → the shared critical-alert chain (push + SMS + fullscreen +
  // call), with BP's own per-category cooldown (audit P4).
  const classification = classifyBPReading(input);
  const plannedBypass =
    classification.severity === "critical_bypass"
      ? await planBPBypass(input.userId, classification.reasons, new Date().toISOString())
      : null;

  // The update path deliberately preserves the existing measured_at
  // because it is the TimescaleDB hypertable partition key. The
  // user-facing edit flow updates value / notes — not the medical
  // timestamp. Anything that would shift measured_at goes through
  // DELETE + create.
  let reading: BPReading;
  if (existing) {
    reading = await prisma.bPReading.update({
      where: {
        clientUuid_measuredAt: {
          clientUuid: existing.clientUuid,
          measuredAt: existing.measuredAt,
        },
      },
      data: {
        systolic: input.systolic,
        diastolic: input.diastolic,
        ...(input.pulse !== undefined ? { pulse: input.pulse } : {}),
        context: input.context,
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        source: input.source,
        version: input.version,
      },
    });
  } else {
    try {
      reading = await prisma.bPReading.create({
        data: {
          clientUuid: input.clientUuid,
          systolic: input.systolic,
          diastolic: input.diastolic,
          ...(input.pulse !== undefined ? { pulse: input.pulse } : {}),
          context: input.context,
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          source: input.source,
          measuredAt: new Date(input.measuredAt),
          version: input.version,
          user: { connect: { id: input.userId } },
        },
      });
    } catch (err) {
      // P2002 on (clientUuid, measuredAt): a concurrent request won the
      // race — treat as a replay so the client gets a deterministic 2xx.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const winner = await prisma.bPReading.findFirst({
          where: { clientUuid: input.clientUuid, userId: input.userId },
        });
        if (winner) {
          logger.info(
            { clientUuid: input.clientUuid, userId: input.userId },
            "bp concurrent create resolved as idempotent replay",
          );
          return await buildReplayResult(winner, input.requestId);
        }
      }
      throw err;
    }
  }

  if (plannedBypass) {
    await handOffBPBypass(
      reading,
      plannedBypass,
      input.requestId,
      true,
      lateCriticalOf({ measuredAt: input.measuredAt, sentAt: input.sentAt, receivedAt }),
    );
  }

  // Phase 4 §E follow-up — enqueue category-aware ANALYZE_READING so
  // the cross-condition detector fires when BP arrives, not only when
  // glucose does. Best effort: a reading save never waits on insights.
  await enqueueBestEffort(QUEUE_NAMES.ANALYZE_READING, () =>
    analyzeQueue.add("analyze", {
      category: "bp",
      readingId: reading.id,
      userId: input.userId,
      ...(input.requestId ? { requestId: input.requestId } : {}),
    }),
  );

  return {
    reading,
    critical: criticalView(reading, plannedBypass?.withinCooldown ?? false),
  };
};

export const deleteBPReading = async (params: { userId: string; id: string }): Promise<void> => {
  const existing = await prisma.bPReading.findFirst({
    where: { id: params.id, userId: params.userId },
  });
  if (!existing) {
    throw new DomainError("READING_NOT_FOUND", "reading does not exist");
  }
  await prisma.bPReading.delete({
    where: {
      clientUuid_measuredAt: {
        clientUuid: existing.clientUuid,
        measuredAt: existing.measuredAt,
      },
    },
  });
};

export const listBPReadings = async (params: {
  userId: string;
  from?: Date;
  to?: Date;
  limit: number;
  cursor?: string;
}): Promise<{ data: BPReading[]; cursor: string | null; hasMore: boolean }> => {
  const where: Prisma.BPReadingWhereInput = {
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

  // Cursor format: `${clientUuid}_${measuredAtIso}` — same as glucose. The
  // composite cursor is required because the hypertable's primary key is
  // (id, measured_at); the (clientUuid, measuredAt) unique index is what
  // Prisma exposes as a cursor anchor.
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

  const rows = await prisma.bPReading.findMany({
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
