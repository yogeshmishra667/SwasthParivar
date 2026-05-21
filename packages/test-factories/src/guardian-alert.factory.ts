import { faker } from "@faker-js/faker";

// Test factory for `GuardianAlert` (Phase 3 Feature C). Mirrors the
// Prisma model minus DB-managed defaults; the shape is declared locally
// so this package keeps zero @prisma/client coupling. Default is an
// orange med-adherence alert — the most common Phase 3 case.

export interface GuardianAlertFactoryShape {
  id: string;
  patientId: string;
  guardianId: string;
  alertType: "trend_concern" | "med_adherence" | "combined";
  riskScore: number;
  severity: "yellow" | "orange";
  title: string;
  summary: string;
  details: Record<string, unknown>;
  explanation: string;
  suggestedAction: string;
  signalIds: string[];
  sentVia: ("push" | "sms" | "in_app")[];
  pushDelivered: boolean;
  smsDelivered: boolean;
  readAt: Date | null;
  actionTaken: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const makeGuardianAlert = (
  overrides: Partial<GuardianAlertFactoryShape> = {},
): GuardianAlertFactoryShape => ({
  id: faker.string.uuid(),
  patientId: faker.string.uuid(),
  guardianId: faker.string.uuid(),
  alertType: "med_adherence",
  riskScore: 65,
  severity: "orange",
  title: "Dawai chhoot rahi hai",
  summary: "Ramesh ji ne pichhle hafte 3 baar dawai nahi li.",
  details: {},
  explanation: "Pichhle 7 dino mein Ramesh ji ne dawai 3 baar skip ki.",
  suggestedAction: "Phone karke baat karein. Dawai ka time yaad dilaayein.",
  signalIds: [],
  sentVia: [],
  pushDelivered: false,
  smsDelivered: false,
  readAt: null,
  actionTaken: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

// Convenience builder for a yellow (summary-only, never pushed) alert.
export const makeYellowGuardianAlert = (
  overrides: Partial<GuardianAlertFactoryShape> = {},
): GuardianAlertFactoryShape =>
  makeGuardianAlert({
    alertType: "trend_concern",
    severity: "yellow",
    riskScore: 45,
    title: "Sugar badh raha hai",
    summary: "Ramesh ji ki khaali-pet sugar dheere-dheere badh rahi hai.",
    explanation: "Khaali-pet reading roz lagbhag 3 mg/dL badh rahi hai.",
    suggestedAction: "Phone karke haal poochein.",
    ...overrides,
  });
