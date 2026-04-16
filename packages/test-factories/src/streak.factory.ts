import { faker } from "@faker-js/faker";
import type { UserStreak } from "@swasth/shared-types";

export const makeStreak = (overrides: Partial<UserStreak> = {}): UserStreak => ({
  userId: faker.string.uuid(),
  currentStreakDays: 0,
  longestStreakDays: 0,
  lastLogDate: null,
  streakStartedAt: null,
  totalLogDays: 0,
  brokenStreakLength: 0,
  graceUsedThisWeek: 0,
  milestonesReached: [],
  ...overrides,
});
