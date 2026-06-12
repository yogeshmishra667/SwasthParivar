// PRESCRIPTION_OCR BullMQ processor — fired on prescription upload by
// the F.5 `POST /api/v1/prescriptions/upload` route.
//
// Orchestrates the two-pass Vision pipeline per phase4.md §F.3:
//
//   1. Pass A — `generateVisionResponse({mode: "prescription_text"})`
//      on every prescription page. Flatten lines into a single Pass-A
//      candidate list, each tagged `${pageIndex}:${rowIndex}`.
//   2. Pass B — `generateVisionResponse({mode: "medicine_bottle"})` on
//      every paired `MedicinePhoto` row. Update each photo's
//      `aiReadName` + `matchConfidence` in place.
//   3. Reconcile — pure `reconcilePassAB({passA, passB})` from
//      `@swasth/domain-logic`. Produces per-item
//      `photoCrossCheckStatus` + matched photoId.
//   4. Classify — pure `classifyPrescriptionItem({ocrConfidence,
//      photoCrossCheckStatus, hasPairedMedicinePhoto})` per item. RED
//      / YELLOW / GREEN / `need_clarification`.
//   5. Persist — one `PrescriptionItem` per Pass-A candidate, each
//      with its own `aiSuggestionHistory` audit entries. Update
//      Prescription.status and ocrRawResult in the same transaction.
//
// Idempotency: jobId = `ocr-${prescriptionId}` (BullMQ dedupe) AND an
// in-job guard on `prescription.status === "pending_ocr"`. A re-run on
// an already-classified prescription is a no-op — important because
// BullMQ retries on failure and we cannot afford to double-create
// PrescriptionItem rows mid-retry.
//
// Spend cap: the Vision wrapper auto-flips `prescription_ocr_enabled=
// false` when `CLAUDE_VISION_DAILY_SPEND_CAP_USD` is breached. This
// processor checks the flag at start and short-circuits if off; a
// mid-prescription breach propagates as a thrown error → BullMQ
// retries → next attempt sees the flag off and aborts cleanly.
//
// What stays out of this file (by design):
//   • Vision SDK plumbing — `apps/server/src/shared/ai/claude-vision.ts`.
//   • Reconciliation logic — pure module in @swasth/domain-logic.
//   • Color classification — pure module in @swasth/domain-logic.
//   • Approver authority resolution — pure module, called by the F.5
//     upload route BEFORE this job fires.
//   • Photo upload to R2 — happens in the F.5 controller.

import { createHash } from "node:crypto";

import type { Job } from "bullmq";
import { Prisma } from "@prisma/client";
import {
  canonicaliseMedicineName,
  classifyPrescriptionItem,
  reconcilePassAB,
  type PassACandidate,
  type PassBCandidate,
  type ReconciledItem,
} from "@swasth/domain-logic";
import type { PrescriptionItemColor, PrescriptionItemStatus } from "@swasth/shared-types";

import { prisma } from "../shared/database.js";
import { getFlag } from "../shared/flags/index.js";
import { logger } from "../shared/logger.js";
import {
  generateVisionResponse,
  type PrescriptionLineCandidate,
  type VisionResponseMeta,
} from "../shared/ai/claude-vision.js";
import { capture as captureAnalyticsEvent } from "../shared/analytics/posthog.js";

const sha256Hex = (input: string): string => createHash("sha256").update(input).digest("hex");

export interface PrescriptionOcrJob {
  readonly prescriptionId: string;
  readonly userId: string;
  /** Request ID from the upload route — propagated to Vision telemetry for trace stitching. */
  readonly requestId: string;
}

/**
 * Initial `PrescriptionItem.status` derived from the colour. `need_
 * clarification` items park immediately so the approver UI can park
 * them with a "tell me more" CTA (phase4.md §F.4). All other colours
 * stay `pending` — the approver tap moves them to approved/rejected/
 * needs_doctor.
 */
const initialItemStatus = (color: PrescriptionItemColor): PrescriptionItemStatus =>
  color === "need_clarification" ? "need_clarification" : "pending";

/**
 * Anonymise the userId into a stable hash for Vision telemetry.
 * `userId` itself MUST NOT cross the wrapper boundary — the wrapper
 * declines anything except `PrescriptionContext`.
 */
const anonymiseUserId = (userId: string): string => `anon_${sha256Hex(userId).slice(0, 16)}`;

interface PassARunMeta {
  readonly pageIndex: number;
  readonly photoUrl: string;
  readonly meta: VisionResponseMeta;
}

