import { describe, expect, it } from "vitest";
import type { UserStreak } from "@swasth/shared-types";
import { computeStreak } from "./engine.js";

const baseState: UserStreak = {
  userId: "u1",
  currentStreakDays: 0,
  longestStreakDays: 0,
  lastLogDate: null,
  streakStartedAt: null,
  totalLogDays: 0,
  brokenStreakLength: 0,
  graceUsedThisWeek: 0,
  milestonesReached: [],
};

const IST_OFFSET = 330;

describe("streak day boundary 3AM IST", () => {
  it("2:59AM IST → credits previous day", () => {
    const r = computeStreak({
      state: baseState,
      measuredAtIso: "2026-04-15T21:29:00.000Z",
      userTimezoneOffsetMinutes: IST_OFFSET,
      recentLogTimestampsLast7d: [],
      recentValuesSameType: [],
    });
    expect(r.streakCreditedTo).toBe("2026-04-15");
  });

  it("3:01AM IST → credits current day", () => {
    const r = computeStreak({
      state: baseState,
      measuredAtIso: "2026-04-15T21:31:00.000Z",
      userTimezoneOffsetMinutes: IST_OFFSET,
      recentLogTimestampsLast7d: [],
      recentValuesSameType: [],
    });
    expect(r.streakCreditedTo).toBe("2026-04-16");
  });
});

describe("streak first log", () => {
  it("first log → streak = 1, milestone null (3 not reached)", () => {
    const r = computeStreak({
      state: baseState,
      measuredAtIso: "2026-04-15T05:00:00.000Z",
      userTimezoneOffsetMinutes: IST_OFFSET,
      recentLogTimestampsLast7d: [],
      recentValuesSameType: [],
    });
    expect(r.nextState.currentStreakDays).toBe(1);
    expect(r.milestoneReached).toBeNull();
  });
});

describe("streak milestones", () => {
  it("reaching 7 → milestone fires once", () => {
    const r = computeStreak({
      state: { ...baseState, currentStreakDays: 6, lastLogDate: "2026-04-14", totalLogDays: 6 },
      measuredAtIso: "2026-04-15T05:00:00.000Z",
      userTimezoneOffsetMinutes: IST_OFFSET,
      recentLogTimestampsLast7d: [],
      recentValuesSameType: [],
    });
    expect(r.nextState.currentStreakDays).toBe(7);
    expect(r.milestoneReached).toBe(7);
  });
});

describe("streak anti-cheat", () => {
  it("same value 3 consecutive → flagged", () => {
    const r = computeStreak({
      state: baseState,
      measuredAtIso: "2026-04-15T05:00:00.000Z",
      userTimezoneOffsetMinutes: IST_OFFSET,
      recentLogTimestampsLast7d: [],
      recentValuesSameType: [120, 120, 120],
    });
    expect(r.antiCheatFlags).toContain("same_value_3_consecutive");
  });
});

describe("streak double-logging same day", () => {
  it("two logs same streak_day → currentStreakDays unchanged", () => {
    const r = computeStreak({
      state: { ...baseState, currentStreakDays: 5, lastLogDate: "2026-04-15", totalLogDays: 5 },
      measuredAtIso: "2026-04-15T08:00:00.000Z",
      userTimezoneOffsetMinutes: IST_OFFSET,
      recentLogTimestampsLast7d: [],
      recentValuesSameType: [],
    });
    expect(r.nextState.currentStreakDays).toBe(5);
  });
});
