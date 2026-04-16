import { faker } from "@faker-js/faker";
import type { User } from "@swasth/shared-types";

export const makeUser = (overrides: Partial<User> = {}): User => ({
  id: faker.string.uuid(),
  name: faker.person.firstName(),
  age: faker.number.int({ min: 50, max: 75 }),
  gender: faker.helpers.arrayElement(["male", "female"]),
  preferredLanguage: "hi",
  conditions: ["diabetes"],
  timezone: "Asia/Kolkata",
  householdId: faker.string.uuid(),
  onboardingComplete: true,
  onboardingStep: 5,
  tier: "free",
  ...overrides,
});
