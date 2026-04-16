import type { UserStreak, StreakMilestone } from "@swasth/shared-types";

export interface StreakComputeInput {
  state: UserStreak;
  measuredAtIso: string;
  userTimezoneOffsetMinutes: number;
  recentLogTimestampsLast7d: string[];
  recentValuesSameType: number[];
}

export interface StreakComputeResult {
  nextState: UserStreak;
  streakCreditedTo: string;
  graceUsed: boolean;
  graceLimitReached: boolean;
  milestoneReached: StreakMilestone | null;
  antiCheatFlags: AntiCheatFlag[];
}

export type AntiCheatFlag =
  | "same_value_3_consecutive"
  | "always_round_5_days";
