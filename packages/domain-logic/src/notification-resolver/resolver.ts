import {
  NOTIFICATION_PRIORITY,
  type NotificationCandidate,
  type NotificationState,
  type NotificationTriggerType,
} from "@swasth/shared-types";
import type { ResolveInput, ResolveResult } from "./types.js";

const MS_PER_MIN = 60_000;
const MS_PER_DAY = 86_400_000;

const THROTTLE_MIN = 30;

// The cron ticks every 15 minutes and best-time sends drift by minutes, so
// a strict 24h / 48h window would push "1 a day" to every other day and
// "every other day" to every third. Windows are this much shorter.
const CAP_WINDOW_SLACK_MS = 30 * MS_PER_MIN;

// CLAUDE.md "Anti-Fatigue": at most 2 non-medicine pushes a day; 3
// ignores → 1 a day; 5 → every other day; 7 → stop (audit P11). Indexed
// by fatigue level.
const FATIGUE_CAP_AT_LEVEL: readonly { readonly max: number; readonly windowMs: number }[] = [
  { max: 2, windowMs: MS_PER_DAY - CAP_WINDOW_SLACK_MS },
  { max: 1, windowMs: MS_PER_DAY - CAP_WINDOW_SLACK_MS },
  { max: 1, windowMs: 2 * MS_PER_DAY - CAP_WINDOW_SLACK_MS },
  { max: 0, windowMs: MS_PER_DAY },
];

/** A habit-loop push not opened within this long counts as ignored. */
export const IGNORED_AFTER_MS = 4 * 60 * MS_PER_MIN;

const isCritical = (c: NotificationCandidate): boolean => c.trigger === "critical_low_high";
const isMedReminder = (c: NotificationCandidate): boolean => c.trigger === "med_reminder";

const sortByPriority = (cands: NotificationCandidate[]): NotificationCandidate[] =>
  [...cands].sort((a, b) => NOTIFICATION_PRIORITY[a.trigger] - NOTIFICATION_PRIORITY[b.trigger]);

const sentInLast24h = (state: NotificationState, messageKey: string, nowMs: number): boolean =>
  state.notificationHistory7d.some(
    (h) => h.messageKey === messageKey && nowMs - Date.parse(h.at) < MS_PER_DAY,
  );

// Medicine reminders and critical alerts never count toward the cap.
const countsTowardCap = (type: NotificationTriggerType): boolean =>
  type !== "med_reminder" && type !== "critical_low_high";

const cappedSentWithin = (state: NotificationState, nowMs: number, windowMs: number): number =>
  state.notificationHistory7d.filter(
    (h) => countsTowardCap(h.type) && nowMs - Date.parse(h.at) < windowMs,
  ).length;

export const resolveNotification = (input: ResolveInput): ResolveResult => {
  const { state, candidates, nowIso, notificationId } = input;
  const nowMs = Date.parse(nowIso);

  if (candidates.length === 0) {
    return { kind: "suppress", reason: "no_candidates", nextState: state };
  }

  const ranked = sortByPriority(candidates);
  const top = ranked[0]!;

  if (isCritical(top)) {
    return {
      kind: "send",
      chosen: top,
      nextState: appendHistory(state, top, nowIso, notificationId),
    };
  }

  if (sentInLast24h(state, top.messageKey, nowMs)) {
    return { kind: "suppress", reason: "duplicate_24h", nextState: state };
  }

  if (
    state.lastNotificationAt &&
    nowMs - Date.parse(state.lastNotificationAt) < THROTTLE_MIN * MS_PER_MIN &&
    !isMedReminder(top)
  ) {
    return { kind: "suppress", reason: "throttled_30min", nextState: state };
  }

  if (!isMedReminder(top)) {
    const cap = FATIGUE_CAP_AT_LEVEL[state.fatigueLevel] ?? { max: 0, windowMs: MS_PER_DAY };
    if (cap.max === 0) return { kind: "suppress", reason: "fatigue_stop", nextState: state };
    if (cappedSentWithin(state, nowMs, cap.windowMs) >= cap.max) {
      return { kind: "suppress", reason: "fatigue_max_per_day", nextState: state };
    }
  }

  return {
    kind: "send",
    chosen: top,
    nextState: appendHistory(state, top, nowIso, notificationId),
  };
};

