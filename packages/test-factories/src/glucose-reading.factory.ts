import { faker } from "@faker-js/faker";
import type { GlucoseReading, GlucoseReadingType } from "@swasth/shared-types";

export const makeReading = (overrides: Partial<GlucoseReading> = {}): GlucoseReading => {
  const measuredAt = overrides.measuredAt ?? faker.date.recent({ days: 7 }).toISOString();
  const date = measuredAt.slice(0, 10);
  return {
    id: faker.string.uuid(),
    clientUuid: faker.string.uuid(),
    userId: faker.string.uuid(),
    valueMgDl: faker.number.int({ min: 70, max: 250 }),
    readingType: faker.helpers.arrayElement<GlucoseReadingType>([
      "fasting",
      "post_meal",
      "random",
    ]),
    context: "normal",
    source: "manual",
    measuredAt,
    streakCreditedTo: date,
    version: 1,
    ...overrides,
  };
};
