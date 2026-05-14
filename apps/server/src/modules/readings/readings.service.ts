import { DomainError } from "@swasth/shared-types";
import {
  computeFeedback,
  computeStreak,
  decideCriticalBypass,
  type BypassDecision,
} from "@swasth/domain-logic";
import { Prisma, type GlucoseReading } from "@prisma/client";
import { prisma } from "../../shared/database.js";
import { logger } from "../../shared/logger.js";
import { createQueue, QUEUE_NAMES } from "../../shared/queue.js";

const criticalQueue = createQueue<{ readingId: string; userId: string; decision: BypassDecision }>(
  QUEUE_NAMES.CRITICAL_ALERT,
);

// Patch #18 — device-time manipulation defense.
// If |client_measuredAt − server_now| exceeds this threshold, the reading
// counts as one anomalous occurrence. After TIME_ANOMALY_TRIGGER_COUNT cumulative
// occurrences, streak credit falls back to server time so users cannot game
// streaks by jumping the device clock. The reading itself preserves the
// patient-reported timestamp for medical fidelity.
const SERVER_TIME_FALLBACK_THRESHOLD_HOURS = 2;
const TIME_ANOMALY_TRIGGER_COUNT = 2;
const MS_PER_HOUR = 3_600_000;

interface CreateReadingInput {
  userId: string;
  clientUuid: string;
  valueMgDl: number;
  readingType: "fasting" | "pre_meal" | "post_meal" | "random" | "bedtime";
  context: "normal" | "festive";
  notes?: string | undefined;
  source: "manual" | "voice" | "device";
  measuredAt: string;
  version: number;
}

export interface CreateReadingResult {
  reading: GlucoseReading;
  streak: {
    currentStreakDays: number;
    milestoneReached: number | null;
  };
  feedback: { tone: string; messageKey: string; params: Record<string, unknown> };
  critical: BypassDecision;
}

const ist = (): number => 330;

// Idempotent replay response — fired when a client retries a POST with the
// same {clientUuid, version} we already persisted. Returns the existing
// reading and current downstream state without re-running streak/feedback
// side effects or re-enqueuing the critical alert.
const buildReplayResult = async (
  reading: GlucoseReading,
  userId: string,
): Promise<CreateReadingResult> => {
  const [streakState, feedbackEvent, contacts, lastBypassEvent] = await Promise.all([
    prisma.userStreak.findUnique({ where: { userId } }),
    prisma.feedbackEvent.findFirst({
      where: { readingId: reading.id },
      orderBy: { shownAt: "desc" },
    }),
    prisma.emergencyContact.findMany({ where: { userId }, orderBy: { priority: "asc" } }),
    prisma.feedbackEvent.findFirst({
      where: {
        userId,
        feedbackType: "critical_warn",
        shownAt: { gte: new Date(Date.now() - 30 * 60_000) },
      },
      orderBy: { shownAt: "desc" },
    }),
  ]);

  const critical = decideCriticalBypass({
    glucoseValueMgDl: reading.valueMgDl,
    nowIso: reading.measuredAt.toISOString(),
    lastBypassTriggeredAtIso: lastBypassEvent?.shownAt.toISOString() ?? null,
    emergencyContacts: contacts.map((c) => ({
      contactId: c.id,
      priority: c.priority,
      isGuardian: c.isGuardian,
    })),
  });

  return {
    reading,
    streak: {
      currentStreakDays: streakState?.currentStreakDays ?? 0,
      milestoneReached: null,
    },
    feedback: {
      tone: feedbackEvent?.tone ?? "neutral",
      messageKey: feedbackEvent?.messageKey ?? "reading.noted",
      params: (feedbackEvent?.messageParams as Record<string, unknown>) ?? {},
    },
    critical,
  };
};

