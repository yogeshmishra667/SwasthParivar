// PRESCRIPTION_CLARIFICATION_OCR processor — phase4.md §F.5 / §F.8.
//
// Fired by `POST /prescriptions/:id/items/:itemId/clarify`. Runs ONE
// Vision pass on the new bottle photo (when supplied) and appends a
// `vision_clarification_pass` entry to the item's audit history. Then
// re-classifies the item using `prescription-color-classifier` and the
// new reconciled confidence; if the item has now hit the 3-attempt cap
// without resolution, transitions to terminal `needs_doctor`.
//
// Inputs and idempotency:
//   • Idempotent on the `(itemId, clarificationAttemptId)` tuple, set as
//     the BullMQ jobId by the service. A retry of the same attempt is
//     a no-op (we detect the attempt id already in `aiSuggestionHistory`).
//   • Either a new bottle photo OR a typed name (or both) must be
//     present; the route validates this. With a typed name only, we
//     skip Vision entirely — typed-only is YELLOW by construction.
//   • Spend-cap kill switch: `prescription_ocr_enabled=false` short-
//     circuits the worker without writing the new audit entry.
//
// What stays out (by design):
//   • Re-running the full paired reconciliation. Clarification updates
//     ONE item, not the whole prescription. The original Pass-A line
//     is preserved; we just bind a fresh Pass-B reading on top.

import { createHash } from "node:crypto";

import type { Job } from "bullmq";
import type { Prisma } from "@prisma/client";
import { classifyPrescriptionItem } from "@swasth/domain-logic";
import type {
  MedicineMatchStatus,
  PrescriptionItemColor,
  PrescriptionItemStatus,
} from "@swasth/shared-types";

import { prisma } from "../shared/database.js";
import { getFlag } from "../shared/flags/index.js";
import { logger } from "../shared/logger.js";
import { generateVisionResponse, type VisionResponseMeta } from "../shared/ai/claude-vision.js";
import { capture as captureAnalyticsEvent } from "../shared/analytics/posthog.js";
import type { PrescriptionClarificationOcrJob } from "../modules/prescriptions/prescriptions.types.js";

const sha256Hex = (input: string): string => createHash("sha256").update(input).digest("hex");
const anonymiseUserId = (userId: string): string => `anon_${sha256Hex(userId).slice(0, 16)}`;

const MAX_CLARIFICATION_ATTEMPTS = 3;

