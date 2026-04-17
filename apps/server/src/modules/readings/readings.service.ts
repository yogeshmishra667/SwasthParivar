import { DomainError } from "@swasth/shared-types";
import {
  computeFeedback,
  computeStreak,
  decideCriticalBypass,
  type BypassDecision,
} from "@swasth/domain-logic";
import type { GlucoseReading, Prisma } from "@prisma/client";
import { prisma } from "../../shared/database.js";
import { logger } from "../../shared/logger.js";
import { createQueue, QUEUE_NAMES } from "../../shared/queue.js";

const criticalQueue = createQueue<{ readingId: string; userId: string; decision: BypassDecision }>(
  QUEUE_NAMES.CRITICAL_ALERT,
);

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

export const createGlucoseReading = async (
  input: CreateReadingInput,
): Promise<CreateReadingResult> => {
  const existing = await prisma.glucoseReading.findFirst({ where: { clientUuid: input.clientUuid } });

  if (existing) {
    if (input.version <= existing.version) {
      throw new DomainError("READING_STALE_VERSION", "incoming version not newer than stored");
    }
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: input.userId } });

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
    measuredAtIso: input.measuredAt,
    userTimezoneOffsetMinutes: ist(),
    recentLogTimestampsLast7d: recent.map((r) => r.measuredAt.toISOString()),
    recentValuesSameType: recentSameType.map((r) => r.valueMgDl),
  });

  const firstReadingCount = await prisma.glucoseReading.count({ where: { userId: input.userId } });
  const isFirst = firstReadingCount === 0;
  const lastSameType = recentSameType[0]?.valueMgDl ?? null;
  const userStageDays = Math.floor(
    (Date.now() - user.createdAt.getTime()) / 86_400_000,
  );

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
    version: input.version,
    user: { connect: { id: input.userId } },
  };

  const reading = existing
    ? await prisma.glucoseReading.update({
        where: { clientUuid_measuredAt: { clientUuid: existing.clientUuid, measuredAt: existing.measuredAt } },
        data: { ...data, version: input.version },
      })
    : await prisma.glucoseReading.create({ data });

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
    await criticalQueue.add("dispatch", { readingId: reading.id, userId: input.userId, decision: critical });
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
      ? { measuredAt: { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lte: params.to } : {}) } }
      : {}),
  };

  const rows = await prisma.glucoseReading.findMany({
    where,
    orderBy: { measuredAt: "desc" },
    take: params.limit + 1,
    ...(params.cursor ? { skip: 1, cursor: { clientUuid_measuredAt: { clientUuid: params.cursor.split('_')[0]!, measuredAt: new Date(params.cursor.split('_')[1]!) } } } : {}),
  });

  const hasMore = rows.length > params.limit;
  const data = hasMore ? rows.slice(0, params.limit) : rows;
  const lastItem = data[data.length - 1];
  const cursor = hasMore && lastItem ? `${lastItem.clientUuid}_${lastItem.measuredAt.toISOString()}` : null;
  return { data, cursor, hasMore };
};
