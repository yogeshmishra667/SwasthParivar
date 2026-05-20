import { faker } from "@faker-js/faker";
import type { BPReading } from "@swasth/shared-types";

export const makeBPReading = (overrides: Partial<BPReading> = {}): BPReading => {
  const systolic = overrides.systolic ?? faker.number.int({ min: 100, max: 160 });
  return {
    id: faker.string.uuid(),
    clientUuid: faker.string.uuid(),
    userId: faker.string.uuid(),
    systolic,
    diastolic: overrides.diastolic ?? faker.number.int({ min: 60, max: systolic - 20 }),
    context: "normal",
    source: "manual",
    measuredAt: overrides.measuredAt ?? faker.date.recent({ days: 7 }).toISOString(),
    version: 1,
    ...overrides,
  };
};
