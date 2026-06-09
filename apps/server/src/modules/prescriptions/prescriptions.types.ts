// Prescription module — wire types shared between controller, service,
// and the BullMQ job payloads. Persisted shapes come from `@prisma/client`
// directly; these types are for the HTTP boundary and the per-item
// approver payload.

import type { PrescriptionItemColor, PrescriptionItemStatus } from "@swasth/shared-types";

export interface ApproverItemDecision {
  /** PrescriptionItem.id. */
  readonly id: string;
  readonly decision: "approve" | "reject" | "needs_doctor";
  /** Verified medicine name. Required when `decision === "approve"`. */
  readonly verifiedMedicineName?: string | undefined;
  readonly verifiedDosage?: string | undefined;
  readonly verifiedFrequency?: string | undefined;
  readonly approverNote?: string | undefined;
}

export interface ApprovalRequestBody {
  readonly items: readonly ApproverItemDecision[];
}

/**
 * Audit-history entry shape — append-only on
 * `PrescriptionItem.aiSuggestionHistory`. Mirrors the worker-side
 * declaration in `prescription-ocr.processor.ts` so service writes
 * stay shape-aligned with worker writes.
 */
export interface AuditEntry {
  readonly at: string;
  readonly by: "vision" | "approver";
  readonly source:
    | "vision_pass_a"
    | "vision_pass_b"
    | "vision_clarification_pass"
    | "approver_correction"
    | "approver_added";
  readonly payload: Record<string, unknown>;
}

/**
 * Per-item snapshot returned by `GET /prescriptions/:id`. Trims the
 * Prisma row to the fields the approver mobile UI actually reads.
 */
export interface PrescriptionItemView {
  readonly id: string;
  readonly ocrMedicineName: string;
  readonly ocrDosage: string;
  readonly ocrFrequency: string;
  readonly ocrConfidence: number;
  readonly ocrAlternatives: readonly { name: string; confidence: number }[];
  readonly ocrColor: PrescriptionItemColor;
  readonly status: PrescriptionItemStatus;
  readonly verifiedMedicineName: string | null;
  readonly verifiedDosage: string | null;
  readonly verifiedFrequency: string | null;
  readonly approverNote: string | null;
  readonly clarificationAttempts: number;
  readonly pairedMedicinePhotoIds: readonly string[];
  readonly aiSuggestionHistory: readonly AuditEntry[];
}

export interface PrescriptionView {
  readonly id: string;
  readonly userId: string;
  readonly status: "pending_ocr" | "pending_approval" | "partial" | "approved" | "rejected";
  readonly requiresGuardianApproval: boolean;
  readonly approverUserId: string;
  readonly approverFrictionLevel: "none" | "high";
  readonly originalPhotoUrls: readonly string[];
  readonly approvalRequestedAt: string | null;
  readonly approvalCompletedAt: string | null;
  readonly approvedBy: string | null;
  readonly rejectedAt: string | null;
  readonly rejectionReason: string | null;
  readonly createdAt: string;
  readonly items: readonly PrescriptionItemView[];
  readonly medicinePhotos: readonly {
    readonly id: string;
    readonly photoUrl: string;
    readonly uploadedAt:
      | "initial_upload"
      | "mid_approval_clarification"
      | "post_schedule_routine_check";
    readonly aiReadName: string | null;
    readonly matchStatus: "match" | "mismatch" | "unclear" | "not_attempted";
    readonly matchConfidence: number;
  }[];
}

// ── Job payloads ────────────────────────────────────────────────────

export interface PrescriptionClarificationOcrJob {
  readonly prescriptionId: string;
  readonly itemId: string;
  readonly userId: string;
  /** Client-supplied UUID — idempotency key on the `(itemId, attemptId)` tuple. */
  readonly clarificationAttemptId: string;
  /** New bottle photo to OCR; null when the approver only typed a name. */
  readonly medicinePhotoId: string | null;
  readonly typedMedicineName: string | null;
  readonly approverNote: string | null;
  readonly approverUserId: string;
  readonly requestId: string;
}

export interface MedicinePhotoCrossCheckJob {
  readonly medicinePhotoId: string;
  readonly medicationScheduleId: string;
  readonly userId: string;
  readonly requestId: string;
}
