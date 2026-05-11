import { randomUUID } from "node:crypto";
import type { Worker } from "bullmq";
import { resolveNotification } from "@swasth/domain-logic";
import type {
  NotificationCandidate,
  NotificationState as SharedNotificationState,
  NotificationTriggerType,
} from "@swasth/shared-types";
import type { NotificationState as PrismaNotificationState } from "@prisma/client";
import { createWorker, createQueue, QUEUE_NAMES } from "../shared/queue.js";
import { prisma } from "../shared/database.js";
import { logger } from "../shared/logger.js";
import { sendExpoPush } from "../shared/notifications/expo-push.js";

interface TickJob { tick: true }

const triggerQueue = createQueue<TickJob>(QUEUE_NAMES.TRIGGER_NOTIFICATION);

const REPEAT_PATTERN = "*/15 * * * *";
const REPEAT_KEY = "notification:trigger:tick";

export const bootstrapNotificationCron = async (): Promise<void> => {
  await triggerQueue.add(
    "tick",
    { tick: true },
    {
      repeat: { pattern: REPEAT_PATTERN, tz: "Asia/Kolkata", key: REPEAT_KEY },
      jobId: REPEAT_KEY,
    },
  );
};

const toShared = (s: PrismaNotificationState): SharedNotificationState => ({
  userId: s.userId,
  fatigueLevel: (Math.min(3, Math.max(0, s.fatigueLevel)) as 0 | 1 | 2 | 3),
  consecutiveIgnores: s.consecutiveIgnores,
  lastNotificationAt: s.lastNotificationAt?.toISOString() ?? null,
  bestLogTimeFasting: s.bestLogTimeFasting,
  bestLogTimePostMeal: s.bestLogTimePostMeal,
  notificationHistory7d: (s.notificationHistory7d as SharedNotificationState["notificationHistory7d"]) ?? [],
  last3VariantIds: (s.last3VariantIds as string[]) ?? [],
});

const persistState = async (userId: string, next: SharedNotificationState): Promise<void> => {
  await prisma.notificationState.update({
    where: { userId },
    data: {
      fatigueLevel: next.fatigueLevel,
      consecutiveIgnores: next.consecutiveIgnores,
      lastNotificationAt: next.lastNotificationAt ? new Date(next.lastNotificationAt) : null,
      bestLogTimeFasting: next.bestLogTimeFasting,
      bestLogTimePostMeal: next.bestLogTimePostMeal,
      notificationHistory7d: next.notificationHistory7d,
      last3VariantIds: next.last3VariantIds,
    },
  });
};

const hmNow = (now: Date): { h: number; m: number } => {
  const istMs = now.getTime() + 330 * 60_000;
  const d = new Date(istMs);
  return { h: d.getUTCHours(), m: d.getUTCMinutes() };
};

const within = (hmm: string, now: { h: number; m: number }, windowMin: number): boolean => {
  const [hh, mm] = hmm.split(":").map((n) => parseInt(n, 10));
  if (hh === undefined || mm === undefined) return false;
  const targetMin = hh * 60 + mm;
  const nowMin = now.h * 60 + now.m;
  const diff = Math.abs(targetMin - nowMin);
  return diff <= windowMin;
};

interface UserCtx {
  userId: string;
  state: SharedNotificationState;
  stateRaw: PrismaNotificationState;
  tokens: string[];
  lastLogDate: Date | null;
  currentStreak: number;
}

const buildCandidates = (ctx: UserCtx, now: Date): NotificationCandidate[] => {
  const nowHm = hmNow(now);
  const candidates: NotificationCandidate[] = [];

  const daysSinceLog = ctx.lastLogDate
    ? Math.floor((now.getTime() - ctx.lastLogDate.getTime()) / 86_400_000)
    : Infinity;

  if (within(ctx.state.bestLogTimeFasting, nowHm, 7)) {
    candidates.push({
      trigger: "best_time",
      messageKey: "notification.best_time_fasting",
      scheduledFor: now.toISOString(),
      params: {},
    });
  } else if (within(ctx.state.bestLogTimePostMeal, nowHm, 7)) {
    candidates.push({
      trigger: "best_time",
      messageKey: "notification.best_time_post_meal",
      scheduledFor: now.toISOString(),
      params: {},
    });
  }

  if (daysSinceLog >= 1 && daysSinceLog < 3) {
    candidates.push({
      trigger: "missed_day",
      messageKey: "notification.missed_day",
      scheduledFor: now.toISOString(),
      params: { days: daysSinceLog },
    });
  }

  if (ctx.currentStreak >= 7 && nowHm.h >= 20 && daysSinceLog >= 1) {
    candidates.push({
      trigger: "streak_risk",
      messageKey: "notification.streak_risk",
      scheduledFor: now.toISOString(),
      params: { streak: ctx.currentStreak },
    });
  }

  return candidates;
};

const COPY: Record<
  NotificationTriggerType,
  (p: Record<string, string | number>) => { title: string; body: string }
> = {
  critical_low_high: () => ({ title: "⚠️ Critical", body: "Check reading." }),
  best_time: () => ({ title: "Sugar check karein?", body: "Aaj ka log kar lein 🙏" }),
  missed_day: (p) => ({
    title: `${p.days ?? 1} din se log nahi`,
    body: "Sab theek? Aaj ek reading le lein.",
  }),
  streak_risk: (p) => ({
    title: `${p.streak ?? 7} din ki streak!`,
    body: "Aaj bhi log karein, streak safe rahegi 🔥",
  }),
  generic_morning: () => ({ title: "Good morning", body: "Aaj sugar check karein" }),
  med_reminder: () => ({ title: "Dawai ka time", body: "Dawai le lein" }),
};

const processUser = async (userId: string, now: Date): Promise<void> => {
  const stateRaw = await prisma.notificationState.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });

  const tokens = await prisma.pushToken.findMany({
    where: { userId },
    select: { token: true },
  });
  if (tokens.length === 0) return;

  const streak = await prisma.userStreak.findUnique({ where: { userId } });

  const ctx: UserCtx = {
    userId,
    state: toShared(stateRaw),
    stateRaw,
    tokens: tokens.map((t) => t.token),
    lastLogDate: streak?.lastLogDate ?? null,
    currentStreak: streak?.currentStreakDays ?? 0,
  };

  const candidates = buildCandidates(ctx, now);
  if (candidates.length === 0) return;

  const result = resolveNotification({
    state: ctx.state,
    candidates,
    nowIso: now.toISOString(),
  });

  if (result.kind === "suppress") {
    logger.debug({ userId, reason: result.reason }, "notification suppressed");
    return;
  }

  const copy = COPY[result.chosen.trigger](result.chosen.params);
  const notificationId = randomUUID();
  await sendExpoPush(
    ctx.tokens.map((t) => ({
      to: t,
      title: copy.title,
      body: copy.body,
      sound: "default",
      priority: "high",
      channelId: "reminders",
      data: {
        notificationId,
        type: result.chosen.trigger,
        messageKey: result.chosen.messageKey,
      },
    })),
  );

  await persistState(userId, result.nextState);
};

export const notificationTriggerWorker: Worker<TickJob> = createWorker<TickJob>(
  QUEUE_NAMES.TRIGGER_NOTIFICATION,
  async () => {
    const now = new Date();
    const users = await prisma.user.findMany({
      where: { onboardingComplete: true },
      select: { id: true },
    });

    for (const u of users) {
      try {
        await processUser(u.id, now);
      } catch (err) {
        logger.error({ err, userId: u.id }, "notification trigger failed for user");
      }
    }
  },
);