const appendHistory = (
  state: NotificationState,
  chosen: NotificationCandidate,
  nowIso: string,
  notificationId: string | undefined,
): NotificationState => {
  const cutoff = Date.parse(nowIso) - 7 * MS_PER_DAY;
  const trimmed = state.notificationHistory7d.filter((h) => Date.parse(h.at) >= cutoff);
  return {
    ...state,
    lastNotificationAt: nowIso,
    notificationHistory7d: [
      ...trimmed,
      {
        at: nowIso,
        type: chosen.trigger,
        messageKey: chosen.messageKey,
        ...(notificationId !== undefined ? { notificationId } : {}),
      },
    ],
  };
};

export const recordIgnored = (state: NotificationState): NotificationState => {
  const ignores = state.consecutiveIgnores + 1;
  let level = state.fatigueLevel;
  if (ignores >= 7) level = 3;
  else if (ignores >= 5) level = 2;
  else if (ignores >= 3) level = 1;
  return { ...state, consecutiveIgnores: ignores, fatigueLevel: level };
};

export const recordOpened = (state: NotificationState): NotificationState => ({
  ...state,
  consecutiveIgnores: 0,
  fatigueLevel: 0,
});

export const recoverFatigueOn2DayLogStreak = (
  state: NotificationState,
  consecutiveLogDays: number,
): NotificationState => {
  if (consecutiveLogDays >= 2 && state.fatigueLevel > 0) {
    return { ...state, fatigueLevel: 0, consecutiveIgnores: 0 };
  }
  return state;
};

/**
 * Counts habit-loop pushes never opened within `IGNORED_AFTER_MS` as
 * ignored, each once (audit P11). Medicine reminders, critical alerts and
 * entries without a push id (sent before ids were recorded) never count.
 */
export const countIgnoredNotifications = (
  state: NotificationState,
  nowIso: string,
): { state: NotificationState; ignored: NotificationTriggerType[] } => {
  const nowMs = Date.parse(nowIso);
  const ignored: NotificationTriggerType[] = [];
  const history = state.notificationHistory7d.map((h) => {
    if (h.notificationId === undefined || h.openedAt !== undefined || h.ignoredAt !== undefined) {
      return h;
    }
    if (!countsTowardCap(h.type) || nowMs - Date.parse(h.at) < IGNORED_AFTER_MS) return h;
    ignored.push(h.type);
    return { ...h, ignoredAt: nowIso };
  });
  const next = ignored.reduce<NotificationState>((acc) => recordIgnored(acc), {
    ...state,
    notificationHistory7d: history,
  });
  return { state: next, ignored };
};

/**
 * The app reported a push opened: it is no longer a candidate ignore, and
 * fatigue resets to 0 (CLAUDE.md "Opens from push → reset fatigue to 0").
 * Only a habit push this user was sent counts: opening a medicine reminder
 * or a critical alert says nothing about the habit nudges, and the ignore
 * side excludes them too. An unknown id changes nothing.
 */
export const recordNotificationOpened = (
  state: NotificationState,
  notificationId: string,
  nowIso: string,
): NotificationState => {
  const entry = state.notificationHistory7d.find((h) => h.notificationId === notificationId);
  if (entry === undefined || !countsTowardCap(entry.type)) return state;
  return recordOpened({
    ...state,
    notificationHistory7d: state.notificationHistory7d.map((h) =>
      h === entry && h.openedAt === undefined ? { ...h, openedAt: nowIso } : h,
    ),
  });
};