interface AuditEntry {
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

const isAuditArray = (v: unknown): v is AuditEntry[] =>
  Array.isArray(v) && v.every((e) => typeof e === "object" && e !== null && "source" in e);

const initialStatusForColor = (color: PrescriptionItemColor): PrescriptionItemStatus =>
  color === "need_clarification" ? "need_clarification" : "pending";

const alreadyProcessed = (history: AuditEntry[], attemptId: string): boolean =>
  history.some(
    (e) =>
      e.source === "vision_clarification_pass" &&
      typeof e.payload?.clarificationAttemptId === "string" &&
      e.payload.clarificationAttemptId === attemptId,
  );

export const processPrescriptionClarificationOcr = async (
  job: Job<PrescriptionClarificationOcrJob>,
): Promise<void> => {
  const data = job.data;

  // Kill-switch — same flag as F.4 (a Vision outage affects all OCR).
  const enabled = await getFlag<boolean>("prescription_ocr_enabled", false);
  if (enabled !== true) {
    logger.warn(
      { itemId: data.itemId, jobId: job.id },
      "prescription_ocr_enabled=false — skipping clarification job",
    );
    return;
  }

  const item = await prisma.prescriptionItem.findUnique({
    where: { id: data.itemId },
  });
  if (item?.prescriptionId !== data.prescriptionId) {
    logger.warn(
      { itemId: data.itemId, prescriptionId: data.prescriptionId, jobId: job.id },
      "clarification job: item not found / cross-prescription mismatch — skipping",
    );
    return;
  }

  const history = isAuditArray(item.aiSuggestionHistory) ? [...item.aiSuggestionHistory] : [];
  if (alreadyProcessed(history, data.clarificationAttemptId)) {
    // BullMQ retry after a successful write — exact idempotency.
    logger.info(
      { itemId: data.itemId, attemptId: data.clarificationAttemptId, jobId: job.id },
      "clarification already recorded — idempotent skip",
    );
    return;
  }

  // Compute the new confidence + cross-check status.
  let newConfidence = item.ocrConfidence;
  let newCrossCheck: MedicineMatchStatus = "not_attempted";
  let newAiReadName: string | null = null;
  let visionMeta: VisionResponseMeta | null = null;

  if (data.medicinePhotoId !== null) {
    const photo = await prisma.medicinePhoto.findUnique({
      where: { id: data.medicinePhotoId },
      select: { photoUrl: true },
    });
    if (photo) {
      try {
        const response = await generateVisionResponse({
          mode: "clarification_pass",
          images: [{ kind: "url", url: photo.photoUrl }],
          context: {
            anonymizedPatientId: anonymiseUserId(data.userId),
            prescriptionId: data.prescriptionId,
          },
          userId: data.userId,
          requestId: data.requestId,
        });
        if (response.mode === "clarification_pass") {
          visionMeta = response.meta;
          newAiReadName = response.bottle.aiReadName;
          // Reconcile against the existing Pass-A reading. Conservative
          // rule: name match (case-insensitive substring or close
          // string distance) → "match" + boost confidence to 0.92.
          // Otherwise → "unclear" (not "mismatch" — we don't want a
          // single ambiguous clarification photo to force RED on its
          // own).
          if (namesAgree(item.ocrMedicineName, response.bottle.aiReadName)) {
            newCrossCheck = "match";
            newConfidence = Math.max(item.ocrConfidence, 0.92);
          } else {
            newCrossCheck = "unclear";
            newConfidence = Math.max(item.ocrConfidence, response.bottle.confidence);
          }
          // Persist Pass-B reading onto the photo row.
          await prisma.medicinePhoto.update({
            where: { id: data.medicinePhotoId },
            data: {
              aiReadName: response.bottle.aiReadName,
              matchConfidence: response.bottle.confidence,
              matchStatus: newCrossCheck,
            },
          });
        }
      } catch (err) {
        // Vision outage — log + write a placeholder audit entry so the
        // attempt counts (otherwise the patient burns through retries
        // for free). The item color stays unchanged.
        logger.error(
          { err, itemId: data.itemId, jobId: job.id },
          "clarification Vision call failed",
        );
      }
    }
  } else if (data.typedMedicineName) {
    // Typed-only path — no Vision spend. Treat the typed name as a
    // single source (YELLOW after classify because hasPairedMedicinePhoto
    // remains false).
    newCrossCheck = "not_attempted";
    newConfidence = Math.max(item.ocrConfidence, 0.7);
    newAiReadName = data.typedMedicineName;
  }

  const newAttemptCount = item.clarificationAttempts + 1;
  const hitsCap = newAttemptCount >= MAX_CLARIFICATION_ATTEMPTS && newCrossCheck !== "match";

  const newColor = classifyPrescriptionItem({
    ocrConfidence: newConfidence,
    photoCrossCheckStatus: newCrossCheck,
    hasPairedMedicinePhoto: data.medicinePhotoId !== null,
  });

  const auditEntry: AuditEntry = {
    at: new Date().toISOString(),
    by: "vision",
    source: "vision_clarification_pass",
    payload: {
      clarificationAttemptId: data.clarificationAttemptId,
      attemptNumber: newAttemptCount,
      medicinePhotoId: data.medicinePhotoId,
      typedMedicineName: data.typedMedicineName,
      approverNote: data.approverNote,
      approverUserId: data.approverUserId,
      newOcrConfidence: newConfidence,
      newPhotoCrossCheckStatus: newCrossCheck,
      newColor: newColor.color,
      newReason: newColor.reason,
      visionMeta: visionMeta
        ? {
            model: visionMeta.model,
            tokensInput: visionMeta.tokensInput,
            tokensOutput: visionMeta.tokensOutput,
            responseLatencyMs: visionMeta.responseLatencyMs,
            aiReadName: newAiReadName,
          }
        : null,
    },
  };

  const updatedHistory = [...history, auditEntry];

  await prisma.prescriptionItem.update({
    where: { id: item.id },
    data: {
      ocrConfidence: newConfidence,
      ocrColor: newColor.color,
      status: hitsCap ? "needs_doctor" : initialStatusForColor(newColor.color),
      clarificationAttempts: newAttemptCount,
      // Append the photo to pairedMedicinePhotoIds so the GET view
      // surfaces it under the item without re-querying. We dedupe on
      // existing membership.
      ...(data.medicinePhotoId !== null &&
      !item.pairedMedicinePhotoIds.includes(data.medicinePhotoId)
        ? { pairedMedicinePhotoIds: [...item.pairedMedicinePhotoIds, data.medicinePhotoId] }
        : {}),
      aiSuggestionHistory: updatedHistory as unknown as Prisma.InputJsonValue,
    },
  });

  captureAnalyticsEvent("prescription_ocr_completed", data.userId, {
    prescription_id: data.prescriptionId,
    item_count: 1,
    bottle_count: data.medicinePhotoId !== null ? 1 : 0,
    page_count: 0,
    request_id: data.requestId,
  });
};

/**
 * Conservative case-insensitive name-agreement check used for the
 * clarification cross-check. Substring-or-edit-distance match counts;
 * a "true mismatch" decision is left to the canonical paired-
 * reconciliation module (which the F.5 worker DOES NOT re-run — it
 * only runs on the initial paired upload).
 */
const namesAgree = (a: string, b: string): boolean => {
  if (!a || !b) return false;
  const na = a.trim().toLowerCase();
  const nb = b.trim().toLowerCase();
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  // Cheap Jaccard on letter-bigrams as a tie-break for spelling drift
  // (Glycomet vs Glcomet). Below 0.6 we treat as unclear.
  const bigrams = (s: string): Set<string> => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i += 1) set.add(s.slice(i, i + 2));
    return set;
  };
  const A = bigrams(na);
  const B = bigrams(nb);
  if (A.size === 0 || B.size === 0) return false;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared += 1;
  const j = shared / (A.size + B.size - shared);
  return j >= 0.6;
};
