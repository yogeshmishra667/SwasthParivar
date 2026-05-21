// Phase 3 Feature C — Silent Guardian service (C-2 slice: read/write
// over GuardianAlert rows).
//
// All cross-user authorisation flows through this layer. A guardian
// only ever sees alerts whose `guardianId` is their own; reading a
// specific patient's data additionally requires a live ACCEPTED family
// link — the same rule family.service applies to the patient dashboard.
//
// Signal compute and alert dispatch are NOT here — they arrive in the
// next slices behind their own flags.

import { DomainError } from "@swasth/shared-types";
import type { CursorPage } from "@swasth/shared-types";
import type { Prisma, GuardianAlert } from "@prisma/client";
import { prisma } from "../../shared/database.js";
import type {
  DailySummaryParams,
  DailySummaryView,
  ListAlertsParams,
  MarkAlertReadParams,
  RecordFeedbackParams,
} from "./silent-guardian.types.js";

const DAY_MS = 86_400_000;

// A guardian may only read a specific patient's data through an
// ACCEPTED family link. Returns the link (with patient name) so callers
// that need patient identity don't issue a second query.
const requireAcceptedLink = async (guardianId: string, patientId: string) => {
  const link = await prisma.familyLink.findUnique({
    where: { patientId_guardianId: { patientId, guardianId } },
    include: { patient: { select: { id: true, name: true } } },
  });
  if (link?.status !== "accepted") {
    throw new DomainError("FAMILY_NO_ACCESS", "no accepted family link with this patient");
  }
  return link;
};

// Ownership-checked fetch — never let guardian A touch guardian B's
// alert. A missing row and a wrong-guardian row are indistinguishable
// to the caller on purpose (no alert-existence oracle).
const requireOwnedAlert = async (guardianId: string, alertId: string): Promise<GuardianAlert> => {
  const alert = await prisma.guardianAlert.findUnique({ where: { id: alertId } });
  if (alert?.guardianId !== guardianId) {
    throw new DomainError("GUARDIAN_ALERT_NOT_FOUND", "alert not found");
  }
  return alert;
};

export const listAlertsForGuardian = async (
  params: ListAlertsParams,
): Promise<CursorPage<GuardianAlert>> => {
  // Scoping the list to one patient requires a live accepted link.
  if (params.patientId !== undefined) {
    await requireAcceptedLink(params.guardianId, params.patientId);
  }

  const findArgs: Prisma.GuardianAlertFindManyArgs = {
    where: {
      guardianId: params.guardianId,
      ...(params.patientId !== undefined ? { patientId: params.patientId } : {}),
      ...(params.type !== undefined ? { alertType: params.type } : {}),
    },
    // createdAt is the human-meaningful order; id breaks ties so
    // pagination is stable when two alerts share a timestamp.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: params.limit + 1,
  };
  if (params.cursor !== undefined) {
    findArgs.cursor = { id: params.cursor };
    findArgs.skip = 1;
  }

  const rows = await prisma.guardianAlert.findMany(findArgs);

  const hasMore = rows.length > params.limit;
  const data = hasMore ? rows.slice(0, params.limit) : rows;
  const last = data[data.length - 1];
  const cursor = hasMore && last ? last.id : null;
  return { data, cursor, hasMore };
};

export const markAlertRead = async (params: MarkAlertReadParams): Promise<GuardianAlert> => {
  const alert = await requireOwnedAlert(params.guardianId, params.alertId);
  // Idempotent — first read wins; a re-read keeps the original time so
  // `minutes_to_read` analytics stay accurate.
  if (alert.readAt !== null) return alert;
  return await prisma.guardianAlert.update({
    where: { id: alert.id },
    data: { readAt: new Date() },
  });
};

export const recordAlertFeedback = async (params: RecordFeedbackParams): Promise<GuardianAlert> => {
  const alert = await requireOwnedAlert(params.guardianId, params.alertId);
  // `actionTaken` is what the guardian did; when they only tap the
  // helpful / not-helpful control, record that as the action.
  const actionTaken = params.actionTaken ?? (params.helpful ? "helpful" : "ignored");
  return await prisma.guardianAlert.update({
    where: { id: alert.id },
    data: { actionTaken },
  });
};

export const getDailySummaryForPatient = async (
  params: DailySummaryParams,
): Promise<DailySummaryView> => {
  const link = await requireAcceptedLink(params.guardianId, params.patientId);

  const since = new Date(Date.now() - DAY_MS);
  const yellowAlerts = await prisma.guardianAlert.findMany({
    where: {
      guardianId: params.guardianId,
      patientId: params.patientId,
      severity: "yellow",
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
  });

  return {
    patient: { id: link.patient.id, name: link.patient.name },
    yellowAlerts,
    generatedAt: new Date().toISOString(),
  };
};
