import { faker } from "@faker-js/faker";

// Test factory for `SilentGuardianSignal` (Phase 3 Feature C). Mirrors
// the Prisma model minus DB-managed defaults; the shape is declared
// locally so this package keeps zero @prisma/client coupling.

export interface SilentGuardianSignalFactoryShape {
  id: string;
  userId: string;
  signalSource: "med_adherence" | "data_anomaly";
  signalType: string;
  rawEvidence: Record<string, unknown>;
  riskContribution: number;
  decayFactor: number;
  detectedAt: Date;
  consumedByAlert: string | null;
  createdAt: Date;
}

export const makeSilentGuardianSignal = (
  overrides: Partial<SilentGuardianSignalFactoryShape> = {},
): SilentGuardianSignalFactoryShape => ({
  id: faker.string.uuid(),
  userId: faker.string.uuid(),
  signalSource: "med_adherence",
  signalType: "med_missed_frequent",
  rawEvidence: { missedCount: 3, windowDays: 7 },
  riskContribution: 65,
  decayFactor: 1.0,
  detectedAt: new Date(),
  consumedByAlert: null,
  createdAt: new Date(),
  ...overrides,
});

// Convenience builder for a worsening-trend signal.
export const makeTrendSignal = (
  overrides: Partial<SilentGuardianSignalFactoryShape> = {},
): SilentGuardianSignalFactoryShape =>
  makeSilentGuardianSignal({
    signalSource: "data_anomaly",
    signalType: "worsening_trend",
    rawEvidence: { slopePerDay: 4, direction: "increasing", readingType: "fasting" },
    riskContribution: 55,
    ...overrides,
  });
