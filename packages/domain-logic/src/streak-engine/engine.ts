import {
  MAX_GRACE_PER_WEEK,
  STREAK_DAY_BOUNDARY_HOUR,
  STREAK_GRACE_HOURS,
  STREAK_MILESTONES,
  type StreakMilestone,
  type UserStreak,
} from "@swasth/shared-types";
import type { AntiCheatFlag, StreakComputeInput, StreakComputeResult } from "./types.js";

const MS_PER_DAY = 86_400_000;
const MS_PER_MIN = 60_000;
const MS_PER_HOUR = 3_600_000;

const toUserMs = (iso: string, tzOffsetMinutes: number): number =>
  new Date(iso).getTime() + tzOffsetMinutes * MS_PER_MIN;

const streakDateFor = (iso: string, tzOffsetMinutes: number): string => {
  const userMs = toUserMs(iso, tzOffsetMinutes);
  const shifted = userMs - STREAK_DAY_BOUNDARY_HOUR * MS_PER_HOUR;
  const d = new Date(shifted);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};

const dateDiffDays = (a: string, b: string): number => {
  const ad = Date.parse(`${a}T00:00:00Z`);
  const bd = Date.parse(`${b}T00:00:00Z`);
  return Math.round((ad - bd) / MS_PER_DAY);
};

const isWithinGraceWindow = (iso: string, tzOffsetMinutes: number): boolean => {
  const userMs = toUserMs(iso, tzOffsetMinutes);
  const d = new Date(userMs);
  const hour = d.getUTCHours();
  return hour >= STREAK_DAY_BOUNDARY_HOUR && hour < STREAK_DAY_BOUNDARY_HOUR + STREAK_GRACE_HOURS;
};

const detectMilestone = (current: number, reached: number[]): StreakMilestone | null => {
  for (const m of STREAK_MILESTONES) {
    if (current === m && !reached.includes(m)) return m;
  }
  return null;
};

const detectAntiCheat = (recentValues: number[]): AntiCheatFlag[] => {
  const flags: AntiCheatFlag[] = [];
  if (recentValues.length >= 3) {
    const last3 = recentValues.slice(-3);
    if (last3.every((v) => v === last3[0])) flags.push("same_value_3_consecutive");
  }
  if (recentValues.length >= 5) {
    const last5 = recentValues.slice(-5);
    if (last5.every((v) => v % 5 === 0)) flags.push("always_round_5_days");
  }
  return flags;
};

const countGraceUsedThisWeek = (timestamps: string[], tzOffsetMinutes: number): number => {
  let count = 0;
  for (const ts of timestamps) {
    const credited = streakDateFor(ts, tzOffsetMinutes);
    const userMs = toUserMs(ts, tzOffsetMinutes);
    const actualDate = new Date(userMs);
    const actualIso = `${actualDate.getUTCFullYear()}-${String(actualDate.getUTCMonth() + 1).padStart(2, "0")}-${String(actualDate.getUTCDate()).padStart(2, "0")}`;
    if (credited !== actualIso) count++;
  }
  return count;
};

export const computeStreak = (input: StreakComputeInput): StreakComputeResult => {
  const { state, measuredAtIso, userTimezoneOffsetMinutes } = input;

  const streakCreditedTo = streakDateFor(measuredAtIso, userTimezoneOffsetMinutes);
  const inGrace = isWithinGraceWindow(measuredAtIso, userTimezoneOffsetMinutes);

  const graceUsedThisWeek = countGraceUsedThisWeek(
    input.recentLogTimestampsLast7d,
    userTimezoneOffsetMinutes,
  );
  const graceLimitReached = graceUsedThisWeek >= MAX_GRACE_PER_WEEK;

  const useGrace = inGrace && !graceLimitReached;

  const lastLog = state.lastLogDate;
  const sameDay = lastLog === streakCreditedTo;
  const consecutive = lastLog !== null && dateDiffDays(streakCreditedTo, lastLog) === 1;

  const currentStreakDays = sameDay
    ? state.currentStreakDays
    : consecutive
      ? state.currentStreakDays + 1
      : 1;

  const longestStreakDays = Math.max(state.longestStreakDays, currentStreakDays);
  const totalLogDays = sameDay ? state.totalLogDays : state.totalLogDays + 1;
  const streakStartedAt = consecutive || sameDay ? state.streakStartedAt : measuredAtIso;
  const brokenStreakLength =
    !sameDay && !consecutive && state.currentStreakDays > 0
      ? state.currentStreakDays
      : state.brokenStreakLength;

  const milestone = sameDay ? null : detectMilestone(currentStreakDays, state.milestonesReached);
  const milestonesReached =
    milestone !== null ? [...state.milestonesReached, milestone] : state.milestonesReached;

  const nextState: UserStreak = {
    ...state,
    currentStreakDays,
    longestStreakDays,
    lastLogDate: streakCreditedTo,
    streakStartedAt,
    totalLogDays,
    brokenStreakLength,
    graceUsedThisWeek: useGrace ? graceUsedThisWeek + 1 : graceUsedThisWeek,
    milestonesReached,
  };

  return {
    nextState,
    streakCreditedTo,
    graceUsed: useGrace,
    graceLimitReached: inGrace && graceLimitReached,
    milestoneReached: milestone,
    antiCheatFlags: detectAntiCheat(input.recentValuesSameType),
  };
};