interface PassBRunMeta {
  readonly medicinePhotoId: string;
  readonly photoUrl: string;
  readonly meta: VisionResponseMeta;
}

interface AuditEntry {
  readonly at: string;
  readonly by: "vision";
  readonly source:
    | "vision_pass_a"
    | "vision_pass_b"
    | "vision_clarification_pass"
    | "approver_correction"
    | "approver_added";
  readonly payload: Record<string, unknown>;
}

export const processPrescriptionOcr = async (job: Job<PrescriptionOcrJob>): Promise<void> => {
  const { prescriptionId, userId, requestId } = job.data;

  // ── Kill-switch flag check ────────────────────────────────────────
  // Cheap pre-check before the (potentially expensive) DB read. If the
  // flag was auto-flipped off by the spend cap mid-day, we leave the
  // prescription in `pending_ocr` — ops can flip the flag back on and
  // re-enqueue from the admin UI in F.5.
  const enabled = await getFlag<boolean>("prescription_ocr_enabled", false);
  if (enabled !== true) {
    logger.warn(
      { prescriptionId, requestId, jobId: job.id },
      "prescription_ocr_enabled=false — skipping OCR job",
    );
    return;
  }

  // ── Load prescription + paired photos ─────────────────────────────
  const prescription = await prisma.prescription.findUnique({
    where: { id: prescriptionId },
    include: { medicinePhotos: { orderBy: { createdAt: "asc" } } },
  });
  if (!prescription) {
    logger.warn({ prescriptionId, jobId: job.id }, "prescription not found — skipping");
    return;
  }
  if (prescription.status !== "pending_ocr") {
    logger.info(
      { prescriptionId, status: prescription.status, jobId: job.id },
      "prescription already past pending_ocr — idempotent skip",
    );
    return;
  }
  if (prescription.userId !== userId) {
    // Defensive — the job payload's userId must match the row. A
    // mismatch means the job was enqueued for the wrong patient.
    logger.error(
      { prescriptionId, jobUserId: userId, rowUserId: prescription.userId, jobId: job.id },
      "prescription userId mismatch — refusing to process",
    );
    return;
  }

  const anonymizedPatientId = anonymiseUserId(userId);
  const visionContext = { anonymizedPatientId, prescriptionId };

  // ── Pass A: extract lines from each prescription page ─────────────
  const passACandidates: PassACandidate[] = [];
  const passALineMap = new Map<string, PrescriptionLineCandidate>();
  const passAByPage: PassARunMeta[] = [];

  for (let pageIndex = 0; pageIndex < prescription.originalPhotoUrls.length; pageIndex += 1) {
    const photoUrl = prescription.originalPhotoUrls[pageIndex]!;
    const response = await generateVisionResponse({
      mode: "prescription_text",
      images: [{ kind: "url", url: photoUrl }],
      context: visionContext,
      userId,
      requestId,
    });
    if (response.mode !== "prescription_text") continue;

    passAByPage.push({ pageIndex, photoUrl, meta: response.meta });

    response.lines.forEach((line, rowIndex) => {
      const id = `${pageIndex}:${rowIndex}`;
      passACandidates.push({
        id,
        aiReadName: line.name,
        confidence: line.confidence,
      });
      passALineMap.set(id, line);
    });
  }

  // ── Pass B: read each paired bottle photo ─────────────────────────
  // Only `initial_upload` photos participate in the OCR reconciliation
  // — clarification + post-schedule photos are handled by their own
  // dedicated worker (deferred to F.5).
  const initialBottlePhotos = prescription.medicinePhotos.filter(
    (p) => p.uploadedAt === "initial_upload",
  );
  const passBCandidates: PassBCandidate[] = [];
  const passBByPhoto: PassBRunMeta[] = [];

  for (const bottle of initialBottlePhotos) {
    const response = await generateVisionResponse({
      mode: "medicine_bottle",
      images: [{ kind: "url", url: bottle.photoUrl }],
      context: visionContext,
      userId,
      requestId,
    });
    if (response.mode !== "medicine_bottle") continue;

    passBByPhoto.push({
      medicinePhotoId: bottle.id,
      photoUrl: bottle.photoUrl,
      meta: response.meta,
    });
    passBCandidates.push({
      medicinePhotoId: bottle.id,
      aiReadName: response.bottle.aiReadName,
      confidence: response.bottle.confidence,
    });
  }

  // ── Pure reconciliation + classification ──────────────────────────
  const { items: reconciledItems } = reconcilePassAB({
    passA: passACandidates,
    passB: passBCandidates,
  });

  // ── Persist ───────────────────────────────────────────────────────
  const now = new Date();
  const ocrRawResult = buildOcrRawResult({
    passAByPage,
    passBByPhoto,
    reconciledItems,
  });

  // Items parked in `need_clarification` are collected here and emitted to
  // PostHog after the transaction commits (phase4.md §F.12). Fires the
  // `need_clarification rate > 20%/week → photo-quality` developer alert.
  const needClarificationItems: { itemId: string; reason: string }[] = [];

  await prisma.$transaction(async (tx) => {
    // 1. Update MedicinePhoto rows with their Pass-B readings + match status.
    for (const bottle of passBByPhoto) {
      const matchedInReconciliation = reconciledItems.find(
        (item) => item.matchedMedicinePhotoId === bottle.medicinePhotoId,
      );
      const bottleCandidate = passBCandidates.find(
        (c) => c.medicinePhotoId === bottle.medicinePhotoId,
      );
      await tx.medicinePhoto.update({
        where: { id: bottle.medicinePhotoId },
        data: {
          aiReadName: bottleCandidate?.aiReadName ?? null,
          matchConfidence: bottleCandidate?.confidence ?? 0,
          matchStatus: matchedInReconciliation
            ? "match"
            : passBCandidates.length > 0 && passACandidates.length > 0
              ? "unclear"
              : "not_attempted",
        },
      });
    }

    // 2. Create PrescriptionItem rows.
    for (const reconciled of reconciledItems) {
      const line = passALineMap.get(reconciled.passACandidateId);
      if (!line) continue;

      const ocrColor = classifyPrescriptionItem({
        ocrConfidence: reconciled.reconciledConfidence,
        photoCrossCheckStatus: reconciled.photoCrossCheckStatus,
        hasPairedMedicinePhoto: passBCandidates.length > 0,
      });

      const audit: AuditEntry[] = buildAuditTrailForItem({
        reconciled,
        line,
        passAByPage,
        passBByPhoto,
        passBCandidates,
        now: now.toISOString(),
      });

      const pairedPhotoIds =
        reconciled.matchedMedicinePhotoId !== null ? [reconciled.matchedMedicinePhotoId] : [];

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
          ocrColor: ocrColor.color,
          status: initialItemStatus(ocrColor.color),
          pairedMedicinePhotoIds: pairedPhotoIds,
          aiSuggestionHistory: audit as unknown as Prisma.InputJsonValue,
          // canonicalKey is stored as part of the audit payload too —
          // ops can query "all items resolving to metformin in the
          // last 30 days" without reparsing free text.
          ...(canonicalKey !== null ? { approverNote: `canonical:${canonicalKey}` } : {}),
        },
        select: { id: true },
      });

      if (ocrColor.color === "need_clarification") {
        needClarificationItems.push({ itemId: createdItem.id, reason: ocrColor.reason });
      }
    }

    // 3. Update the prescription envelope. Any item parked in
    //    `need_clarification` flips the prescription to `partial`;
    //    otherwise it advances to `pending_approval`. A completely
    //    blank prescription (no Pass-A lines extracted) is treated as
    //    `partial` so the approver can manually add items via the F.5
    //    `/items` route — never auto-rejected.
    const hasNeedsClarification = needClarificationItems.length > 0;

    const nextStatus =
      reconciledItems.length === 0 || hasNeedsClarification ? "partial" : "pending_approval";

    await tx.prescription.update({
      where: { id: prescriptionId },
      data: {
        status: nextStatus,
        ocrRawResult,
        approvalRequestedAt:
          nextStatus === "pending_approval" ? now : prescription.approvalRequestedAt,
      },
    });
  });

  captureAnalyticsEvent("prescription_ocr_completed", userId, {
    prescription_id: prescriptionId,
    item_count: reconciledItems.length,
    bottle_count: passBCandidates.length,
    page_count: prescription.originalPhotoUrls.length,
    request_id: requestId,
  });

  // phase4.md §F.12 — one event per parked item so the
  // `need_clarification rate > 20%/week` developer alert can fire.
  for (const item of needClarificationItems) {
    captureAnalyticsEvent("prescription_need_clarification_item", userId, {
      itemId: item.itemId,
      reason: item.reason,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

interface BuildOcrRawResultInput {
  readonly passAByPage: readonly PassARunMeta[];
  readonly passBByPhoto: readonly PassBRunMeta[];
  readonly reconciledItems: readonly ReconciledItem[];
}

/**
 * The full audit blob persisted to `Prescription.ocrRawResult`. Stores
 * the per-page / per-bottle meta (tokens, model, latency) so ops can
 * replay cost + latency analytics without re-querying Vision. The
 * heavy raw-text payloads are NOT included — they live on per-item
 * audit entries to keep ocrRawResult bounded.
 */
const buildOcrRawResult = (input: BuildOcrRawResultInput) => ({
  pages: input.passAByPage.map((p) => ({
    pageIndex: p.pageIndex,
    photoUrl: p.photoUrl,
    model: p.meta.model,
    tokensInput: p.meta.tokensInput,
    tokensOutput: p.meta.tokensOutput,
    responseLatencyMs: p.meta.responseLatencyMs,
  })),
  bottles: input.passBByPhoto.map((b) => ({
    medicinePhotoId: b.medicinePhotoId,
    photoUrl: b.photoUrl,
    model: b.meta.model,
    tokensInput: b.meta.tokensInput,
    tokensOutput: b.meta.tokensOutput,
    responseLatencyMs: b.meta.responseLatencyMs,
  })),
  reconciliation: input.reconciledItems.map((item) => ({
    passACandidateId: item.passACandidateId,
    photoCrossCheckStatus: item.photoCrossCheckStatus,
    matchedMedicinePhotoId: item.matchedMedicinePhotoId,
    bestPassBScore: item.bestPassBScore,
    reconciledConfidence: item.reconciledConfidence,
  })),
});

interface BuildAuditTrailInput {
  readonly reconciled: ReconciledItem;
  readonly line: PrescriptionLineCandidate;
  readonly passAByPage: readonly PassARunMeta[];
  readonly passBByPhoto: readonly PassBRunMeta[];
  readonly passBCandidates: readonly PassBCandidate[];
  readonly now: string;
}

/**
 * Builds the per-item append-only audit array stored on
 * `PrescriptionItem.aiSuggestionHistory`. Same shape as the chat-side
 * payload audit (CLAUDE.md): each entry records `{at, by, source,
 * payload}` so ops can replay 90 days later "which Vision pass + which
 * approver tap produced this drug in the cabinet". This is the function
 * that turns Vision output into the auditable artefact phase4.md §F.5
 * requires.
 */
const buildAuditTrailForItem = (input: BuildAuditTrailInput): AuditEntry[] => {
  const entries: AuditEntry[] = [];

  const [pageIdxStr, rowIdxStr] = input.reconciled.passACandidateId.split(":");
  const pageIdx = Number.parseInt(pageIdxStr ?? "0", 10);
  const rowIdx = Number.parseInt(rowIdxStr ?? "0", 10);
  const passARun = input.passAByPage[pageIdx];

  entries.push({
    at: input.now,
    by: "vision",
    source: "vision_pass_a",
    payload: {
      pageIndex: pageIdx,
      rowIndex: rowIdx,
      photoUrl: passARun?.photoUrl,
      model: passARun?.meta.model,
      tokensInput: passARun?.meta.tokensInput,
      tokensOutput: passARun?.meta.tokensOutput,
      responseLatencyMs: passARun?.meta.responseLatencyMs,
      name: input.line.name,
      dosage: input.line.dosage,
      frequency: input.line.frequency,
      confidence: input.line.confidence,
      alternatives: input.line.alternatives,
    },
  });

  // Only the matched bottle, if any, makes it into the per-item audit
  // — other Pass-B candidates belong to other items.
  if (input.reconciled.matchedMedicinePhotoId !== null) {
    const passBRun = input.passBByPhoto.find(
      (b) => b.medicinePhotoId === input.reconciled.matchedMedicinePhotoId,
    );
    const passBCandidate = input.passBCandidates.find(
      (c) => c.medicinePhotoId === input.reconciled.matchedMedicinePhotoId,
    );
    if (passBRun && passBCandidate) {
      entries.push({
        at: input.now,
        by: "vision",
        source: "vision_pass_b",
        payload: {
          medicinePhotoId: input.reconciled.matchedMedicinePhotoId,
          photoUrl: passBRun.photoUrl,
          model: passBRun.meta.model,
          tokensInput: passBRun.meta.tokensInput,
          tokensOutput: passBRun.meta.tokensOutput,
          responseLatencyMs: passBRun.meta.responseLatencyMs,
          aiReadName: passBCandidate.aiReadName,
          confidence: passBCandidate.confidence,
          bestPassBScore: input.reconciled.bestPassBScore,
        },
      });
    }
  }

  return entries;
};
