// GENERATE_PDF BullMQ processor — Phase 4 Feature G.4.
//
// On-demand. Gathers the last 30d of glucose + BP, the HbA1c estimate,
// med-adherence %, and the top-3 insights for one patient; builds the
// PII-stripped report model; calls the Claude executive summary (gated +
// safety-filtered); renders HTML → Puppeteer PDF; uploads to R2; flips
// the Report row to `ready`.
//
// Idempotent: a Report already `ready` is skipped (a BullMQ retry or a
// duplicate enqueue is a no-op). On error the row is set `failed` and the
// error rethrown so BullMQ retries (the next attempt sees `failed`, not
// `ready`, and re-runs).

import type { Job } from "bullmq";

import {
  buildReportModel,
  estimateHbA1c,
  type BpPoint,
  type ReadingPoint,
  type ReportInsight,
  type ReportModel,
} from "@swasth/domain-logic";
import { prisma } from "../shared/database.js";
import { logger } from "../shared/logger.js";
import { capture } from "../shared/analytics/posthog.js";
import { uploadObject } from "../shared/storage/r2.js";
import { generateReportSummary } from "../shared/ai/report-summary.js";
import { renderReportHtml } from "../shared/reports/report-template.js";
import { renderHtmlToPdf } from "../shared/reports/render-pdf.js";
import { adherenceLast } from "../modules/medications/medications.service.js";

export interface GenerateReportJob {
  reportId: string;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

// A doctor reads English; map preferred language to the safety-filter's
// language hint (the filter checks all banks regardless).
const filterLang = (lang: string): "hi" | "en" | "hi-en" => (lang === "en" ? "en" : "hi-en");

const buildDigest = (model: ReportModel): string => {
  const lines: string[] = [`Patient age band: ${model.ageBand}.`];
  if (model.glucose.fasting) {
    const f = model.glucose.fasting;
    lines.push(
      `Fasting glucose (30d): avg ${f.avg}, range ${f.min}-${f.max}, latest ${f.latest} (${f.count} readings).`,
    );
  }
  if (model.glucose.postMeal) {
    const p = model.glucose.postMeal;
    lines.push(
      `Post-meal glucose (30d): avg ${p.avg}, range ${p.min}-${p.max}, latest ${p.latest}.`,
    );
  }
  if (model.bp) {
    lines.push(
      `BP: latest ${model.bp.latestSystolic}/${model.bp.latestDiastolic}, avg ${model.bp.avgSystolic}/${model.bp.avgDiastolic}.`,
    );
  }
  if (model.hba1cEstimate !== null) {
    lines.push(`Estimated HbA1c: ${model.hba1cEstimate.toFixed(1)}% (estimate only).`);
  }
  if (model.medAdherencePercent !== null) {
    lines.push(`Medication adherence (30d): ${model.medAdherencePercent}%.`);
  }
  if (model.insights.length > 0) {
    lines.push(
      `Recent patterns: ${model.insights.map((i) => `${i.title} (${i.severity})`).join("; ")}.`,
    );
  }
  return lines.join("\n");
};

export const processGenerateReport = async (job: Job<GenerateReportJob>): Promise<void> => {
  const { reportId } = job.data;
  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report) {
    logger.warn({ reportId }, "generate-report: row not found — skipping");
    return;
  }
  if (report.status === "ready") return; // idempotent

  const startedAt = Date.now();
  try {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: report.userId },
      select: { name: true, age: true, preferredLanguage: true },
    });

    const since30 = new Date(Date.now() - THIRTY_DAYS_MS);
    const since90 = new Date(Date.now() - NINETY_DAYS_MS);

    const [glucoseRows, bpRows, insightRows, adherence] = await Promise.all([
      prisma.glucoseReading.findMany({
        where: { userId: report.userId, measuredAt: { gte: since90 } },
        select: { valueMgDl: true, readingType: true, measuredAt: true },
        orderBy: { measuredAt: "asc" },
      }),
      prisma.bPReading.findMany({
        where: { userId: report.userId, measuredAt: { gte: since30 } },
        select: { systolic: true, diastolic: true, measuredAt: true },
        orderBy: { measuredAt: "asc" },
      }),
      prisma.insightEvent.findMany({
        where: { userId: report.userId },
        orderBy: { createdAt: "desc" },
        take: 3,
        select: { patternType: true, severityLevel: true },
      }),
      adherenceLast(report.userId, 30),
    ]);

    // 30-day windows for the rendered series; the 90d glucose set also
    // feeds the HbA1c estimate.
    const within30 = (d: Date): boolean => d.getTime() >= since30.getTime();
    const fasting: ReadingPoint[] = glucoseRows
      .filter((r) => r.readingType === "fasting" && within30(r.measuredAt))
      .map((r) => ({ iso: r.measuredAt.toISOString(), value: r.valueMgDl }));
    const postMeal: ReadingPoint[] = glucoseRows
      .filter((r) => r.readingType === "post_meal" && within30(r.measuredAt))
      .map((r) => ({ iso: r.measuredAt.toISOString(), value: r.valueMgDl }));
    const bp: BpPoint[] = bpRows.map((r) => ({
      iso: r.measuredAt.toISOString(),
      systolic: r.systolic,
      diastolic: r.diastolic,
    }));

    const hba1c = estimateHbA1c({
      readings: glucoseRows.map((r) => ({
        valueMgDl: r.valueMgDl,
        measuredAt: r.measuredAt.toISOString(),
      })),
      now: new Date(),
    });

    const insights: ReportInsight[] = insightRows.map((i) => ({
      title: i.patternType,
      severity: i.severityLevel,
    }));

    // First pass without AI summary → build a digest → ask Claude → final
    // model. The AI call is best-effort: any failure returns null and the
    // report renders without the paragraph.
    const baseInput = {
      name: user.name,
      age: user.age,
      generatedAtIso: new Date().toISOString(),
      glucose: { fasting, postMeal },
      bp,
      hba1cEstimate: hba1c ? hba1c.hba1cPercent : null,
      medAdherencePercent:
        adherence.taken + adherence.missed + adherence.skipped > 0
          ? Math.round(adherence.rate * 100)
          : null,
      insights,
    };
    const draft = buildReportModel({ ...baseInput, aiSummary: null });
    const summary = await generateReportSummary({
      userId: report.userId,
      language: filterLang(user.preferredLanguage),
      digest: buildDigest(draft),
    });
    const model = buildReportModel({ ...baseInput, aiSummary: summary.text });

    const html = renderReportHtml(model);
    const pdf = await renderHtmlToPdf(html);

    const key = `reports/${report.userId}/${report.id}.pdf`;
    const uploaded = await uploadObject({
      key,
      body: pdf,
      contentType: "application/pdf",
      cacheControl: "private, max-age=3600",
    });

    await prisma.report.update({
      where: { id: report.id },
      data: {
        status: "ready",
        pdfUrl: uploaded.url,
        pdfR2Key: key,
        aiSummaryIncluded: summary.text !== null,
      },
    });

    capture("report_generated", report.userId, {
      report_id: report.id,
      appointment_id: report.appointmentId,
      ai_summary_included: summary.text !== null,
      generation_ms: Date.now() - startedAt,
    });
  } catch (err) {
    logger.error({ err, reportId }, "generate-report failed");
    await prisma.report.update({
      where: { id: report.id },
      data: { status: "failed", error: err instanceof Error ? err.message : "unknown" },
    });
    throw err;
  }
};
