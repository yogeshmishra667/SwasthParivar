import { faker } from "@faker-js/faker";
import type { NotificationState } from "@swasth/shared-types";

export const makeNotificationState = (
  overrides: Partial<NotificationState> = {},
): NotificationState => ({
  userId: faker.string.uuid(),
  fatigueLevel: 0,
  consecutiveIgnores: 0,
  lastNotificationAt: null,
  bestLogTimeFasting: "07:00",
  bestLogTimePostMeal: "13:30",
  notificationHistory7d: [],
  last3VariantIds: [],
  ...overrides,
});
