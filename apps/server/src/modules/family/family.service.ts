// Phase 2 step 7 — family/guardian service.
//
// Endpoints expose four core flows:
//  - patient creates an invite for a guardian (lookup by phone)
//  - guardian responds to a pending invite (accept | decline)
//  - guardian lists their accepted patients (mobile "Patients" tab)
//  - guardian fetches a PII-stripped read-only dashboard for one patient
//  - patient updates privacy on an existing link (or revokes)
//
// All cross-user authorisation flows through this layer; controllers
// never touch FamilyLink directly. Phase 2 deliberately does NOT add
// the alerts endpoint (per CLAUDE.md "Phase 2 — Add: guardian read-only
// view (FamilyLink, no alerts yet)").

import { DomainError } from "@swasth/shared-types";
import type {
  FamilyLink,
  FamilyLinkStatus,
  FamilyAlertSensitivity,
  Condition,
} from "@prisma/client";
import { prisma } from "../../shared/database.js";
import { buildDashboard, type BuildDashboardResult } from "../dashboard/dashboard.service.js";

// ─────────────────────────────────────────────────────────────
// Invite
// ─────────────────────────────────────────────────────────────

export interface CreateInviteInput {
  patientId: string;
  guardianPhone: string;
  relationship?: string | undefined;
  visibleConditions: readonly string[];
  alertEnabled: boolean;
  alertSensitivity: FamilyAlertSensitivity;
}

export interface InviteResult {
  link: FamilyLink;
  // Surface enough of the guardian so the patient UI can confirm
  // ("invited Ramesh — +9198…"). No phone echo (already on the patient
  // device); no full PII beyond name.
  guardian: { id: string; name: string };
}

export const createInvite = async (input: CreateInviteInput): Promise<InviteResult> => {
  const guardian = await prisma.user.findUnique({
    where: { phone: input.guardianPhone },
    select: { id: true, name: true, householdId: true },
  });
  if (!guardian) {
    // Phase 2 requires the guardian to already have an account. SMS
    // invite-to-install is a Phase 3+ feature (needs WhatsApp template
    // approval); for now the mobile UI prompts the patient to ask the
    // guardian to install the app first.
    throw new DomainError(
      "FAMILY_INVITE_INVALID",
      "no user found with that guardian phone — ask them to sign up first",
    );
  }
  if (guardian.id === input.patientId) {
    throw new DomainError("FAMILY_INVITE_INVALID", "cannot invite yourself as guardian");
  }
  // Same-household FamilyLinks are semantically wrong: members of the
  // same household already share data through the household-scoped
  // notification path (`shared/notifications/household-delivery.ts`).
  // A FamilyLink models a remote-guardian relationship, not an
  // intra-household one.
  const patient = await prisma.user.findUnique({
    where: { id: input.patientId },
    select: { householdId: true },
  });
  if (patient?.householdId === guardian.householdId) {
    throw new DomainError("FAMILY_INVITE_INVALID", "guardian must be from a different household");
  }

  // (patient_id, guardian_id) is unique. Re-invite after revoke = reset
  // the existing row to pending; re-invite while pending/accepted = 409.
  const existing = await prisma.familyLink.findUnique({
    where: { patientId_guardianId: { patientId: input.patientId, guardianId: guardian.id } },
  });
  if (existing && (existing.status === "pending" || existing.status === "accepted")) {
    throw new DomainError("FAMILY_LINK_EXISTS", "an active family link already exists");
  }

  const data = {
    relationship: input.relationship ?? null,
    alertEnabled: input.alertEnabled,
    visibleConditions: [...input.visibleConditions],
    alertSensitivity: input.alertSensitivity,
    status: "pending" as const,
    acceptedAt: null,
    revokedAt: null,
  };

  const link = existing
    ? await prisma.familyLink.update({ where: { id: existing.id }, data })
    : await prisma.familyLink.create({
        data: {
          patient: { connect: { id: input.patientId } },
          guardian: { connect: { id: guardian.id } },
          ...data,
        },
      });

  return { link, guardian };
};

// ─────────────────────────────────────────────────────────────
// Respond (guardian)
// ─────────────────────────────────────────────────────────────

export const respondToInvite = async (params: {
  guardianId: string;
  linkId: string;
  decision: "accept" | "decline";
}): Promise<FamilyLink> => {
  const link = await prisma.familyLink.findUnique({ where: { id: params.linkId } });
  if (link?.guardianId !== params.guardianId) {
    throw new DomainError("FAMILY_LINK_NOT_FOUND", "invite not found");
  }
  if (link.status !== "pending") {
    throw new DomainError("FAMILY_INVITE_INVALID", `cannot respond to a ${link.status} invite`);
  }
  return await prisma.familyLink.update({
    where: { id: link.id },
    data:
      params.decision === "accept"
        ? { status: "accepted", acceptedAt: new Date() }
        : { status: "declined" },
  });
};