export const createGlucoseReading = async (
  input: CreateReadingInput,
): Promise<CreateReadingResult> => {
  const serverNow = new Date();
  const measuredAtDate = new Date(input.measuredAt);
  const clockDeltaMs = Math.abs(serverNow.getTime() - measuredAtDate.getTime());
  const isAnomalousClock = clockDeltaMs > SERVER_TIME_FALLBACK_THRESHOLD_HOURS * MS_PER_HOUR;

  const existing = await prisma.glucoseReading.findFirst({
    where: { clientUuid: input.clientUuid },
  });

  if (existing) {
    if (input.version < existing.version) {
      throw new DomainError("READING_STALE_VERSION", "incoming version not newer than stored");
    }
    if (input.version === existing.version) {
      // Idempotent replay — same {clientUuid, version} we already stored.
      // Return the prior result without re-running side effects.
      return await buildReplayResult(existing, input.userId);
    }
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: input.userId } });

  // Increment time-anomaly counter atomically when this reading's client
  // clock is off by > 2hr from the server. The post-increment count drives
  // the streak-source decision below.
  let effectiveAnomalyCount = user.timeAnomalyCount;
  if (isAnomalousClock) {
    const updated = await prisma.user.update({
      where: { id: input.userId },
      data: { timeAnomalyCount: { increment: 1 } },
      select: { timeAnomalyCount: true },
    });
    effectiveAnomalyCount = updated.timeAnomalyCount;
    logger.warn(
      {
        userId: input.userId,
        clockDeltaMs,
        deviceTime: input.measuredAt,
        serverTime: serverNow.toISOString(),
        timeAnomalyCount: effectiveAnomalyCount,
      },
      "device clock anomaly detected",
    );
  }
  const useServerTimeForStreak = effectiveAnomalyCount >= TIME_ANOMALY_TRIGGER_COUNT;
  const streakSourceIso = useServerTimeForStreak ? serverNow.toISOString() : input.measuredAt;

  const state = await prisma.userStreak.upsert({
    where: { userId: input.userId },
    create: { userId: input.userId },
    update: {},
  });

  const recent = await prisma.glucoseReading.findMany({
    where: {
      userId: input.userId,
      measuredAt: { gte: new Date(Date.now() - 7 * 86_400_000) },
    },
    orderBy: { measuredAt: "desc" },
    take: 50,
  });

  const recentSameType = recent.filter((r) => r.readingType === input.readingType);

  const streakResult = computeStreak({
    state: {
      userId: state.userId,
      currentStreakDays: state.currentStreakDays,
      longestStreakDays: state.longestStreakDays,
      lastLogDate: state.lastLogDate ? state.lastLogDate.toISOString().slice(0, 10) : null,
      streakStartedAt: state.streakStartedAt?.toISOString() ?? null,
      totalLogDays: state.totalLogDays,
      brokenStreakLength: state.brokenStreakLength,
      graceUsedThisWeek: state.graceUsedThisWeek,
      milestonesReached: (state.milestonesReached as number[]) ?? [],
    },
    measuredAtIso: streakSourceIso,
    userTimezoneOffsetMinutes: ist(),
    recentLogTimestampsLast7d: recent.map((r) => r.measuredAt.toISOString()),
    recentValuesSameType: recentSameType.map((r) => r.valueMgDl),
  });

  const firstReadingCount = await prisma.glucoseReading.count({ where: { userId: input.userId } });
  const isFirst = firstReadingCount === 0;
  const lastSameType = recentSameType[0]?.valueMgDl ?? null;
  const userStageDays = Math.floor((Date.now() - user.createdAt.getTime()) / 86_400_000);

  const feedback = computeFeedback({
    currentValue: input.valueMgDl,
    currentType: input.readingType,
    context: input.context,
    userStageDays,
    isFirstReading: isFirst,
    sameTypeReadingsLast7d: recentSameType.map((r) => ({
      valueMgDl: r.valueMgDl,
      measuredAt: r.measuredAt.toISOString(),
    })),
    lastSameTypeValue: lastSameType,
    recentVariantIds: [],
    currentStreakDays: streakResult.nextState.currentStreakDays,
  });

  const recentCritical = await prisma.feedbackEvent.findFirst({
    where: {
      userId: input.userId,
      feedbackType: "critical_warn",
      shownAt: { gte: new Date(Date.now() - 30 * 60_000) },
    },
    orderBy: { shownAt: "desc" },
  });

  const contacts = await prisma.emergencyContact.findMany({
    where: { userId: input.userId },
    orderBy: { priority: "asc" },
  });

  const critical = decideCriticalBypass({
    glucoseValueMgDl: input.valueMgDl,
    nowIso: new Date().toISOString(),
    lastBypassTriggeredAtIso: recentCritical?.shownAt.toISOString() ?? null,
    emergencyContacts: contacts.map((c) => ({
      contactId: c.id,
      priority: c.priority,
      isGuardian: c.isGuardian,
    })),
  });

  const data: Prisma.GlucoseReadingCreateInput = {
    clientUuid: input.clientUuid,
    valueMgDl: input.valueMgDl,
    readingType: input.readingType,
    context: input.context,
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    source: input.source,
    measuredAt: new Date(input.measuredAt),
    streakCreditedTo: new Date(streakResult.streakCreditedTo),
    streakCreditedAtServerTime: useServerTimeForStreak,
    antiCheatFlags: streakResult.antiCheatFlags,
    version: input.version,
    user: { connect: { id: input.userId } },
  };

  // On update we deliberately preserve the existing measuredAt (the
  // partition key for the TimescaleDB hypertable). The user-facing edit
  // flow updates value/type/notes — not the medical timestamp. Anything
  // that would shift measuredAt should go through DELETE + create.
  let reading: GlucoseReading;
  if (existing) {
    reading = await prisma.glucoseReading.update({
      where: {
        clientUuid_measuredAt: {
          clientUuid: existing.clientUuid,
          measuredAt: existing.measuredAt,
        },
      },
      data: {
        valueMgDl: input.valueMgDl,
        readingType: input.readingType,
        context: input.context,
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        source: input.source,
        streakCreditedTo: new Date(streakResult.streakCreditedTo),
        streakCreditedAtServerTime: useServerTimeForStreak,
        antiCheatFlags: streakResult.antiCheatFlags,
        version: input.version,
      },
    });
  } else {
    try {
      reading = await prisma.glucoseReading.create({ data });
    } catch (err) {
      // P2002 on (clientUuid, measuredAt) means a concurrent request lost
      // the findFirst race and arrived first. Re-fetch and treat as replay.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const winner = await prisma.glucoseReading.findFirst({
          where: { clientUuid: input.clientUuid },
        });
        if (winner) {
          logger.info(
            { clientUuid: input.clientUuid, userId: input.userId },
            "concurrent create resolved as idempotent replay",
          );
          return await buildReplayResult(winner, input.userId);
        }
      }
      throw err;
    }
  }

  await prisma.userStreak.update({
    where: { userId: input.userId },
    data: {
      currentStreakDays: streakResult.nextState.currentStreakDays,
      longestStreakDays: streakResult.nextState.longestStreakDays,
      lastLogDate: new Date(streakResult.nextState.lastLogDate!),
      streakStartedAt: streakResult.nextState.streakStartedAt
        ? new Date(streakResult.nextState.streakStartedAt)
        : null,
      totalLogDays: streakResult.nextState.totalLogDays,
      brokenStreakLength: streakResult.nextState.brokenStreakLength,
      graceUsedThisWeek: streakResult.nextState.graceUsedThisWeek,
      milestonesReached: streakResult.nextState.milestonesReached,
    },
  });

  await prisma.feedbackEvent.create({
    data: {
      userId: input.userId,
      readingId: reading.id,
      feedbackType: feedback.type,
      tone: feedback.tone,
      messageKey: feedback.messageKey,
      variantIndex: feedback.variantIndex,
      messageParams: feedback.params,
    },
  });

  if (critical.isCritical && !critical.withinCooldown) {
    await criticalQueue.add("dispatch", {
      readingId: reading.id,
      userId: input.userId,
      decision: critical,
    });
  }

  if (streakResult.antiCheatFlags.length > 0) {
    logger.warn(
      { userId: input.userId, flags: streakResult.antiCheatFlags },
      "anti-cheat flags raised",
    );
  }

  return {
    reading,
    streak: {
      currentStreakDays: streakResult.nextState.currentStreakDays,
      milestoneReached: streakResult.milestoneReached,
    },
    feedback: { tone: feedback.tone, messageKey: feedback.messageKey, params: feedback.params },
    critical,
  };
};

