import { DomainError } from "@swasth/shared-types";
import {
  CRITICAL_COOLDOWN_MINUTES,
  computeFeedback,
  computeStreak,
  decideCriticalBypass,
  type BypassDecision,
} from "@swasth/domain-logic";
import { Prisma, type GlucoseReading } from "@prisma/client";
import { prisma } from "../../shared/database.js";
import { redis } from "../../shared/redis.js";
import { logger } from "../../shared/logger.js";
import { withTimeout } from "../../shared/with-timeout.js";
import { createQueue, enqueueBestEffort, QUEUE_NAMES } from "../../shared/queue.js";
import { capture as captureAnalyticsEvent } from "../../shared/analytics/posthog.js";
import { checkIdempotent } from "../../shared/idempotency.js";
import { getReadingsDailyLimit } from "../../shared/middleware/rate-limit.js";
import {
  enqueueCriticalAlert,
  isFreshForReplayDispatch,
} from "../../workers/critical-alert.enqueue.js";

const analyzeQueue = createQueue<{
  readingId: string;
  userId: string;
  readingType: GlucoseReading["readingType"];
  requestId?: string;
}>(QUEUE_NAMES.ANALYZE_READING);

// Patch #18 — device-time manipulation defense.
// If |client_measuredAt − server_now| exceeds this threshold, the reading
// counts as one anomalous occurrence. After TIME_ANOMALY_TRIGGER_COUNT cumulative
// occurrences, streak credit falls back to server time so users cannot game
// streaks by jumping the device clock. The reading itself preserves the
// patient-reported timestamp for medical fidelity.
const SERVER_TIME_FALLBACK_THRESHOLD_HOURS = 2;
const TIME_ANOMALY_TRIGGER_COUNT = 2;
const MS_PER_HOUR = 3_600_000;

// Hardcoded medical-safety thresholds (CLAUDE.md "Critical-Low/High Bypass").
// Glucose readings outside this band bypass the daily rate limit so a patient
// in crisis can always log — even at the admin-imposed ceiling of "1/day".
const GLUCOSE_CRITICAL_LOW = 65;
const GLUCOSE_CRITICAL_HIGH = 315;

