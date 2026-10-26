// TRIGGER_NOTIFICATION — the 15-minute habit-loop nudge (best time,
// missed day, re-engagement, streak risk). Side-effect-free at import; the
// worker binds it to BullMQ.
//
// Anti-fatigue (CLAUDE.md, audit P11): before resolving, pushes the user
// never opened count as ignored (3 → 1/day, 5 → every other day, 7 →
// stop), and logging on 2 consecutive days resets fatigue. Every push
// records its id, so the app's "opened" report resets fatigue too.

import { randomUUID } from "node:crypto";
import {
  countIgnoredNotifications,
  dateDiffDays,
  recoverFatigueOn2DayLogStreak,
  resolveNotification,
  streakDateFor,
} from "@swasth/domain-logic";
import type {
  NotificationCandidate,
  NotificationState as SharedNotificationState,
  NotificationTriggerType,
} from "@swasth/shared-types";
import type { NotificationState as PrismaNotificationState, Language } from "@prisma/client";
import { prisma } from "../shared/database.js";
import { logger } from "../shared/logger.js";
import { capture as captureAnalyticsEvent } from "../shared/analytics/posthog.js";
import { sendExpoPush } from "../shared/notifications/expo-push.js";
import { resolveHouseholdDelivery } from "../shared/notifications/household-delivery.js";
import {
  persistNotificationState,
  toSharedNotificationState,
} from "../shared/notifications/notification-state.js";
import { notif, withProfilePrefix } from "../shared/i18n/notifications.js";
import { tzOffsetMinutes } from "../modules/schedules/schedules.service.js";

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
  /**
   * Streak days (user's timezone, 3 AM boundary) since the last logged
   * day: 0 = logged today, 1 = yesterday. Infinity if never.
   */
  streakDaysSinceLog: number;
  currentStreak: number;
}

