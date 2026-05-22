// SILENT_GUARDIAN_ANALYZE BullMQ processor — Phase 3 Feature C (C-3).
//
// Runs once a day. For every patient who has an accepted, alert-enabled
// guardian link:
//   1. detect + score the Phase 3 signals (med-adherence, worsening
//      glucose trend) → persist a SilentGuardianSignal per non-zero one
//   2. aggregate the latest signal per source (with decay) into a risk
//      band
//   3. when the band is yellow/orange, create a GuardianAlert per linked
//      guardian — unless a recent unread alert already covers it
//
// SHADOW MODE: this slice creates GuardianAlert rows but never dispatches
// them. Push/SMS delivery is added in the next slice behind the separate
// `silent_guardian_alerts_dispatch` flag. The whole run is gated by
// `silent_guardian_enabled` (default false).
//
// Pure scoring / aggregation / copy logic lives in
// @swasth/domain-logic. This processor owns the Prisma reads, the
// row writes, and the PostHog emits.

import type { Job } from "bullmq";
import {
  aggregateRisk,
  buildAlertContent,
  classifyAlertType,
  detectTrend,
  scoreSignal,
  type AlertContentSignal,
  type AlertLanguage,
  type ScoredSignal,
  type TypedReading,
} from "@swasth/domain-logic";
import type {
  GlucoseReadingType,
  GuardianAlertSeverity,
  Prisma,
  SignalSource,
  SilentGuardianSignal,
} from "@prisma/client";

import { prisma } from "../shared/database.js";
import { getFlag } from "../shared/flags/index.js";
import { logger } from "../shared/logger.js";
import { captureUnhandled } from "../shared/observability/sentry.js";
import { capture } from "../shared/analytics/posthog.js";
import { enqueueGuardianAlertDispatch } from "../modules/silent-guardian/silent-guardian.jobs.js";

const dayMs = 86_400_000;
const MED_WINDOW_DAYS = 7;
const READING_HISTORY_DAYS = 30;
const TREND_WINDOW_DAYS = 14;
// A signal is only worth aggregating while its decayed weight is still
// meaningful — beyond 7 days it has fallen to ≤ 50%.
const SIGNAL_LOOKBACK_DAYS = 7;

const SEVERITY_RANK: Record<GuardianAlertSeverity, number> = { yellow: 1, orange: 2 };

export interface SilentGuardianAnalyzeJob {
  tick: true;
}

interface GuardianTarget {
  guardianId: string;
  language: AlertLanguage;
}

interface PatientGroup {
  patientId: string;
  patientName: string;
  guardians: GuardianTarget[];
}

const toTyped = (
  rows: readonly {
    id: string;
    valueMgDl: number;
    readingType: GlucoseReadingType;
    measuredAt: Date;
  }[],
): TypedReading[] =>
  rows.map((r) => ({
    id: r.id,
    valueMgDl: r.valueMgDl,
    readingType: r.readingType,
    measuredAt: r.measuredAt.toISOString(),
  }));

// Patient's own fasting-glucose baseline — used by the data-anomaly
// scorer to weigh a trend against normal variability. null when there
// is not enough history to be meaningful.
const baselineOf = (values: readonly number[]): { mean: number; sigma: number } | null => {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return { mean, sigma: Math.sqrt(variance) };
};

// A BullMQ retry re-runs analyzePatient wholesale. A signal created
// within this window is treated as the current cycle's signal, so a
// retry reuses it instead of inserting a duplicate row + re-emitting
// PostHog. Comfortably larger than the 3-attempt exponential backoff,
// smaller than the 24h cron interval.
const RETRY_DEDUP_HOURS = 23;

// Persists one scored signal — or, on a retry, reuses this cycle's
// existing one. Returns the row that should feed risk aggregation,
// which may be an older signal still inside the decay window when
// nothing new scored this run.
const persistSignal = async (
  patientId: string,
  source: SignalSource,
  scored: ScoredSignal,
  evidence: Prisma.InputJsonObject,
  now: Date,
  lookbackCutoff: Date,
): Promise<SilentGuardianSignal | null> => {
  const latest = await prisma.silentGuardianSignal.findFirst({
    where: { userId: patientId, signalSource: source, detectedAt: { gte: lookbackCutoff } },
    orderBy: { detectedAt: "desc" },
  });

  // Nothing new scored — keep the latest persisted signal so a
  // still-decaying older concern continues to contribute.
  if (scored.contribution <= 0) return latest;

  // Idempotency — a retry within the dedup window reuses this cycle's
  // signal instead of inserting a duplicate.
  const retryCutoff = new Date(now.getTime() - RETRY_DEDUP_HOURS * 3_600_000);
  if (latest !== null && latest.detectedAt >= retryCutoff) return latest;

  const created = await prisma.silentGuardianSignal.create({
    data: {
      userId: patientId,
      signalSource: source,
      signalType: scored.signalType,
      rawEvidence: evidence,
      riskContribution: scored.contribution,
      detectedAt: now,
    },
  });
  capture("silent_guardian_signal_detected", patientId, {
    source,
    type: scored.signalType,
    contribution: scored.contribution,
  });
  return created;
};

