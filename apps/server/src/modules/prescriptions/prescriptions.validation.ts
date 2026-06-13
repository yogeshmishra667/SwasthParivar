// Zod schemas for Phase 4 §F.5 prescription routes. Multipart-uploaded
// bodies are validated downstream (multer hands us files, not strings),
// so the body schemas here are for the JSON-bodied endpoints only —
// clarify, approve, reject, manual-item-add.

import { z } from "zod";

const uuid = z.string().uuid();

// ── POST /prescriptions/upload — optional non-file fields ──────────
// multer carries the files; these are the JSON-ish flags clients may
// embed alongside (e.g. `prescribedDate` from the doctor, `doctorId`
// from the patient's doctor list). All optional.
export const uploadFormFieldsSchema = z.object({
  doctorId: uuid.optional(),
  prescribedDate: z.string().datetime({ offset: true }).optional(),
});

// ── POST /prescriptions/:id/items/:itemId/clarify ───────────────────
//
// Either the approver uploads a new bottle photo (multipart) OR types a
// medicine name (JSON body), per CLAUDE.md "Up to 3 clarification
// attempts". Both can be supplied — the worker uses the photo as
// authoritative and the typed name as a tiebreaker. `approverNote` is
// always optional free-text.
export const clarifyBodySchema = z
  .object({
    typedMedicineName: z.string().trim().min(1).max(120).optional(),
    approverNote: z.string().trim().max(500).optional(),
    clarificationAttemptId: uuid,
  })
  .refine(
    // Application layer ensures EITHER a photo (file upload) OR a typed
    // name is present. multer file presence is checked in the
    // controller; this Zod schema can't see it.
    () => true,
  );

// ── POST /prescriptions/:id/approve ─────────────────────────────────
const approverItemDecisionSchema = z
  .object({
    id: uuid,
    decision: z.enum(["approve", "reject", "needs_doctor"]),
    verifiedMedicineName: z.string().trim().min(1).max(120).optional(),
    verifiedDosage: z.string().trim().max(80).optional(),
    verifiedFrequency: z.string().trim().max(80).optional(),
    approverNote: z.string().trim().max(500).optional(),
  })
  .refine(
    (v) =>
      v.decision !== "approve" ||
      (v.verifiedMedicineName !== undefined &&
        v.verifiedDosage !== undefined &&
        v.verifiedFrequency !== undefined),
    {
      message: "approve requires verifiedMedicineName, verifiedDosage, verifiedFrequency",
    },
  );

export const approveBodySchema = z.object({
  items: z.array(approverItemDecisionSchema).min(1).max(50),
});

// ── POST /prescriptions/:id/reject ──────────────────────────────────
export const rejectBodySchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

// ── POST /prescriptions/:id/photos (§F.10b.2 append) ────────────────
// multipart, reuses the upload parser's two photo arrays. The only
// non-file field is the client idempotency UUID.
export const appendPhotosFormFieldsSchema = z.object({
  deltaUploadId: uuid,
});

// ── POST /prescriptions/:id/items (§F.10b.3 manual add) ─────────────
// JSON body — the approver types a medicine they know was prescribed
// but the AI never surfaced. Always lands YELLOW (single source).
export const manualItemBodySchema = z.object({
  typedMedicineName: z.string().trim().min(1).max(120),
  typedDosage: z.string().trim().min(1).max(80),
  typedFrequency: z.string().trim().min(1).max(80),
  approverNote: z.string().trim().max(500).optional(),
  addAttemptId: uuid,
});

// ── GET /prescriptions — list (Phase 4 §G dashboard surface) ───────
// Lists a patient's prescriptions, optionally filtered by status. The
// dashboard "pending approval" nudge passes `status=pending_approval`.
// `targetUserId` follows the household pattern (primary on a sub-profile's
// behalf); authz is enforced in the service via `ensureHouseholdRead`.
export const listPrescriptionsQuerySchema = z.object({
  status: z.enum(["pending_ocr", "pending_approval", "partial", "approved", "rejected"]).optional(),
  targetUserId: uuid.optional(),
});

export type ListPrescriptionsQuery = z.infer<typeof listPrescriptionsQuerySchema>;

export type UploadFormFields = z.infer<typeof uploadFormFieldsSchema>;
export type ClarifyBody = z.infer<typeof clarifyBodySchema>;
export type ApproveBody = z.infer<typeof approveBodySchema>;
export type RejectBody = z.infer<typeof rejectBodySchema>;
export type AppendPhotosFormFields = z.infer<typeof appendPhotosFormFieldsSchema>;
export type ManualItemBody = z.infer<typeof manualItemBodySchema>;
