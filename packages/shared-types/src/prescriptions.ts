/**
 * Phase 4 Feature F — Prescription OCR shared types.
 *
 * String unions mirror the Prisma enums in
 * `apps/server/prisma/schema.prisma` so the pure domain-logic modules
 * (`prescription-color-classifier`, `prescription-approver-resolver`)
 * and the mobile UI share one source of truth without importing
 * `@prisma/client`. Same pattern as `RhythmStatus` / `ExerciseTolerance`
 * for cardiac.
 */

/**
 * Per-item color classification, output of
 * `prescription-color-classifier`. Drives mobile UI banners and the
 * approve-button friction level. See phase4.md §F.6.
 */
export type PrescriptionItemColor = "red" | "yellow" | "green" | "need_clarification";

/**
 * Cross-check status between a prescription line (OCR Pass A) and a
 * paired medicine-bottle photo (Pass B). `not_attempted` covers the
 * no-bottle-photo case so GREEN stays unreachable without a bottle
 * photo per phase4.md §F.6.
 */
export type MedicineMatchStatus = "match" | "mismatch" | "unclear" | "not_attempted";

/**
 * Item-level status. `need_clarification` items are PARKED (not
 * silently dropped) until the approver supplies a bottle photo or
 * typed name. `needs_doctor` is terminal — never auto-creates a
 * MedicationSchedule.
 */
export type PrescriptionItemStatus =
  "pending" | "need_clarification" | "approved" | "rejected" | "needs_doctor";

/**
 * Lifecycle of a Prescription row.
 */
export type PrescriptionStatus =
  "pending_ocr" | "pending_approval" | "partial" | "approved" | "rejected";

/**
 * Friction level applied to the Approve button.
 * - `"none"` — standard one-tap (guardian or self-capable adult).
 * - `"high"` — 3-second activation delay + re-confirm modal
 *   (solo elderly patient with no guardian, per CLAUDE.md
 *   "Solo patient (no guardian)").
 */
export type ApproverFrictionLevel = "none" | "high";

/**
 * Confidence-band thresholds for `prescription-color-classifier`.
 * Hardcoded per phase4.md §F.6 — exported so mobile UI ranges (e.g.
 * "60-85% YELLOW" copy) stay aligned with classifier behaviour.
 */
export const PRESCRIPTION_CONFIDENCE_HIGH = 0.85 as const;
export const PRESCRIPTION_CONFIDENCE_LOW = 0.6 as const;
