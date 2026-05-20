import { faker } from "@faker-js/faker";
import type { MealLog, MealCategory, MealType } from "@swasth/shared-types";

export const makeMealLog = (overrides: Partial<MealLog> = {}): MealLog => ({
  id: faker.string.uuid(),
  clientUuid: faker.string.uuid(),
  userId: faker.string.uuid(),
  mealType: faker.helpers.arrayElement<MealType>(["breakfast", "lunch", "dinner", "snack"]),
  mealCategory: faker.helpers.arrayElement<MealCategory>(["light", "normal", "heavy_fried"]),
  loggedAt: overrides.loggedAt ?? faker.date.recent({ days: 7 }).toISOString(),
  version: 1,
  ...overrides,
});