const buildCandidates = (ctx: UserCtx, now: Date): NotificationCandidate[] => {
  const nowHm = hmNow(now);
  const candidates: NotificationCandidate[] = [];

  const daysSinceLog = ctx.lastLogDate
    ? Math.floor((now.getTime() - ctx.lastLogDate.getTime()) / 86_400_000)
    : Infinity;

  // Already logged today: no "time to check" nudge (audit P11).
  const loggedToday = ctx.streakDaysSinceLog === 0;
  if (!loggedToday && within(ctx.state.bestLogTimeFasting, nowHm, 7)) {
    candidates.push({
      trigger: "best_time",
      messageKey: "notification.best_time_fasting",
      scheduledFor: now.toISOString(),
      params: {},
    });
  } else if (!loggedToday && within(ctx.state.bestLogTimePostMeal, nowHm, 7)) {
    candidates.push({
      trigger: "best_time",
      messageKey: "notification.best_time_post_meal",
      scheduledFor: now.toISOString(),
      params: {},
    });
  }

  // CLAUDE.md re-engagement ladder. The resolver's anti-fatigue clamps
  // the cadence (3 ignores → 1/day cap, 5 → every-other-day, 7 → stop)
  // — we just emit candidates and let it gate.
  //
  // Day 1-2: missed_day with day-N copy ("Kal nahi hua").
  // Day 3-7: re_engagement with escalating concern. We use a per-day
  //          messageKey so the resolver's 24h duplicate suppression
  //          doesn't eat the next day's nudge.
  // Day 8+:  silent. The user returns on their own; the mobile
  //          welcome-back banner handles the next reading save.
  if (daysSinceLog >= 1 && daysSinceLog < 3) {
    candidates.push({
      trigger: "missed_day",
      messageKey: `notification.missed_day_d${daysSinceLog}`,
      scheduledFor: now.toISOString(),
      params: { days: daysSinceLog },
    });
  } else if (daysSinceLog >= 3 && daysSinceLog < 8) {
    candidates.push({
      trigger: "re_engagement",
      messageKey: `notification.re_engagement_d${daysSinceLog}`,
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

// Dispatch resolver triggers into the shared i18n bundle. Every trigger
// the resolver can emit must map here; the switch is exhaustive so a
// new trigger fails to compile if no copy was added.
const buildCopy = (
  trigger: NotificationTriggerType,
  params: Record<string, string | number>,
  language: Language,
): { title: string; body: string } => {
  switch (trigger) {
    case "critical_low_high":
      return notif("critical_low_high", undefined as never, language);
    case "best_time":
      return notif("best_time", undefined as never, language);
    case "missed_day":
      return notif("missed_day", { days: Number(params.days ?? 1) }, language);
    case "re_engagement":
      return notif("re_engagement", { days: Number(params.days ?? 3) }, language);
    case "welcome_back":
      return notif("welcome_back", undefined as never, language);
    case "streak_risk":
      return notif("streak_risk", { streak: Number(params.streak ?? 7) }, language);
    case "generic_morning":
      return notif("generic_morning", undefined as never, language);
    case "med_reminder":
      // The notification-trigger path never carries a real medicine
      // name (med-reminder.worker.ts owns those); this is the resolver
      // fallback copy. Use a generic placeholder.
      return notif("med_reminder", { medicine: "" }, language);
  }
};

export const processNotificationTriggerUser = async (userId: string, now: Date): Promise<void> => {
  const stateRaw = await prisma.notificationState.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });

  // A non-primary household profile owns no push token of its own —
  // resolve delivery across the household so the shared device still
  // receives this profile's nudge.
  const { memberIds, tokens } = await resolveHouseholdDelivery(userId);
  if (tokens.length === 0) {
    logger.warn(
      { userId, householdSize: memberIds.length },
      "notification-trigger: zero push tokens in household — skipping",
    );
    captureAnalyticsEvent("push_zero_recipients", userId, {
      surface: "notification_trigger",
      reason: "no_tokens_in_household",
      household_size: memberIds.length,
    });
    return;
  }

  // Always load the profile so we know which language to render copy
  // in. Name is only used to prefix the title on a shared-device
  // household (memberIds > 1).
  const profile = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, preferredLanguage: true, timezone: true },
  });
  const language: Language = profile?.preferredLanguage ?? "hi";
  const profileName: string | null = memberIds.length > 1 ? (profile?.name ?? null) : null;

  const streak = await prisma.userStreak.findUnique({ where: { userId } });
  const lastLogDate = streak?.lastLogDate ?? null;
  const currentStreak = streak?.currentStreakDays ?? 0;
  // `lastLogDate` is a streak day (a DATE), so compare streak days, not
  // milliseconds — UTC arithmetic misreads the 3 AM boundary.
  const today = streakDateFor(
    now.toISOString(),
    tzOffsetMinutes(profile?.timezone ?? "Asia/Kolkata", now.getTime()),
  );
  const streakDaysSinceLog =
    lastLogDate === null
      ? Number.POSITIVE_INFINITY
      : dateDiffDays(today, lastLogDate.toISOString().slice(0, 10));

  // Anti-fatigue bookkeeping first, so the cap below sees it (audit P11).
  const counted = countIgnoredNotifications(toSharedNotificationState(stateRaw), now.toISOString());
  for (const type of counted.ignored) {
    captureAnalyticsEvent("notification_ignored", userId, {
      trigger_type: type,
      fatigue_level: counted.state.fatigueLevel,
    });
  }
  // CLAUDE.md Edge Case #15: logging 2 consecutive days resets fatigue.
  // The streak counts only while it is current (logged today or yesterday).
  const state = recoverFatigueOn2DayLogStreak(
    counted.state,
    streakDaysSinceLog <= 1 ? currentStreak : 0,
  );
  const bookkeepingChanged = counted.ignored.length > 0 || state !== counted.state;

  const ctx: UserCtx = {
    userId,
    state,
    stateRaw,
    tokens,
    lastLogDate,
    streakDaysSinceLog,
    currentStreak,
  };

  const candidates = buildCandidates(ctx, now);
  if (candidates.length === 0) {
    if (bookkeepingChanged) await persistNotificationState(userId, state);
    return;
  }

  const notificationId = randomUUID();
  const result = resolveNotification({
    state: ctx.state,
    candidates,
    nowIso: now.toISOString(),
    notificationId,
  });

  if (result.kind === "suppress") {
    if (bookkeepingChanged) await persistNotificationState(userId, state);
    logger.debug({ userId, reason: result.reason }, "notification suppressed");
    captureAnalyticsEvent("notification_sent", userId, {
      trigger_type: "none",
      variant_id: null,
      suppressed: true,
      suppress_reason: result.reason,
    });
    return;
  }

  const copy = buildCopy(result.chosen.trigger, result.chosen.params, language);
  const title = withProfilePrefix(copy.title, profileName, language);
  await sendExpoPush(
    ctx.tokens.map((t) => ({
      to: t,
      title,
      body: copy.body,
      sound: "default",
      priority: "high",
      channelId: "reminders",
      data: {
        notificationId,
        type: result.chosen.trigger,
        messageKey: result.chosen.messageKey,
        targetUserId: userId,
      },
    })),
  );

  captureAnalyticsEvent("notification_sent", userId, {
    trigger_type: result.chosen.trigger,
    variant_id: null,
    suppressed: false,
    suppress_reason: null,
  });

  await persistNotificationState(userId, result.nextState);
};

/** One cron tick: every onboarded user, each isolated from the others' failures. */
export const processNotificationTriggerTick = async (now: Date): Promise<void> => {
  const users = await prisma.user.findMany({
    where: { onboardingComplete: true },
    select: { id: true },
  });
  for (const u of users) {
    try {
      await processNotificationTriggerUser(u.id, now);
    } catch (err) {
      logger.error({ err, userId: u.id }, "notification trigger failed for user");
    }
  }
};