// ─────────────────────────────────────────────────────────────
// Privacy / revoke (either side)
// ─────────────────────────────────────────────────────────────

export interface UpdatePrivacyInput {
  callerId: string;
  // Household of the caller (from the JWT). The "patient side" of a
  // link is owned by the household, not a single user id — the primary
  // operates the shared device on behalf of every profile in it, so any
  // member of the patient's household counts as the patient side.
  callerHouseholdId: string;
  linkId: string;
  visibleConditions?: readonly string[] | undefined;
  alertEnabled?: boolean | undefined;
  alertSensitivity?: FamilyAlertSensitivity | undefined;
  revoke?: boolean | undefined;
}

export const updatePrivacy = async (input: UpdatePrivacyInput): Promise<FamilyLink> => {
  const link = await prisma.familyLink.findUnique({
    where: { id: input.linkId },
    include: { patient: { select: { householdId: true } } },
  });
  if (!link) throw new DomainError("FAMILY_LINK_NOT_FOUND", "link not found");

  // Patient side = anyone in the patient's household (shared-device
  // model). Guardian side = the guardian account exactly.
  const isPatient = link.patient.householdId === input.callerHouseholdId;
  const isGuardian = link.guardianId === input.callerId;
  if (!isPatient && !isGuardian) {
    throw new DomainError("FAMILY_NO_ACCESS", "you are not part of this link");
  }

  // Either side can revoke. Only the patient can edit visibility /
  // alert config (matches the CLAUDE.md privacy model: patient owns the
  // data, guardian only consumes).
  if (input.revoke === true) {
    return await prisma.familyLink.update({
      where: { id: link.id },
      data: { status: "revoked", revokedAt: new Date() },
    });
  }

  if (!isPatient) {
    throw new DomainError(
      "FAMILY_NO_ACCESS",
      "only the patient can edit visibility / alert preferences",
    );
  }

  return await prisma.familyLink.update({
    where: { id: link.id },
    data: {
      ...(input.visibleConditions !== undefined
        ? { visibleConditions: [...input.visibleConditions] }
        : {}),
      ...(input.alertEnabled !== undefined ? { alertEnabled: input.alertEnabled } : {}),
      ...(input.alertSensitivity !== undefined ? { alertSensitivity: input.alertSensitivity } : {}),
    },
  });
};

// ─────────────────────────────────────────────────────────────
// Listing (guardian — pending invites they have not yet seen)
// ─────────────────────────────────────────────────────────────

export interface PendingInviteSummary {
  linkId: string;
  relationship: string | null;
  createdAt: Date;
  patient: { id: string; name: string };
}

export const listPendingInvitesForGuardian = async (
  guardianId: string,
): Promise<PendingInviteSummary[]> => {
  const rows = await prisma.familyLink.findMany({
    where: { guardianId, status: "pending" },
    orderBy: { createdAt: "desc" },
    include: { patient: { select: { id: true, name: true } } },
  });
  return rows.map((r) => ({
    linkId: r.id,
    relationship: r.relationship,
    createdAt: r.createdAt,
    patient: { id: r.patient.id, name: r.patient.name },
  }));
};

// ─────────────────────────────────────────────────────────────
// Listing (guardian — patients I am connected to)
// ─────────────────────────────────────────────────────────────

export interface PatientLinkSummary {
  linkId: string;
  relationship: string | null;
  status: FamilyLinkStatus;
  acceptedAt: Date | null;
  patient: { id: string; name: string; conditions: readonly Condition[] };
}

export const listPatientsForGuardian = async (params: {
  guardianId: string;
  status: FamilyLinkStatus;
}): Promise<PatientLinkSummary[]> => {
  const rows = await prisma.familyLink.findMany({
    where: { guardianId: params.guardianId, status: params.status },
    orderBy: { createdAt: "desc" },
    include: {
      patient: { select: { id: true, name: true, conditions: true } },
    },
  });
  return rows.map((r) => ({
    linkId: r.id,
    relationship: r.relationship,
    status: r.status,
    acceptedAt: r.acceptedAt,
    patient: {
      id: r.patient.id,
      name: r.patient.name,
      // Hide conditions the patient marked private. visibleConditions
      // empty = show all (default).
      conditions:
        r.visibleConditions.length === 0
          ? r.patient.conditions
          : r.patient.conditions.filter((c) => r.visibleConditions.includes(c)),
    },
  }));
};

// ─────────────────────────────────────────────────────────────
// Read-only patient dashboard (guardian)
// ─────────────────────────────────────────────────────────────

