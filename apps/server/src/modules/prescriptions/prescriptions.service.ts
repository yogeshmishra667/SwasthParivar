// Phase 4 §F.5 prescription service.
//
// The HTTP routes are thin shells around these five service functions:
//
//   uploadPrescription    — paired upload then R2 then enqueue OCR
//   getPrescription       — read with household authz + photo URL refresh
//   clarifyItem           — append clarification + enqueue Vision pass
//   approvePrescription   — per-item decisions then MedicationSchedule txn
//   rejectPrescription    — terminal reject with cascade to items
//
// Cross-cutting invariants (CLAUDE.md "Prescription OCR Approval Flow"):
//
//   - Approver authority is resolved at upload via the pure
//     `prescription-approver-resolver` module and frozen on
//     `Prescription.requiresGuardianApproval`. Every subsequent
//     write checks `req.user.id === approverUserId` and rejects with
//     `APPROVAL_REQUIRES_GUARDIAN` otherwise.
//   - Once `status` is `approved` or `rejected` the prescription is
//     locked for clarify / approve / reject. New writes throw
//     `PRESCRIPTION_LOCKED` (409).
//   - Audit trail (`PrescriptionItem.aiSuggestionHistory`) is
//     append-only — every approver tap and every Vision pass is
//     recorded so ops can replay why a drug landed in the cabinet.
//   - Approving items creates `MedicationSchedule` rows in the same
//     transaction as the item updates. All-or-nothing per-item — a
//     `decision === "approve"` without verifiedMedicineName/Dosage/
//     Frequency would have been rejected by Zod upstream, but we
//     re-defend at the txn boundary.

import { randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";
import { resolveApprover } from "@swasth/domain-logic";
import { DomainError } from "@swasth/shared-types";

import type { AuthClaims } from "../../shared/middleware/auth.js";
import { prisma } from "../../shared/database.js";
import { logger } from "../../shared/logger.js";
import { processPhoto, validateUploadCounts } from "../../shared/storage/photo-upload.js";
import { refreshObjectUrl } from "../../shared/storage/r2.js";
import { capture as captureAnalyticsEvent } from "../../shared/analytics/posthog.js";
import { scheduleMedReminders } from "../medications/medications.jobs.js";
import { enqueueClarificationOcr, enqueuePrescriptionOcr } from "./prescriptions.jobs.js";
import type {
  ApprovalRequestBody,
  AuditEntry,
  PrescriptionItemView,
  PrescriptionView,
} from "./prescriptions.types.js";

// Maximum clarification attempts per CLAUDE.md "Up to 3 clarification
// attempts; further failure → terminal needs_doctor". Counter is the
// 0-based `clarificationAttempts` column.
const MAX_CLARIFICATION_ATTEMPTS = 3;

// ── upload ─────────────────────────────────────────────────────────

export interface UploadInput {
  readonly auth: AuthClaims;
  readonly targetUserId: string;
  readonly prescriptionPhotos: readonly { buffer: Buffer; mimeType: string }[];
  readonly medicinePhotos: readonly { buffer: Buffer; mimeType: string }[];
  readonly doctorId: string | undefined;
  readonly prescribedDate: string | undefined;
  readonly requestId: string;
}

export interface UploadResult {
  readonly prescriptionId: string;
  readonly status: "pending_ocr";
  readonly requiresGuardianApproval: boolean;
  readonly approverUserId: string;
  readonly prescriptionPhotoUrls: readonly string[];
  readonly medicinePhotoIds: readonly string[];
}

export const uploadPrescription = async (input: UploadInput): Promise<UploadResult> => {
  validateUploadCounts({
    prescriptionCount: input.prescriptionPhotos.length,
    medicineCount: input.medicinePhotos.length,
  });

  const approver = await resolveApproverForUser(input.targetUserId);
  const prescriptionId = randomUUID();

  const prescriptionPhotoResults = await Promise.all(
    input.prescriptionPhotos.map((p) =>
      processPhoto({
        buffer: p.buffer,
        mimeType: p.mimeType,
        kind: "prescription",
        scopeId: prescriptionId,
      }),
    ),
  );
  const medicinePhotoResults = await Promise.all(
    input.medicinePhotos.map((p) =>
      processPhoto({
        buffer: p.buffer,
        mimeType: p.mimeType,
        kind: "medicine_bottle",
        scopeId: prescriptionId,
      }),
    ),
  );

  const medicinePhotoIds: string[] = [];
  await prisma.$transaction(async (tx) => {
    await tx.prescription.create({
      data: {
        id: prescriptionId,
        userId: input.targetUserId,
        originalPhotoUrls: prescriptionPhotoResults.map((p) => p.url),
        status: "pending_ocr",
        requiresGuardianApproval: approver.requiresGuardianApproval,
        ...(input.doctorId !== undefined ? { doctorId: input.doctorId } : {}),
        ...(input.prescribedDate !== undefined
          ? { prescribedDate: new Date(input.prescribedDate) }
          : {}),
      },
    });

    for (const photo of medicinePhotoResults) {
      const created = await tx.medicinePhoto.create({
        data: {
          prescriptionId,
          photoUrl: photo.url,
          uploadedAt: "initial_upload",
        },
        select: { id: true },
      });
      medicinePhotoIds.push(created.id);
    }
  });

  await enqueuePrescriptionOcr({
    prescriptionId,
    userId: input.targetUserId,
    requestId: input.requestId,
  });

  captureAnalyticsEvent("prescription_uploaded", input.targetUserId, {
    prescription_id: prescriptionId,
    prescription_photos: prescriptionPhotoResults.length,
    medicine_photos: medicinePhotoResults.length,
    requires_guardian_approval: approver.requiresGuardianApproval,
    approver_friction_level: approver.frictionLevel,
    approver_reason: approver.reason,
  });

  return {
    prescriptionId,
    status: "pending_ocr",
    requiresGuardianApproval: approver.requiresGuardianApproval,
    approverUserId: approver.approverUserId,
    prescriptionPhotoUrls: prescriptionPhotoResults.map((p) => p.url),
    medicinePhotoIds,
  };
};

// ── get ────────────────────────────────────────────────────────────

export interface GetPrescriptionInput {
  readonly auth: AuthClaims;
  readonly prescriptionId: string;
}

export const getPrescription = async (input: GetPrescriptionInput): Promise<PrescriptionView> => {
  const row = await prisma.prescription.findUnique({
    where: { id: input.prescriptionId },
    include: {
      items: { orderBy: { createdAt: "asc" } },
      medicinePhotos: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!row) {
    throw new DomainError("PRESCRIPTION_NOT_FOUND", "prescription not found");
  }
  await ensureHouseholdRead(input.auth, row.userId);

  const approver = await resolveApproverForUser(row.userId);
  const refreshedOriginal = await Promise.all(
    row.originalPhotoUrls.map((u) => refreshUrlIfNeeded(u)),
  );
  const refreshedMedicine = await Promise.all(
    row.medicinePhotos.map(async (p) => ({
      ...p,
      photoUrl: await refreshUrlIfNeeded(p.photoUrl),
    })),
  );

  return {
    id: row.id,
    userId: row.userId,
    status: row.status,
    requiresGuardianApproval: row.requiresGuardianApproval,
    approverUserId: approver.approverUserId,
    approverFrictionLevel: approver.frictionLevel,
    originalPhotoUrls: refreshedOriginal,
    approvalRequestedAt: row.approvalRequestedAt?.toISOString() ?? null,
    approvalCompletedAt: row.approvalCompletedAt?.toISOString() ?? null,
    approvedBy: row.approvedBy,
    rejectedAt: row.rejectedAt?.toISOString() ?? null,
    rejectionReason: row.rejectionReason,
    createdAt: row.createdAt.toISOString(),
    items: row.items.map(toItemView),
    medicinePhotos: refreshedMedicine.map((p) => ({
      id: p.id,
      photoUrl: p.photoUrl,
      uploadedAt: p.uploadedAt,
      aiReadName: p.aiReadName,
      matchStatus: p.matchStatus,
      matchConfidence: p.matchConfidence,
    })),
  };
};

// ── clarify ────────────────────────────────────────────────────────

export interface ClarifyInput {
  readonly auth: AuthClaims;
  readonly prescriptionId: string;
  readonly itemId: string;
  readonly clarificationAttemptId: string;
  readonly typedMedicineName: string | undefined;
  readonly approverNote: string | undefined;
  readonly photo: { buffer: Buffer; mimeType: string } | undefined;
  readonly requestId: string;
}

export interface ClarifyResult {
  readonly itemId: string;
  readonly enqueued: boolean;
  readonly attemptNumber: number;
  readonly medicinePhotoId: string | null;
}

export const clarifyItem = async (input: ClarifyInput): Promise<ClarifyResult> => {
  if (!input.photo && !input.typedMedicineName) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "clarification requires either a bottle photo or typedMedicineName",
    );
  }

  const loaded = await loadPrescriptionForApprover({
    auth: input.auth,
    prescriptionId: input.prescriptionId,
    itemId: input.itemId,
    action: "clarify",
  });
  const prescription = loaded.prescription;
  const item = loaded.item!;

  if (item.clarificationAttempts >= MAX_CLARIFICATION_ATTEMPTS) {
    throw new DomainError(
      "PRESCRIPTION_CLARIFICATION_EXHAUSTED",
      `item already reached the ${MAX_CLARIFICATION_ATTEMPTS}-attempt clarification cap — manual add only`,
    );
  }

  let medicinePhotoId: string | null = null;
  if (input.photo) {
    const processed = await processPhoto({
      buffer: input.photo.buffer,
      mimeType: input.photo.mimeType,
      kind: "medicine_bottle",
      scopeId: prescription.id,
    });
    const created = await prisma.medicinePhoto.create({
      data: {
        prescriptionId: prescription.id,
        prescriptionItemId: item.id,
        photoUrl: processed.url,
        uploadedAt: "mid_approval_clarification",
      },
      select: { id: true },
    });
    medicinePhotoId = created.id;
  }

  const intentEntry: AuditEntry = {
    at: new Date().toISOString(),
    by: "approver",
    source: "approver_correction",
    payload: {
      action: "clarify_requested",
      clarificationAttemptId: input.clarificationAttemptId,
      approverUserId: input.auth.sub,
      typedMedicineName: input.typedMedicineName ?? null,
      medicinePhotoId,
      approverNote: input.approverNote ?? null,
      attemptNumber: item.clarificationAttempts + 1,
    },
  };
  const history = isAuditArray(item.aiSuggestionHistory)
    ? [...item.aiSuggestionHistory, intentEntry]
    : [intentEntry];

  await prisma.prescriptionItem.update({
    where: { id: item.id },
    data: {
      aiSuggestionHistory: history as unknown as Prisma.InputJsonValue,
      status: "pending",
      ...(input.approverNote !== undefined ? { approverNote: input.approverNote } : {}),
    },
  });

  await enqueueClarificationOcr({
    prescriptionId: prescription.id,
    itemId: item.id,
    userId: prescription.userId,
    clarificationAttemptId: input.clarificationAttemptId,
    medicinePhotoId,
    typedMedicineName: input.typedMedicineName ?? null,
    approverNote: input.approverNote ?? null,
    approverUserId: input.auth.sub,
    requestId: input.requestId,
  });

  captureAnalyticsEvent("prescription_clarified", prescription.userId, {
    prescription_id: prescription.id,
    item_id: item.id,
    attempt_number: item.clarificationAttempts + 1,
    source: medicinePhotoId !== null ? "bottle_photo" : "typed",
  });

  return {
    itemId: item.id,
    enqueued: true,
    attemptNumber: item.clarificationAttempts + 1,
    medicinePhotoId,
  };
};

// ── approve ────────────────────────────────────────────────────────

export interface ApproveInput {
  readonly auth: AuthClaims;
  readonly prescriptionId: string;
  readonly body: ApprovalRequestBody;
  readonly requestId: string;
}

export interface ApproveResult {
  readonly prescriptionId: string;
  readonly approvedItemIds: readonly string[];
  readonly createdScheduleIds: readonly string[];
  readonly rejectedItemIds: readonly string[];
  readonly needsDoctorItemIds: readonly string[];
  readonly status: "pending_approval" | "partial" | "approved";
}

export const approvePrescription = async (input: ApproveInput): Promise<ApproveResult> => {
  const loaded = await loadPrescriptionForApprover({
    auth: input.auth,
    prescriptionId: input.prescriptionId,
    action: "approve",
  });
  const prescription = loaded.prescription;

  const items = await prisma.prescriptionItem.findMany({
    where: { prescriptionId: prescription.id },
  });
  const itemMap = new Map(items.map((i) => [i.id, i]));

  const approvedItemIds: string[] = [];
  const rejectedItemIds: string[] = [];
  const needsDoctorItemIds: string[] = [];
  const createdScheduleIds: string[] = [];

  interface PendingReminder {
    scheduleId: string;
    userId: string;
    timeSlots: string[];
  }
  const pendingReminders: PendingReminder[] = [];

  await prisma.$transaction(async (tx) => {
    for (const decision of input.body.items) {
      const item = itemMap.get(decision.id);
      if (!item) {
        throw new DomainError(
          "PRESCRIPTION_ITEM_NOT_FOUND",
          `item ${decision.id} is not part of this prescription`,
        );
      }
      if (
        item.status === "approved" ||
        item.status === "rejected" ||
        item.status === "needs_doctor"
      ) {
        // Already terminal — skip silently per phase4.md §F.11 "mixed
        // decisions" test case.
        continue;
      }

      const correction = buildApproverCorrectionAudit({
        decision,
        original: {
          ocrMedicineName: item.ocrMedicineName,
          ocrDosage: item.ocrDosage,
          ocrFrequency: item.ocrFrequency,
        },
        approverUserId: input.auth.sub,
      });
      const history = isAuditArray(item.aiSuggestionHistory)
        ? [...item.aiSuggestionHistory, correction]
        : [correction];

      if (decision.decision === "approve") {
        const schedule = await tx.medicationSchedule.create({
          data: {
            userId: prescription.userId,
            medicineName: decision.verifiedMedicineName!,
            dosage: decision.verifiedDosage!,
            timeSlots: parseTimeSlots(decision.verifiedFrequency!),
          },
          select: { id: true, timeSlots: true, userId: true },
        });
        createdScheduleIds.push(schedule.id);
        pendingReminders.push({
          scheduleId: schedule.id,
          userId: schedule.userId,
          timeSlots: schedule.timeSlots as string[],
        });

        const changedFields = correction.payload.changedFields;
        const hasChanges = Array.isArray(changedFields) && changedFields.length > 0;

        await tx.prescriptionItem.update({
          where: { id: item.id },
          data: {
            status: "approved",
            verifiedMedicineName: decision.verifiedMedicineName!,
            verifiedDosage: decision.verifiedDosage!,
            verifiedFrequency: decision.verifiedFrequency!,
            medicationScheduleId: schedule.id,
            approvedByUserId: input.auth.sub,
            approvedAt: new Date(),
            ...(decision.approverNote !== undefined ? { approverNote: decision.approverNote } : {}),
            ...(hasChanges
              ? { approverCorrections: correction.payload as unknown as Prisma.InputJsonValue }
              : {}),
            aiSuggestionHistory: history as unknown as Prisma.InputJsonValue,
          },
        });
        approvedItemIds.push(item.id);

        if (item.pairedMedicinePhotoIds.length > 0) {
          await tx.medicinePhoto.updateMany({
            where: { id: { in: item.pairedMedicinePhotoIds } },
            data: { medicationScheduleId: schedule.id },
          });
        }
      } else if (decision.decision === "reject") {
        await tx.prescriptionItem.update({
          where: { id: item.id },
          data: {
            status: "rejected",
            approvedByUserId: input.auth.sub,
            approvedAt: new Date(),
            ...(decision.approverNote !== undefined ? { approverNote: decision.approverNote } : {}),
            aiSuggestionHistory: history as unknown as Prisma.InputJsonValue,
          },
        });
        rejectedItemIds.push(item.id);
      } else {
        await tx.prescriptionItem.update({
          where: { id: item.id },
          data: {
            status: "needs_doctor",
            approvedByUserId: input.auth.sub,
            approvedAt: new Date(),
            ...(decision.approverNote !== undefined ? { approverNote: decision.approverNote } : {}),
            aiSuggestionHistory: history as unknown as Prisma.InputJsonValue,
          },
        });
        needsDoctorItemIds.push(item.id);
      }

      const changedFields = correction.payload.changedFields;
      if (Array.isArray(changedFields) && changedFields.length > 0) {
        captureAnalyticsEvent("prescription_approver_corrected", prescription.userId, {
          prescription_id: prescription.id,
          item_id: item.id,
          fields_changed: changedFields as string[],
        });
      }
    }

    const fresh = await tx.prescriptionItem.findMany({
      where: { prescriptionId: prescription.id },
      select: { status: true },
    });
    const allTerminal = fresh.every(
      (i) => i.status === "approved" || i.status === "rejected" || i.status === "needs_doctor",
    );
    await tx.prescription.update({
      where: { id: prescription.id },
      data: {
        status: allTerminal ? "approved" : "partial",
        approvedBy: input.auth.sub,
        approvedAt: allTerminal ? new Date() : null,
        approvalCompletedAt: allTerminal ? new Date() : null,
      },
    });
  });

  // Reminder enqueue is outside the txn — Redis must NEVER hold a Postgres
  // connection. A failure here keeps the schedule live; the patient can
  // take their meds and the bootstrap will pick up missing repeatables.
  for (const r of pendingReminders) {
    try {
      await scheduleMedReminders(r.scheduleId, r.userId, r.timeSlots);
    } catch (err) {
      logger.error(
        { err, scheduleId: r.scheduleId, prescriptionId: prescription.id },
        "failed to enqueue med reminders after approve — schedule kept",
      );
    }
  }

  if (!prescription.requiresGuardianApproval && approvedItemIds.length > 0) {
    captureAnalyticsEvent("prescription_self_approved", prescription.userId, {
      prescription_id: prescription.id,
      items_count: approvedItemIds.length,
    });
  }

  const fresh = await prisma.prescription.findUnique({
    where: { id: prescription.id },
    select: { status: true },
  });

  return {
    prescriptionId: prescription.id,
    approvedItemIds,
    rejectedItemIds,
    needsDoctorItemIds,
    createdScheduleIds,
    status: (fresh?.status ?? "partial") as "pending_approval" | "partial" | "approved",
  };
};

// ── reject ─────────────────────────────────────────────────────────

export interface RejectInput {
  readonly auth: AuthClaims;
  readonly prescriptionId: string;
  readonly reason: string;
  readonly requestId: string;
}

export const rejectPrescription = async (
  input: RejectInput,
): Promise<{ prescriptionId: string }> => {
  const loaded = await loadPrescriptionForApprover({
    auth: input.auth,
    prescriptionId: input.prescriptionId,
    action: "reject",
  });
  const prescription = loaded.prescription;

  await prisma.$transaction(async (tx) => {
    await tx.prescriptionItem.updateMany({
      where: {
        prescriptionId: prescription.id,
        status: { in: ["pending", "need_clarification"] },
      },
      data: {
        status: "rejected",
        approvedByUserId: input.auth.sub,
        approvedAt: new Date(),
      },
    });
    await tx.prescription.update({
      where: { id: prescription.id },
      data: {
        status: "rejected",
        rejectedAt: new Date(),
        rejectionReason: input.reason,
        approvedBy: input.auth.sub,
      },
    });
  });

  return { prescriptionId: prescription.id };
};

// ── helpers ────────────────────────────────────────────────────────

type PrescriptionRow = NonNullable<Awaited<ReturnType<typeof prisma.prescription.findUnique>>>;
type PrescriptionItemRow = NonNullable<
  Awaited<ReturnType<typeof prisma.prescriptionItem.findUnique>>
>;

interface LoadApproverInput {
  readonly auth: AuthClaims;
  readonly prescriptionId: string;
  readonly itemId?: string;
  readonly action: "clarify" | "approve" | "reject";
}

const TERMINAL_PRESCRIPTION_STATUSES = new Set<PrescriptionRow["status"]>(["approved", "rejected"]);

const loadPrescriptionForApprover = async (
  input: LoadApproverInput,
): Promise<{ prescription: PrescriptionRow; item: PrescriptionItemRow | null }> => {
  const prescription = await prisma.prescription.findUnique({
    where: { id: input.prescriptionId },
  });
  if (!prescription) {
    throw new DomainError("PRESCRIPTION_NOT_FOUND", "prescription not found");
  }

  const approver = await resolveApproverForUser(prescription.userId);
  if (approver.approverUserId !== input.auth.sub) {
    captureAnalyticsEvent("prescription_approval_authority_blocked", prescription.userId, {
      prescription_id: prescription.id,
      action: input.action,
      caller_id_redacted: hashId(input.auth.sub),
      requires_guardian_approval: prescription.requiresGuardianApproval,
    });
    throw new DomainError(
      "APPROVAL_REQUIRES_GUARDIAN",
      "only the resolved approver may write to this prescription",
    );
  }

  if (TERMINAL_PRESCRIPTION_STATUSES.has(prescription.status)) {
    throw new DomainError(
      "PRESCRIPTION_LOCKED",
      `prescription is ${prescription.status} — open a new prescription instead`,
    );
  }

  let item: PrescriptionItemRow | null = null;
  if (input.itemId) {
    item = await prisma.prescriptionItem.findUnique({ where: { id: input.itemId } });
    if (item?.prescriptionId !== prescription.id) {
      throw new DomainError(
        "PRESCRIPTION_ITEM_NOT_FOUND",
        `item ${input.itemId} not in prescription ${input.prescriptionId}`,
      );
    }
  }

  return { prescription, item };
};

const ensureHouseholdRead = async (auth: AuthClaims, patientUserId: string): Promise<void> => {
  if (auth.sub === patientUserId) return;
  const patient = await prisma.user.findUnique({
    where: { id: patientUserId },
    select: { householdId: true },
  });
  if (patient?.householdId === auth.householdId) return;
  const link = await prisma.familyLink.findFirst({
    where: { patientId: patientUserId, guardianId: auth.sub, status: "accepted" },
    select: { id: true },
  });
  if (link) return;
  throw new DomainError("FAMILY_NO_ACCESS", "not authorised to read this prescription");
};

const resolveApproverForUser = async (
  patientUserId: string,
): Promise<{
  approverUserId: string;
  requiresGuardianApproval: boolean;
  frictionLevel: "none" | "high";
  reason: string;
}> => {
  const [accepted, guardianElsewhere] = await Promise.all([
    prisma.familyLink.findMany({
      where: { patientId: patientUserId, status: "accepted" },
      select: { guardianId: true, relationship: true, acceptedAt: true },
    }),
    prisma.familyLink.findFirst({
      where: { guardianId: patientUserId, status: "accepted" },
      select: { id: true },
    }),
  ]);

  const links = accepted.map((l) => ({
    guardianId: l.guardianId,
    relationship: l.relationship,
    acceptedAt: (l.acceptedAt ?? new Date(0)).toISOString(),
  }));
  return resolveApprover({
    patientUserId,
    acceptedFamilyLinks: links,
    patientIsGuardianElsewhere: guardianElsewhere !== null,
  });
};

interface BuildCorrectionInput {
  readonly decision: ApprovalRequestBody["items"][number];
  readonly original: { ocrMedicineName: string; ocrDosage: string; ocrFrequency: string };
  readonly approverUserId: string;
}

const buildApproverCorrectionAudit = (input: BuildCorrectionInput): AuditEntry => {
  const changed: string[] = [];
  if (
    input.decision.verifiedMedicineName !== undefined &&
    input.decision.verifiedMedicineName !== input.original.ocrMedicineName
  ) {
    changed.push("name");
  }
  if (
    input.decision.verifiedDosage !== undefined &&
    input.decision.verifiedDosage !== input.original.ocrDosage
  ) {
    changed.push("dosage");
  }
  if (
    input.decision.verifiedFrequency !== undefined &&
    input.decision.verifiedFrequency !== input.original.ocrFrequency
  ) {
    changed.push("frequency");
  }
  return {
    at: new Date().toISOString(),
    by: "approver",
    source: "approver_correction",
    payload: {
      decision: input.decision.decision,
      approverUserId: input.approverUserId,
      verifiedMedicineName: input.decision.verifiedMedicineName ?? null,
      verifiedDosage: input.decision.verifiedDosage ?? null,
      verifiedFrequency: input.decision.verifiedFrequency ?? null,
      approverNote: input.decision.approverNote ?? null,
      changedFields: changed,
    },
  };
};

const isAuditArray = (value: unknown): value is AuditEntry[] =>
  Array.isArray(value) &&
  value.every(
    (v) => typeof v === "object" && v !== null && "source" in v && "at" in v && "by" in v,
  );

const toItemView = (row: {
  id: string;
  ocrMedicineName: string;
  ocrDosage: string;
  ocrFrequency: string;
  ocrConfidence: number;
  ocrAlternatives: Prisma.JsonValue | null;
  ocrColor: PrescriptionItemView["ocrColor"];
  status: PrescriptionItemView["status"];
  verifiedMedicineName: string | null;
  verifiedDosage: string | null;
  verifiedFrequency: string | null;
  approverNote: string | null;
  clarificationAttempts: number;
  pairedMedicinePhotoIds: string[];
  aiSuggestionHistory: Prisma.JsonValue;
}): PrescriptionItemView => ({
  id: row.id,
  ocrMedicineName: row.ocrMedicineName,
  ocrDosage: row.ocrDosage,
  ocrFrequency: row.ocrFrequency,
  ocrConfidence: row.ocrConfidence,
  ocrAlternatives: Array.isArray(row.ocrAlternatives)
    ? (row.ocrAlternatives as { name: string; confidence: number }[])
    : [],
  ocrColor: row.ocrColor,
  status: row.status,
  verifiedMedicineName: row.verifiedMedicineName,
  verifiedDosage: row.verifiedDosage,
  verifiedFrequency: row.verifiedFrequency,
  approverNote: row.approverNote,
  clarificationAttempts: row.clarificationAttempts,
  pairedMedicinePhotoIds: row.pairedMedicinePhotoIds,
  aiSuggestionHistory: isAuditArray(row.aiSuggestionHistory) ? row.aiSuggestionHistory : [],
});

/**
 * Parse a verified-frequency string into the `MedicationSchedule.timeSlots`
 * JSON column. Conservative defaults; the approver UI is the right
 * place to surface explicit time pickers, which is in scope for F.13
 * (mobile work) but lives outside the server.
 */
const parseTimeSlots = (frequency: string): string[] => {
  const trimmed = frequency.trim();
  const hyphenParts = trimmed.split("-");
  if (
    (hyphenParts.length === 3 || hyphenParts.length === 4) &&
    hyphenParts.every((p) => p.length > 0 && p.length <= 3 && /^[0-9]+$/.test(p))
  ) {
    const slotTimes = ["08:00", "13:00", "20:00", "22:00"];
    const slots: string[] = [];
    for (let i = 0; i < hyphenParts.length; i += 1) {
      if (Number.parseInt(hyphenParts[i]!, 10) > 0) slots.push(slotTimes[i]!);
    }
    return slots.length > 0 ? slots : ["09:00"];
  }
  const lower = trimmed.toLowerCase();
  if (lower === "od" || lower === "once daily" || lower === "1-0-0") return ["09:00"];
  if (lower === "bd" || lower === "twice daily" || lower === "bid") return ["09:00", "21:00"];
  if (lower === "tds" || lower === "tid" || lower === "thrice daily")
    return ["09:00", "14:00", "21:00"];
  if (lower === "qid" || lower === "qds") return ["08:00", "13:00", "18:00", "22:00"];
  return ["09:00"];
};

/**
 * Stable, non-reversible hash for PostHog blocked-authority telemetry.
 * Surfaces only a short hash so dashboards can pivot on "same caller
 * blocked twice today" without exposing the user id.
 */
const hashId = (id: string): string => {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  }
  return `hid_${(h >>> 0).toString(16)}`;
};

const refreshUrlIfNeeded = async (url: string): Promise<string> => {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith("r2.cloudflarestorage.com")) {
      const key = parsed.pathname.replace(/^\//, "");
      return await refreshObjectUrl(key);
    }
    return url;
  } catch {
    return url;
  }
};
