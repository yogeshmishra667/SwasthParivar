// PRESCRIPTION_OCR_DELTA processor — phase4.md §F.6 / §F.10b.2.
//
// Fired by `POST /prescriptions/:id/photos` (the guardian "add what the
// patient missed" append flow). Unlike the initial PRESCRIPTION_OCR
// worker, this NEVER re-OCRs the whole prescription — it Vision-runs
// ONLY the newly-appended photos and reconciles them against the items
// already on the prescription via the pure `reconcileDelta`:
//
//   • New prescription pages → new `PrescriptionItem` rows for drugs the
//     page introduces (duplicates of existing items are dropped).
//   • New bottle photos → may CREATE a match for a new item AND/OR
//     PROMOTE an existing single-source (YELLOW) item to GREEN.
//
// Idempotency: jobId = `ocr-delta-${prescriptionId}-${deltaUploadId}`
// (BullMQ dedupe) AND a guard on `Prescription.ocrRawResult.appliedDeltas`
// — the deltaUploadId is recorded inside the same transaction that
// creates the items, so a retry after a successful apply is a no-op and
// never double-creates rows or double-charges Vision spend.
//
// Spend cap: shares the `prescription_ocr_enabled` flag with the initial
// OCR worker. A mid-day spend-cap flip leaves the append un-applied; ops
// can flip the flag back on and re-enqueue.

import { createHash } from "node:crypto";

import type { Job } from "bullmq";
import { Prisma } from "@prisma/client";
import {
  canonicaliseMedicineName,
  classifyPrescriptionItem,
  reconcileDelta,
  type ExistingItemRef,
  type PassACandidate,
  type PassBCandidate,
} from "@swasth/domain-logic";

import { prisma } from "../shared/database.js";
import { getFlag } from "../shared/flags/index.js";
import { logger } from "../shared/logger.js";
import {
  generateVisionResponse,
  type PrescriptionLineCandidate,
} from "../shared/ai/claude-vision.js";
import { capture as captureAnalyticsEvent } from "../shared/analytics/posthog.js";
import type { PrescriptionOcrDeltaJob } from "../modules/prescriptions/prescriptions.types.js";

const sha256Hex = (input: string): string => createHash("sha256").update(input).digest("hex");
const anonymiseUserId = (userId: string): string => `anon_${sha256Hex(userId).slice(0, 16)}`;

interface AuditEntry {
  readonly at: string;
  readonly by: "vision";
  readonly source: "vision_pass_a" | "vision_pass_b";
  readonly payload: Record<string, unknown>;
}

/** Append-only `Prescription.ocrRawResult.appliedDeltas` accessor. */
const appliedDeltasOf = (raw: Prisma.JsonValue): string[] => {
  if (
    typeof raw === "object" &&
    raw !== null &&
    !Array.isArray(raw) &&
    Array.isArray((raw as Record<string, unknown>).appliedDeltas)
  ) {
    return ((raw as Record<string, unknown>).appliedDeltas as unknown[]).filter(
      (x): x is string => typeof x === "string",
    );
  }
  return [];
};