// Daily reading counter — per user, per UTC calendar day. Mirrors
// `incrementDailyRateCounter` in chat.service.ts for symmetry. TTL is 36h
// so the key self-expires across the day boundary without a cron sweep.
//
// Fails OPEN, bounded: during a Redis outage `incr` would hang (the client
// runs `maxRetriesPerRequest: null`) and stall `/sync/push`, which saves
// items in order — a critical reading queued behind a normal one would
// wait on Redis (P5 review N5). A rate limit must never block logging.
const RATE_COUNTER_TIMEOUT_MS = 500;
const incrementDailyReadingsCounter = async (userId: string): Promise<number> => {
  const key = `readings:rate:${userId}:${new Date().toISOString().slice(0, 10)}`;
  try {
    const count = await withTimeout(redis.incr(key), RATE_COUNTER_TIMEOUT_MS, "readings counter");
    if (count === 1)
      await withTimeout(
        redis.expire(key, 60 * 60 * 36),
        RATE_COUNTER_TIMEOUT_MS,
        "readings counter",
      );
    return count;
  } catch (err) {
    logger.warn({ err, userId }, "daily readings counter unavailable — not rate limiting");
    return 0;
  }
};

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
  requestId?: string;
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
// side effects. The critical alert is re-ensured, not re-sent: the
// original request may have died between saving the row and handing off
// its alert (audit P5), and the per-version jobId makes this a no-op when
// the job already exists.
const buildReplayResult = async (
  reading: GlucoseReading,
  userId: string,
  requestId?: string,
): Promise<CreateReadingResult> => {
  // Re-derive the decision the original request made: as of the moment
  // this version was saved, against critical alerts shown BEFORE it. This
  // version's own critical_warn is written after the save, so `lt`
  // excludes it — otherwise every replay would read as "within cooldown".
  const savedAt = reading.updatedAt;
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
        shownAt: {
          gte: new Date(savedAt.getTime() - CRITICAL_COOLDOWN_MINUTES * 60_000),
          lt: savedAt,
        },
      },
      orderBy: { shownAt: "desc" },
    }),
  ]);

  const critical = decideCriticalBypass({
    glucoseValueMgDl: reading.valueMgDl,
    nowIso: savedAt.toISOString(),
    lastBypassTriggeredAtIso: lastBypassEvent?.shownAt.toISOString() ?? null,
    emergencyContacts: contacts.map((c) => ({
      contactId: c.id,
      priority: c.priority,
      isGuardian: c.isGuardian,
    })),
  });

  if (critical.isCritical && !critical.withinCooldown && isFreshForReplayDispatch(savedAt)) {
    await enqueueCriticalAlert(
      {
        readingId: reading.id,
        userId,
        decision: critical,
        ...(requestId ? { requestId } : {}),
      },
      reading.version,
    );
  }

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

  const idem = await checkIdempotent(prisma.glucoseReading, input.clientUuid, input.version);
  if (idem.kind === "stale") {
    throw new DomainError("READING_STALE_VERSION", "incoming version not newer than stored");
  }
  if (idem.kind === "replay") {
    // Idempotent replay — same {clientUuid, version} we already stored.
    // Return the prior result without re-running side effects.
    return await buildReplayResult(idem.existing, input.userId, input.requestId);
  }
  // `update` carries the existing row; `insert` leaves it null.
  const existing = idem.kind === "update" ? idem.existing : null;

  const user = await prisma.user.findUniqueOrThrow({ where: { id: input.userId } });

  // Daily readings rate limit — free tier only, admin-tunable via the
  // `rate_limit.readings.free` flag (see admin OpsPage). Replays + stale-
  // version paths already exited above, so we only count fresh inserts and
  // version-bump updates. Critical-bypass values (< 65 or > 315) always
  // pass — medical safety overrides the cap.
  const isCriticalValue =
    input.valueMgDl < GLUCOSE_CRITICAL_LOW || input.valueMgDl > GLUCOSE_CRITICAL_HIGH;
  if (user.tier === "free" && !isCriticalValue) {
    const [dailyCount, dailyLimit] = await Promise.all([
      incrementDailyReadingsCounter(input.userId),
      getReadingsDailyLimit(),
    ]);
    if (dailyCount > dailyLimit) {
      throw new DomainError(
        "RATE_LIMITED",
        `Daily reading limit (${dailyLimit}) reached. Try again tomorrow.`,
      );
    }
  }

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
          return await buildReplayResult(winner, input.userId, input.requestId);
        }
      }
      throw err;
    }
  }

  // Hand off the critical alert FIRST — before the streak and feedback
  // writes — so no later failure can leave a saved critical reading whose
  // alert never went out (audit P5). Bounded, and never throws.
  if (critical.isCritical && !critical.withinCooldown) {
    await enqueueCriticalAlert(
      {
        readingId: reading.id,
        userId: input.userId,
        decision: critical,
        ...(input.requestId ? { requestId: input.requestId } : {}),
      },
      reading.version,
    );
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

  // Phase 2 step 3c — fire ANALYZE_READING for every glucose insert.
  // The processor runs spike / trend / meal-correlation / anomaly in
  // parallel; below-floor confidence rows persist but are suppressed
  // from the feed. 3 retries + exp backoff come from queue defaults.
  await enqueueBestEffort(QUEUE_NAMES.ANALYZE_READING, () =>
    analyzeQueue.add("analyze", {
      readingId: reading.id,
      userId: input.userId,
      readingType: reading.readingType,
    }),
  );

  if (streakResult.antiCheatFlags.length > 0) {
    logger.warn(
      { userId: input.userId, flags: streakResult.antiCheatFlags },
      "anti-cheat flags raised",
    );
  }

  captureAnalyticsEvent("reading_logged", input.userId, {
    type: input.readingType,
    source: input.source,
    time_to_log_seconds: null,
    user_stage: userStageDays,
    streak_credited_to_server_time: useServerTimeForStreak,
  });

  if (streakResult.milestoneReached !== null) {
    captureAnalyticsEvent("streak_milestone", input.userId, {
      milestone_days: streakResult.milestoneReached,
      longest_streak_days: streakResult.nextState.longestStreakDays,
    });
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
