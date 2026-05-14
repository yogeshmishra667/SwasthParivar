import {
  NOTIFICATION_PRIORITY,
  type NotificationCandidate,
  type NotificationState,
} from "@swasth/shared-types";
import type { ResolveInput, ResolveResult } from "./types.js";

const MS_PER_MIN = 60_000;
const MS_PER_DAY = 86_400_000;

const THROTTLE_MIN = 30;
const FATIGUE_DAILY_CAP_AT_LEVEL = [Infinity, Infinity, 1, 0] as const;

const isCritical = (c: NotificationCandidate): boolean => c.trigger === "critical_low_high";
const isMedReminder = (c: NotificationCandidate): boolean => c.trigger === "med_reminder";

const sortByPriority = (cands: NotificationCandidate[]): NotificationCandidate[] =>
  [...cands].sort((a, b) => NOTIFICATION_PRIORITY[a.trigger] - NOTIFICATION_PRIORITY[b.trigger]);

const sentInLast24h = (state: NotificationState, messageKey: string, nowMs: number): boolean =>
  state.notificationHistory7d.some(
    (h) => h.messageKey === messageKey && nowMs - Date.parse(h.at) < MS_PER_DAY,
  );

const nonMedSentToday = (state: NotificationState, nowMs: number): number =>
  state.notificationHistory7d.filter(
    (h) => h.type !== "med_reminder" && nowMs - Date.parse(h.at) < MS_PER_DAY,
  ).length;

export const resolveNotification = (input: ResolveInput): ResolveResult => {
  const { state, candidates, nowIso } = input;
  const nowMs = Date.parse(nowIso);

  if (candidates.length === 0) {
    return { kind: "suppress", reason: "no_candidates", nextState: state };
  }

  const ranked = sortByPriority(candidates);
  const top = ranked[0]!;

  if (isCritical(top)) {
    return { kind: "send", chosen: top, nextState: appendHistory(state, top, nowIso) };
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
    const cap = FATIGUE_DAILY_CAP_AT_LEVEL[state.fatigueLevel] ?? 0;
    if (cap === 0) return { kind: "suppress", reason: "fatigue_stop", nextState: state };
    if (nonMedSentToday(state, nowMs) >= cap) {
      return { kind: "suppress", reason: "fatigue_max_per_day", nextState: state };
    }
  }

  return { kind: "send", chosen: top, nextState: appendHistory(state, top, nowIso) };
};

const appendHistory = (
  state: NotificationState,
  chosen: NotificationCandidate,
  nowIso: string,
): NotificationState => {
  const cutoff = Date.parse(nowIso) - 7 * MS_PER_DAY;
  const trimmed = state.notificationHistory7d.filter((h) => Date.parse(h.at) >= cutoff);
  return {
    ...state,
    lastNotificationAt: nowIso,
    notificationHistory7d: [
      ...trimmed,
      { at: nowIso, type: chosen.trigger, messageKey: chosen.messageKey },
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