export const processPrescriptionOcrDelta = async (
  job: Job<PrescriptionOcrDeltaJob>,
): Promise<void> => {
  const { prescriptionId, userId, deltaUploadId, newPrescriptionPhotoUrls, newMedicinePhotoIds } =
    job.data;
  const requestId = job.data.requestId;

  const enabled = await getFlag<boolean>("prescription_ocr_enabled", false);
  if (enabled !== true) {
    logger.warn(
      { prescriptionId, deltaUploadId, jobId: job.id },
      "prescription_ocr_enabled=false — skipping OCR delta job",
    );
    return;
  }

  const prescription = await prisma.prescription.findUnique({
    where: { id: prescriptionId },
    include: { items: { orderBy: { createdAt: "asc" } } },
  });
  if (!prescription) {
    logger.warn({ prescriptionId, jobId: job.id }, "prescription not found — skipping delta");
    return;
  }
  if (prescription.userId !== userId) {
    logger.error(
      { prescriptionId, jobUserId: userId, rowUserId: prescription.userId, jobId: job.id },
      "prescription userId mismatch — refusing to process delta",
    );
    return;
  }
  // Pre-Vision idempotency guard so a retry after success never re-charges
  // Vision. Re-checked inside the txn for race safety.
  if (appliedDeltasOf(prescription.ocrRawResult).includes(deltaUploadId)) {
    logger.info(
      { prescriptionId, deltaUploadId, jobId: job.id },
      "delta already applied — idempotent skip",
    );
    return;
  }

  const visionContext = { anonymizedPatientId: anonymiseUserId(userId), prescriptionId };

  // ── Pass A on the NEW prescription pages only ─────────────────────
  const newPassA: PassACandidate[] = [];
  const lineMap = new Map<string, PrescriptionLineCandidate>();
  for (let i = 0; i < newPrescriptionPhotoUrls.length; i += 1) {
    const url = newPrescriptionPhotoUrls[i]!;
    const response = await generateVisionResponse({
      mode: "prescription_text",
      images: [{ kind: "url", url }],
      context: visionContext,
      userId,
      requestId,
    });
    if (response.mode !== "prescription_text") continue;
    response.lines.forEach((line, rowIndex) => {
      const id = `delta:${deltaUploadId}:${i}:${rowIndex}`;
      newPassA.push({ id, aiReadName: line.name, confidence: line.confidence });
      lineMap.set(id, line);
    });
  }

  // ── Pass B on the NEW bottle photos only ──────────────────────────
  const newBottlePhotos = await prisma.medicinePhoto.findMany({
    where: { id: { in: [...newMedicinePhotoIds] }, prescriptionId },
    select: { id: true, photoUrl: true },
  });
  const newPassB: PassBCandidate[] = [];
  const bottleReads = new Map<string, { aiReadName: string; confidence: number }>();
  for (const bottle of newBottlePhotos) {
    const response = await generateVisionResponse({
      mode: "medicine_bottle",
      images: [{ kind: "url", url: bottle.photoUrl }],
      context: visionContext,
      userId,
      requestId,
    });
    if (response.mode !== "medicine_bottle") continue;
    newPassB.push({
      medicinePhotoId: bottle.id,
      aiReadName: response.bottle.aiReadName,
      confidence: response.bottle.confidence,
    });
    bottleReads.set(bottle.id, {
      aiReadName: response.bottle.aiReadName,
      confidence: response.bottle.confidence,
    });
  }

  // ── Pure delta reconciliation ─────────────────────────────────────
  const existingRefs: ExistingItemRef[] = prescription.items.map((it) => ({
    id: it.id,
    aiReadName: it.verifiedMedicineName ?? it.ocrMedicineName,
    hasPairedMedicinePhoto: it.pairedMedicinePhotoIds.length > 0,
  }));
  const { newItems, promotions } = reconcileDelta({
    existingItems: existingRefs,
    newPassA,
    newPassB,
  });

  const nowIso = new Date().toISOString();
  const hasPairedThisDelta = newPassB.length > 0;
  const matchedBottleIds = new Set(
    newItems
      .map((n) => n.matchedMedicinePhotoId)
      .filter((id): id is string => id !== null)
      .concat(promotions.map((p) => p.matchedMedicinePhotoId)),
  );

  // ── Persist atomically ────────────────────────────────────────────
  // New items parked in `need_clarification` by this delta — emitted to
  // PostHog post-commit (phase4.md §F.12), same as the initial OCR job.
  const needClarificationItems: { itemId: string; reason: string }[] = [];

  await prisma.$transaction(async (tx) => {
    // Re-read inside the txn for race safety against a concurrent retry.
    const fresh = await tx.prescription.findUnique({
      where: { id: prescriptionId },
      select: { ocrRawResult: true },
    });
    if (!fresh) return;
    const applied = appliedDeltasOf(fresh.ocrRawResult);
    if (applied.includes(deltaUploadId)) return;

    // 1. Write Pass-B readings + matchStatus onto the new bottle photos.
    for (const bottle of newBottlePhotos) {
      const read = bottleReads.get(bottle.id);
      await tx.medicinePhoto.update({
        where: { id: bottle.id },
        data: {
          aiReadName: read?.aiReadName ?? null,
          matchConfidence: read?.confidence ?? 0,
          matchStatus: matchedBottleIds.has(bottle.id)
            ? "match"
            : newPassA.length > 0
              ? "unclear"
              : "not_attempted",
        },
      });
    }

    // 2. Create new items.
    for (const reconciled of newItems) {
      const line = lineMap.get(reconciled.passACandidateId);
      if (!line) continue;
      const cls = classifyPrescriptionItem({
        ocrConfidence: reconciled.reconciledConfidence,
        photoCrossCheckStatus: reconciled.photoCrossCheckStatus,
        hasPairedMedicinePhoto: hasPairedThisDelta,
      });
      const pairedIds =
        reconciled.matchedMedicinePhotoId !== null ? [reconciled.matchedMedicinePhotoId] : [];
      const audit: AuditEntry[] = [
        {
          at: nowIso,
          by: "vision",
          source: "vision_pass_a",
          payload: {
            deltaUploadId,
            passACandidateId: reconciled.passACandidateId,
            name: line.name,
            dosage: line.dosage,
            frequency: line.frequency,
            confidence: line.confidence,
            alternatives: line.alternatives,
          },
        },
      ];
      if (reconciled.matchedMedicinePhotoId !== null) {
        const read = bottleReads.get(reconciled.matchedMedicinePhotoId);
        audit.push({
          at: nowIso,
          by: "vision",
          source: "vision_pass_b",
          payload: {
            deltaUploadId,
            medicinePhotoId: reconciled.matchedMedicinePhotoId,
            aiReadName: read?.aiReadName ?? null,
            confidence: read?.confidence ?? null,
            bestPassBScore: reconciled.bestPassBScore,
          },
        });
      }
      const canonicalKey = canonicaliseMedicineName(line.name);
      const createdItem = await tx.prescriptionItem.create({
        data: {
          prescriptionId,
          ocrMedicineName: line.name,
          ocrDosage: line.dosage,
          ocrFrequency: line.frequency,
          ocrConfidence: reconciled.reconciledConfidence,
          ocrAlternatives:
            line.alternatives.length > 0
              ? (line.alternatives as unknown as Prisma.InputJsonValue)
              : Prisma.JsonNull,
          ocrColor: cls.color,
          status: cls.color === "need_clarification" ? "need_clarification" : "pending",
          pairedMedicinePhotoIds: pairedIds,
          aiSuggestionHistory: audit as unknown as Prisma.InputJsonValue,
          ...(canonicalKey !== null ? { approverNote: `canonical:${canonicalKey}` } : {}),
        },
        select: { id: true },
      });

      if (cls.color === "need_clarification") {
        needClarificationItems.push({ itemId: createdItem.id, reason: cls.reason });
      }
    }

    // 3. Apply promotions to existing single-source items.
    for (const promo of promotions) {
      const item = prescription.items.find((it) => it.id === promo.existingItemId);
      if (!item) continue;
      const cls = classifyPrescriptionItem({
        ocrConfidence: promo.reconciledConfidence,
        photoCrossCheckStatus: "match",
        hasPairedMedicinePhoto: true,
      });
      const read = bottleReads.get(promo.matchedMedicinePhotoId);
      const promoEntry: AuditEntry = {
        at: nowIso,
        by: "vision",
        source: "vision_pass_b",
        payload: {
          deltaUploadId,
          action: "delta_promotion",
          medicinePhotoId: promo.matchedMedicinePhotoId,
          aiReadName: read?.aiReadName ?? null,
          confidence: read?.confidence ?? null,
          bestPassBScore: promo.bestPassBScore,
          newOcrConfidence: promo.reconciledConfidence,
          newColor: cls.color,
        },
      };
      const existingHistory = Array.isArray(item.aiSuggestionHistory)
        ? item.aiSuggestionHistory
        : [];
      const nextPaired = item.pairedMedicinePhotoIds.includes(promo.matchedMedicinePhotoId)
        ? item.pairedMedicinePhotoIds
        : [...item.pairedMedicinePhotoIds, promo.matchedMedicinePhotoId];
      await tx.prescriptionItem.update({
        where: { id: item.id },
        data: {
          ocrConfidence: promo.reconciledConfidence,
          ocrColor: cls.color,
          // A promotion only ever lifts a still-pending item; never
          // disturb one the approver has already actioned.
          ...(item.status === "pending" || item.status === "need_clarification"
            ? { status: "pending" }
            : {}),
          pairedMedicinePhotoIds: nextPaired,
          aiSuggestionHistory: [...existingHistory, promoEntry] as unknown as Prisma.InputJsonValue,
        },
      });
    }

    // 4. Recompute the prescription envelope + record the applied delta.
    const allItems = await tx.prescriptionItem.findMany({
      where: { prescriptionId },
      select: { status: true },
    });
    const hasNeedsClarification = allItems.some((i) => i.status === "need_clarification");
    const nextStatus = hasNeedsClarification ? "partial" : "pending_approval";

    const rawObj =
      typeof fresh.ocrRawResult === "object" &&
      fresh.ocrRawResult !== null &&
      !Array.isArray(fresh.ocrRawResult)
        ? (fresh.ocrRawResult as Record<string, unknown>)
        : {};
    const nextRaw: Record<string, unknown> = {
      ...rawObj,
      appliedDeltas: [...applied, deltaUploadId],
    };

    await tx.prescription.update({
      where: { id: prescriptionId },
      data: {
        // Never downgrade an `approved`/`rejected` prescription — the
        // append route guards that, but defend at the txn boundary too.
        ...(prescription.status === "pending_approval" || prescription.status === "partial"
          ? { status: nextStatus }
          : {}),
        ocrRawResult: nextRaw as unknown as Prisma.InputJsonValue,
      },
    });
  });

  captureAnalyticsEvent("prescription_ocr_completed", userId, {
    prescription_id: prescriptionId,
    item_count: newItems.length,
    bottle_count: newPassB.length,
    page_count: newPrescriptionPhotoUrls.length,
    request_id: requestId,
    delta: true,
    promotions: promotions.length,
  });

  // phase4.md §F.12 — one event per newly-parked item.
  for (const item of needClarificationItems) {
    captureAnalyticsEvent("prescription_need_clarification_item", userId, {
      itemId: item.itemId,
      reason: item.reason,
    });
  }
};