export const deleteGlucoseReading = async (params: {
  userId: string;
  id: string;
}): Promise<void> => {
  const existing = await prisma.glucoseReading.findFirst({
    where: { id: params.id, userId: params.userId },
  });
  if (!existing) {
    throw new DomainError("READING_NOT_FOUND", "reading does not exist");
  }
  await prisma.glucoseReading.delete({
    where: {
      clientUuid_measuredAt: {
        clientUuid: existing.clientUuid,
        measuredAt: existing.measuredAt,
      },
    },
  });
};

export const listGlucoseReadings = async (params: {
  userId: string;
  from?: Date;
  to?: Date;
  limit: number;
  cursor?: string;
}): Promise<{ data: GlucoseReading[]; cursor: string | null; hasMore: boolean }> => {
  const where: Prisma.GlucoseReadingWhereInput = {
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

  const rows = await prisma.glucoseReading.findMany({
    where,
    orderBy: { measuredAt: "desc" },
    take: params.limit + 1,
    ...(params.cursor
      ? {
          skip: 1,
          cursor: {
            clientUuid_measuredAt: {
              clientUuid: params.cursor.split("_")[0]!,
              measuredAt: new Date(params.cursor.split("_")[1]!),
            },
          },
        }
      : {}),
  });

  const hasMore = rows.length > params.limit;
  const data = hasMore ? rows.slice(0, params.limit) : rows;
  const lastItem = data[data.length - 1];
  const cursor =
    hasMore && lastItem ? `${lastItem.clientUuid}_${lastItem.measuredAt.toISOString()}` : null;
  return { data, cursor, hasMore };
};