// Strategy: reuse the step-6 patient dashboard (`buildDashboard`) so
// guardian view and patient view stay in lock-step. Apply PII stripping
// on top before returning. CLAUDE.md "PII-stripped dashboard reuse via
// readOnly: true + viewerUserId" is the literal contract.
//
// What we strip:
//  - latestReading.notes              (free-text patient context)
//  - medications.photoUrl             (often holds the patient face)
//  - medications.timeSlots            (private daily routine)
//  - medications.quantityRemaining    (purchase / cost signal)
//  - bpLatest.notes                   (free-text patient context)
//  - patient.phone                    (never crosses; guardian uses
//                                      their own contacts list)
//
// What we keep:
//  - The full step-6 summary card, healthScore, mealsToday categories,
//    today/yesterday glucose roll-up — these are exactly the signals a
//    remote guardian needs to "monitor without nagging".

interface StrippedMedication {
  id: string;
  medicineName: string;
  dosage: string | null;
  isCritical: boolean;
  active: boolean;
}

type StrippedLatestReading = {
  id: string;
  valueMgDl: number;
  readingType: string;
  context: string;
  source: string;
  measuredAt: Date;
} | null;

type StrippedBpLatest = {
  id: string;
  systolic: number;
  diastolic: number;
  pulse: number | null;
  context: string;
  measuredAt: Date;
} | null;

export interface GuardianDashboardView {
  readOnly: true;
  viewerUserId: string;
  patient: { id: string; name: string; conditions: readonly Condition[] };
  summary: BuildDashboardResult["summary"];
  streak: BuildDashboardResult["streak"];
  latestReading: StrippedLatestReading;
  todayReadingCount: number;
  medications: StrippedMedication[];
  bpLatest: StrippedBpLatest;
  mealsToday: BuildDashboardResult["mealsToday"];
  insightsUnacknowledgedCount: number;
  healthScore: BuildDashboardResult["healthScore"];
}

// Narrow what the upstream dashboard returns as `unknown` into the
// minimal shape we know it has (set by `buildDashboard`). The strippers
// below pull primitive fields off plain objects without leaking any
// other keys.

const asRecord = (src: unknown): Record<string, unknown> | null =>
  src && typeof src === "object" ? (src as Record<string, unknown>) : null;

const asString = (v: unknown): string => (typeof v === "string" ? v : "");
const asStringOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const asNumber = (v: unknown): number => (typeof v === "number" ? v : 0);
const asNumberOrNull = (v: unknown): number | null => (typeof v === "number" ? v : null);
const asBool = (v: unknown): boolean => v === true;

export const getPatientDashboardForGuardian = async (params: {
  guardianId: string;
  patientId: string;
}): Promise<GuardianDashboardView> => {
  const link = await prisma.familyLink.findUnique({
    where: {
      patientId_guardianId: { patientId: params.patientId, guardianId: params.guardianId },
    },
    include: {
      patient: { select: { id: true, name: true, conditions: true } },
    },
  });
  if (link?.status !== "accepted") {
    throw new DomainError("FAMILY_NO_ACCESS", "no accepted family link with this patient");
  }

  const dash = await buildDashboard({ userId: params.patientId });

  const latestRec = asRecord(dash.latestReading);
  const latestReading: StrippedLatestReading = latestRec
    ? {
        id: asString(latestRec.id),
        valueMgDl: asNumber(latestRec.valueMgDl),
        readingType: asString(latestRec.readingType),
        context: asString(latestRec.context),
        source: asString(latestRec.source),
        measuredAt: latestRec.measuredAt as Date,
      }
    : null;

  const bpRec = asRecord(dash.bpLatest);
  const bpLatest: StrippedBpLatest = bpRec
    ? {
        id: asString(bpRec.id),
        systolic: asNumber(bpRec.systolic),
        diastolic: asNumber(bpRec.diastolic),
        pulse: asNumberOrNull(bpRec.pulse),
        context: asString(bpRec.context),
        measuredAt: bpRec.measuredAt as Date,
      }
    : null;

  const medications: StrippedMedication[] = dash.medications.map((m) => {
    const r = asRecord(m) ?? {};
    return {
      id: asString(r.id),
      medicineName: asString(r.medicineName),
      dosage: asStringOrNull(r.dosage),
      isCritical: asBool(r.isCritical),
      active: asBool(r.active),
    };
  });

  return {
    readOnly: true,
    viewerUserId: params.guardianId,
    patient: {
      id: link.patient.id,
      name: link.patient.name,
      conditions:
        link.visibleConditions.length === 0
          ? link.patient.conditions
          : link.patient.conditions.filter((c) => link.visibleConditions.includes(c)),
    },
    summary: dash.summary,
    streak: dash.streak,
    latestReading,
    todayReadingCount: dash.todayReadingCount,
    medications,
    bpLatest,
    mealsToday: dash.mealsToday,
    insightsUnacknowledgedCount: dash.insightsUnacknowledgedCount,
    healthScore: dash.healthScore,
  };
};