// ── per-patient analysis ────────────────────────────────────────────

// Returns the number of GuardianAlert rows created for this patient.
const analyzePatient = async (group: PatientGroup, now: Date): Promise<number> => {
  const patientId = group.patientId;
  const medCutoff = new Date(now.getTime() - MED_WINDOW_DAYS * dayMs);
  const readingCutoff = new Date(now.getTime() - READING_HISTORY_DAYS * dayMs);
  const signalCutoff = new Date(now.getTime() - SIGNAL_LOOKBACK_DAYS * dayMs);

  const [medLogs, fastingReadings] = await Promise.all([
    prisma.medicationLog.findMany({
      where: { userId: patientId, scheduledFor: { gte: medCutoff } },
      select: { status: true },
    }),
    prisma.glucoseReading.findMany({
      where: { userId: patientId, readingType: "fasting", measuredAt: { gte: readingCutoff } },
      select: { id: true, valueMgDl: true, readingType: true, measuredAt: true },
      orderBy: { measuredAt: "asc" },
    }),
  ]);

  // ── med-adherence signal ──
  const missedCount = medLogs.filter(
    (l) => l.status === "skipped" || l.status === "missed_no_response",
  ).length;
  const medEvidence = { missedCount, windowDays: MED_WINDOW_DAYS };
  const medScored = scoreSignal({
    source: "med_adherence",
    evidence: medEvidence,
    userBaseline: null,
  });
  const medSignal = await persistSignal(
    patientId,
    "med_adherence",
    medScored,
    medEvidence,
    now,
    signalCutoff,
  );

  // ── data-anomaly (worsening trend) signal ──
  let anomalyScored: ScoredSignal = {
    contribution: 0,
    signalType: "trend_stable",
    reasoning: "no trend detected",
  };
  let anomalyEvidence: Prisma.InputJsonObject = {};
  const trend = detectTrend({
    readings: toTyped(fastingReadings),
    windowDays: TREND_WINDOW_DAYS,
    targetReadingType: "fasting",
    now,
  });
  if (trend) {
    const slopeRaw = trend.messageParams.slopePerDay;
    const directionRaw = trend.messageParams.direction;
    const rSquaredRaw = trend.evidence.rSquared;
    const ev = {
      slopePerDay: typeof slopeRaw === "number" ? slopeRaw : 0,
      direction: typeof directionRaw === "string" ? directionRaw : "",
      rSquared: typeof rSquaredRaw === "number" ? rSquaredRaw : 0,
      readingType: "fasting",
    };
    anomalyScored = scoreSignal({
      source: "data_anomaly",
      evidence: ev,
      userBaseline: baselineOf(fastingReadings.map((r) => r.valueMgDl)),
    });
    anomalyEvidence = ev;
  }
  const anomalySignal = await persistSignal(
    patientId,
    "data_anomaly",
    anomalyScored,
    anomalyEvidence,
    now,
    signalCutoff,
  );

  // ── aggregate the latest signal per source ──
  const activeSignals = [medSignal, anomalySignal].filter(
    (s): s is SilentGuardianSignal => s !== null,
  );
  if (activeSignals.length === 0) return 0;

  const risk = aggregateRisk({
    signals: activeSignals.map((s) => ({
      contribution: s.riskContribution,
      detectedAt: s.detectedAt,
    })),
    now,
  });
  if (risk.severity === "safe") return 0;

  // ── create a GuardianAlert per linked guardian ──
  const explainerSignals: AlertContentSignal[] = activeSignals.map((s) => ({
    source: s.signalSource,
    signalType: s.signalType,
    rawEvidence: (s.rawEvidence ?? {}) as Record<string, unknown>,
  }));
  const alertType = classifyAlertType(explainerSignals);
  const signalIds = activeSignals.map((s) => s.id);
  const createdAlertIds: string[] = [];

  // Creation-guard input: the most severe unread alert per guardian from
  // the last 24h, fetched in one query (not per-guardian — avoids N+1).
  const recentUnread = await prisma.guardianAlert.findMany({
    where: { patientId, readAt: null, createdAt: { gte: new Date(now.getTime() - dayMs) } },
    select: { guardianId: true, severity: true },
  });
  const coveredRankByGuardian = new Map<string, number>();
  for (const a of recentUnread) {
    const rank = SEVERITY_RANK[a.severity];
    if (rank > (coveredRankByGuardian.get(a.guardianId) ?? 0)) {
      coveredRankByGuardian.set(a.guardianId, rank);
    }
  }

  for (const guardian of group.guardians) {
    // Creation-guard: the cron runs daily, so a patient who stays in the
    // same band would otherwise get a fresh alert every day. Skip when an
    // unread alert of equal-or-higher severity already exists from the
    // last 24h — a genuine escalation (yellow → orange) still gets through.
    const coveredRank = coveredRankByGuardian.get(guardian.guardianId) ?? 0;
    if (coveredRank >= SEVERITY_RANK[risk.severity]) {
      logger.debug(
        { patientId, guardianId: guardian.guardianId },
        "silent-guardian-analyze: recent unread alert covers this — skipping creation",
      );
      continue;
    }

    const content = buildAlertContent({
      signals: explainerSignals,
      patientName: group.patientName,
      language: guardian.language,
    });
    const alert = await prisma.guardianAlert.create({
      data: {
        patientId,
        guardianId: guardian.guardianId,
        alertType,
        riskScore: risk.totalScore,
        severity: risk.severity,
        title: content.title,
        summary: content.summary,
        details: {
          riskScore: risk.totalScore,
          signalCount: activeSignals.length,
          sources: activeSignals.map((s) => s.signalSource),
        },
        explanation: content.explanation,
        suggestedAction: content.suggestedAction,
        signalIds,
      },
    });
    createdAlertIds.push(alert.id);
    capture("silent_guardian_alert_created", patientId, {
      severity: risk.severity,
      type: alertType,
      signal_count: activeSignals.length,
    });
    // Hand the alert to the dispatch worker. While
    // `silent_guardian_alerts_dispatch` is off the worker no-ops, so
    // this is safe to wire unconditionally — the alert simply stays
    // in-app until delivery is enabled.
    await enqueueGuardianAlertDispatch(alert.id);
  }

  // Link the contributing signals back to the alert they fed (audit
  // trail). Only the first alert id is recorded when several guardians
  // are linked; a signal is consumed once.
  const firstAlertId = createdAlertIds[0];
  if (firstAlertId !== undefined) {
    await prisma.silentGuardianSignal.updateMany({
      where: { id: { in: signalIds }, consumedByAlert: null },
      data: { consumedByAlert: firstAlertId },
    });
  }

  return createdAlertIds.length;
};

