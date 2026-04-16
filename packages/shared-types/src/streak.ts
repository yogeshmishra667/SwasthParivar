export interface UserStreak {
  userId: string;
  currentStreakDays: number;
  longestStreakDays: number;
  lastLogDate: string | null;
  streakStartedAt: string | null;
  totalLogDays: number;
  brokenStreakLength: number;
  graceUsedThisWeek: number;
  milestonesReached: number[];
}

export const STREAK_MILESTONES = [3, 7, 14, 30, 50, 100] as const;
export type StreakMilestone = (typeof STREAK_MILESTONES)[number];

export const STREAK_DAY_BOUNDARY_HOUR = 3;
export const STREAK_GRACE_HOURS = 6;
export const MAX_GRACE_PER_WEEK = 3;
