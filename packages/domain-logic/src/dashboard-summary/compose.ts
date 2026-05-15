// Phase 2 step 6 — `composeDashboardSummary`. Rule-based, pure-function
// translator from "today's data" → "Aaj ka din: …" sentence.
//
// Why rule-based, not Claude (per PROGRESS.md "Architectural decisions
// locked-in"): Phase 3 owns AI chat; the dashboard summary fires on
// every load, so latency + cost must be zero. Templates also keep the
// medical messaging consistent — no chance of Claude inventing a
// glucose reading or suggesting medication.
//
// Output structure:
//   • `headline` — one sentence, always present.
//   • `details` — 0-3 short lines (glucose, BP, trend). Empty when
//     there's nothing useful to say.
//
// The composition follows a fixed priority:
//   1. Cold start (< 7 days)  → reassuring "keep going" copy.
//   2. No readings today       → gentle "kya aaj log kiya?" prompt.
//   3. Critical value          → safety-first sentence (no celebration).
//   4. Normal day              → headline + details from the snapshot.
//
// All copy lives behind the language switch — Hindi-first per CLAUDE.md,
// English fallback for the language toggle.

import { mean } from "../detectors/stats.js";
import type { DashboardGlucoseReading, DashboardSummary, DashboardSummaryInput } from "./types.js";

const GLUCOSE_CRITICAL_LOW = 65;
const GLUCOSE_CRITICAL_HIGH = 315;
const COLD_START_DAYS = 7;
const BP_HIGH_SYSTOLIC = 140;
const BP_HIGH_DIASTOLIC = 90;
const FASTING_DELTA_NOTABLE = 10;

const formatGlucose = (type: DashboardGlucoseReading["readingType"], hindi: boolean): string => {
  if (hindi) {
    return type === "fasting"
      ? "Fasting"
      : type === "post_meal"
        ? "Post-meal"
        : type === "pre_meal"
          ? "Pre-meal"
          : type === "bedtime"
            ? "Soney se pehle"
            : "Random";
  }
  return type === "fasting"
    ? "Fasting"
    : type === "post_meal"
      ? "Post-meal"
      : type === "pre_meal"
        ? "Pre-meal"
        : type === "bedtime"
          ? "Bedtime"
          : "Random";
};

const coldStartSummary = (hindi: boolean, days: number): DashboardSummary => {
  const headline = hindi
    ? days === 0
      ? "Swagat hai! Pehli reading ke saath shuruaat karein."
      : `${days} din ho gaye — aap behtar kar rahe hain 💪`
    : days === 0
      ? "Welcome! Start by logging your first reading."
      : `${days} day${days === 1 ? "" : "s"} in — you're doing great 💪`;
  return {
    headline,
    details: [],
    language: hindi ? "hi" : "en",
    coldStart: true,
  };
};

const noReadingsSummary = (hindi: boolean, streak: number): DashboardSummary => {
  const headline = hindi
    ? streak > 0
      ? `${streak} din ki streak — aaj ki reading log karein?`
      : "Aaj ki pehli reading log karein?"
    : streak > 0
      ? `${streak}-day streak — log today's reading?`
      : "Log today's first reading?";
  return { headline, details: [], language: hindi ? "hi" : "en", coldStart: false };
};

const criticalSentence = (
  value: number,
  type: DashboardGlucoseReading["readingType"],
  hindi: boolean,
): string => {
  if (value < GLUCOSE_CRITICAL_LOW) {
    return hindi
      ? `⚠️ Sugar bahut kam (${formatGlucose(type, true)}: ${value}). Doctor se baat karein.`
      : `⚠️ Glucose very low (${formatGlucose(type, false)}: ${value}). Call your doctor.`;
  }
  return hindi
    ? `⚠️ Sugar bahut zyada (${formatGlucose(type, true)}: ${value}). Doctor se baat karein.`
    : `⚠️ Glucose very high (${formatGlucose(type, false)}: ${value}). Call your doctor.`;
};