// ── batch entry point ───────────────────────────────────────────────

export const processSilentGuardianAnalyze = async (
  _job: Job<SilentGuardianAnalyzeJob>,
): Promise<void> => {
  const enabled = await getFlag<boolean>("silent_guardian_enabled", false);
  if (!enabled) {
    logger.info("silent-guardian-analyze: disabled by flag — skipping run");
    return;
  }

  const now = new Date();

  // Every accepted, alert-enabled link, grouped by patient. A patient
  // with no guardian is never analysed — there is no one to alert.
  const links = await prisma.familyLink.findMany({
    where: { status: "accepted", alertEnabled: true },
    select: {
      patientId: true,
      guardianId: true,
      patient: { select: { name: true } },
      guardian: { select: { preferredLanguage: true } },
    },
  });

  const groups = new Map<string, PatientGroup>();
  for (const link of links) {
    let group = groups.get(link.patientId);
    if (!group) {
      group = { patientId: link.patientId, patientName: link.patient.name, guardians: [] };
      groups.set(link.patientId, group);
    }
    group.guardians.push({
      guardianId: link.guardianId,
      language: link.guardian.preferredLanguage,
    });
  }

  let processed = 0;
  let alertsCreated = 0;
  let failures = 0;
  for (const group of groups.values()) {
    try {
      alertsCreated += await analyzePatient(group, now);
      processed += 1;
    } catch (err) {
      failures += 1;
      logger.error({ err, patientId: group.patientId }, "silent-guardian-analyze: patient failed");
      captureUnhandled(err, {
        worker: "silent-guardian-analyze",
        patientId: group.patientId,
      });
    }
  }

  logger.info(
    { patients: groups.size, processed, alertsCreated, failures },
    "silent-guardian-analyze batch complete",
  );
};