const glucoseDetail = (
  todayGlucose: readonly DashboardGlucoseReading[],
  hindi: boolean,
): string | null => {
  if (todayGlucose.length === 0) return null;
  // Lead with the most-recent reading — the most actionable signal.
  const sorted = [...todayGlucose].sort(
    (a, b) => new Date(b.measuredAt).getTime() - new Date(a.measuredAt).getTime(),
  );
  const latest = sorted[0]!;
  const label = formatGlucose(latest.readingType, hindi);
  const tone = hindi
    ? latest.valueMgDl > 200
      ? "thoda zyada"
      : latest.valueMgDl < 80
        ? "thoda kam"
        : "thik hai"
    : latest.valueMgDl > 200
      ? "a bit high"
      : latest.valueMgDl < 80
        ? "a bit low"
        : "looking good";
  return hindi
    ? `Sugar ${tone} (${label}: ${latest.valueMgDl})`
    : `Glucose ${tone} (${label}: ${latest.valueMgDl})`;
};

const bpDetail = (
  todayBp: readonly DashboardSummaryInput["todayBp"][number][],
  hindi: boolean,
): string | null => {
  if (todayBp.length === 0) return null;
  const sorted = [...todayBp].sort(
    (a, b) => new Date(b.measuredAt).getTime() - new Date(a.measuredAt).getTime(),
  );
  const latest = sorted[0]!;
  const isHigh = latest.systolic >= BP_HIGH_SYSTOLIC || latest.diastolic >= BP_HIGH_DIASTOLIC;
  const tone = isHigh
    ? hindi
      ? "thoda zyada"
      : "a bit elevated"
    : hindi
      ? "thik hai"
      : "looking good";
  return hindi
    ? `BP ${tone} (${latest.systolic}/${latest.diastolic})`
    : `BP ${tone} (${latest.systolic}/${latest.diastolic})`;
};

// "Kal se behtar" line: only emit if we have ≥ 1 fasting today AND
// ≥ 1 fasting yesterday so the comparison is meaningful.
const trendDetail = (
  todayGlucose: readonly DashboardGlucoseReading[],
  yesterdayFasting: readonly DashboardGlucoseReading[],
  hindi: boolean,
): string | null => {
  const todayFasting = todayGlucose.filter((r) => r.readingType === "fasting");
  if (todayFasting.length === 0 || yesterdayFasting.length === 0) return null;
  const todayMean = mean(todayFasting.map((r) => r.valueMgDl));
  const yMean = mean(yesterdayFasting.map((r) => r.valueMgDl));
  const delta = todayMean - yMean;
  if (Math.abs(delta) < FASTING_DELTA_NOTABLE) {
    return hindi ? "Kal jaisa hi" : "Similar to yesterday";
  }
  if (delta < 0) {
    return hindi ? "Kal se behtar" : "Better than yesterday";
  }
  return hindi ? "Kal se thoda zyada" : "A bit higher than yesterday";
};

export const composeDashboardSummary = (input: DashboardSummaryInput): DashboardSummary => {
  const hindi = input.language === "hi";

  // 1. Cold start — < 7 days. Keep the messaging encouraging; the user
  //    hasn't earned a real summary yet.
  if (input.userStageDays < COLD_START_DAYS) {
    return coldStartSummary(hindi, input.userStageDays);
  }

  // 2. No readings today — gentle prompt, never guilt.
  if (input.todayGlucose.length === 0 && input.todayBp.length === 0) {
    return noReadingsSummary(hindi, input.currentStreakDays);
  }

  // 3. Critical value short-circuits everything else. The full critical
  //    bypass chain has already fired by the time the dashboard renders;
  //    this is the residual reminder.
  for (const r of input.todayGlucose) {
    if (r.valueMgDl < GLUCOSE_CRITICAL_LOW || r.valueMgDl > GLUCOSE_CRITICAL_HIGH) {
      return {
        headline: criticalSentence(r.valueMgDl, r.readingType, hindi),
        details: [],
        language: hindi ? "hi" : "en",
        coldStart: false,
      };
    }
  }

  // 4. Normal day — assemble headline + details.
  const headline = hindi
    ? input.healthScore !== null
      ? `Aaj ka din: Score ${input.healthScore.score}/100`
      : "Aaj ka din"
    : input.healthScore !== null
      ? `Today: Score ${input.healthScore.score}/100`
      : "Today";

  const details: string[] = [];
  const g = glucoseDetail(input.todayGlucose, hindi);
  if (g !== null) details.push(g);
  const b = bpDetail(input.todayBp, hindi);
  if (b !== null) details.push(b);
  const t = trendDetail(input.todayGlucose, input.yesterdayFasting, hindi);
  if (t !== null) details.push(t);

  return {
    headline,
    details,
    language: hindi ? "hi" : "en",
    coldStart: false,
  };
};
