// guardian-alert-explainer — turns a set of signals into the Hindi-first
// guardian-facing copy stored on a GuardianAlert. Pure and deterministic.
//
// SAFETY — verbatim-content / PII protection (phase3.md C.2.4):
// the output is TEMPLATE-ONLY. The single free-text value allowed into
// the copy is `patientName`. Everything else interpolated is a NUMBER
// derived from evidence, or a fixed dictionary word. A raw string field
// from `rawEvidence` (a medicine name, a chat fragment, anything) is
// NEVER echoed. The guardian-alert-explainer property test asserts this
// across 1000 random inputs.

import type { GuardianAlertType } from "@swasth/shared-types";
import type {
  AlertContent,
  AlertContentInput,
  AlertContentSignal,
  AlertLanguage,
} from "./types.js";

// ---------------------------------------------------------------------
// Alert-type classification (also used by the service to set
// GuardianAlert.alertType and to feed the deduper).
// ---------------------------------------------------------------------

// Phase 4 §C' mapping: new sources collapse onto the 3 existing
// GuardianAlertType values so the copy banks stay unchanged.
//   schedule_miss  → med_adherence  (missed checks = non-adherence)
//   chat_sentiment → trend_concern  (emotional concern, no med angle)
//   activity_drop  → trend_concern  (lifestyle-based concern)
//   cross_signal   → combined       (multiple sources stacking)
export const classifyAlertType = (
  signals: readonly Pick<AlertContentSignal, "source">[],
): GuardianAlertType => {
  const hasMed = signals.some((s) => s.source === "med_adherence" || s.source === "schedule_miss");
  const hasTrend = signals.some(
    (s) =>
      s.source === "data_anomaly" || s.source === "chat_sentiment" || s.source === "activity_drop",
  );
  const hasStack = signals.some((s) => s.source === "cross_signal");
  if ((hasMed && hasTrend) || hasStack) return "combined";
  if (hasMed) return "med_adherence";
  return "trend_concern";
};

// ---------------------------------------------------------------------
// Numeric fact extraction — NUMBERS ONLY, never strings.
// ---------------------------------------------------------------------

type ReadingTypeKey = "fasting" | "post_meal" | "general";

interface AlertFacts {
  missedCount: number; // total missed doses across med-adherence signals
  windowDays: number; // analysis window length
  slopePerDay: number; // worst (largest) rising slope, mg/dL/day, rounded
  readingTypeKey: ReadingTypeKey; // mapped to a fixed key, never echoed raw
}

const readNumber = (rec: Readonly<Record<string, unknown>>, key: string): number | null => {
  const v = rec[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

// Map a raw reading-type string to a fixed key. An unrecognised value
// collapses to "general" — the raw string never reaches the output.
const toReadingTypeKey = (raw: unknown): ReadingTypeKey => {
  if (raw === "fasting") return "fasting";
  if (raw === "post_meal") return "post_meal";
  return "general";
};

const extractFacts = (signals: readonly AlertContentSignal[]): AlertFacts => {
  let missedCount = 0;
  let windowDays = 7;
  let worstSlope = 0;
  let readingTypeKey: ReadingTypeKey = "general";

  for (const s of signals) {
    if (s.source === "med_adherence") {
      const m = readNumber(s.rawEvidence, "missedCount");
      if (m !== null) missedCount += Math.max(0, Math.trunc(m));
      const w = readNumber(s.rawEvidence, "windowDays");
      if (w !== null && w > 0) windowDays = Math.trunc(w);
    } else if (s.source === "schedule_miss") {
      // schedule_miss is non-adherence — add the missed slot count to the
      // same missedCount field so the "med_adherence" copy template
      // reflects the full non-adherence picture.
      const m = readNumber(s.rawEvidence, "missedSlots");
      if (m !== null) missedCount += Math.max(0, Math.trunc(m));
    } else if (s.source === "data_anomaly" || s.source === "activity_drop") {
      const slope = readNumber(s.rawEvidence, "slopePerDay");
      if (slope !== null && Math.abs(slope) > Math.abs(worstSlope)) {
        worstSlope = slope;
        readingTypeKey = toReadingTypeKey(s.rawEvidence.readingType);
      }
    }
    // chat_sentiment and cross_signal carry no numeric facts useful in
    // the copy template — they influence classifyAlertType but not the
    // sentence-level facts.
  }

  return {
    missedCount,
    windowDays,
    slopePerDay: Math.round(Math.abs(worstSlope) * 10) / 10,
    readingTypeKey,
  };
};

// ---------------------------------------------------------------------
// Copy banks. CLAUDE.md and the phase3.md mockups use romanised
// Hinglish for every patient/guardian-facing string, so `hi` and
// `hi-en` resolve to the same Hinglish bank; `en` resolves to English.
// A Devanagari bank, if ever needed, slots in here without touching
// callers.
// ---------------------------------------------------------------------

type Bank = "hinglish" | "english";

const resolveBank = (language: AlertLanguage): Bank => (language === "en" ? "english" : "hinglish");

const READING_TYPE_WORD: Record<Bank, Record<ReadingTypeKey, string>> = {
  hinglish: { fasting: "khaali-pet", post_meal: "khaane-ke-baad", general: "sugar" },
  english: { fasting: "fasting", post_meal: "post-meal", general: "glucose" },
};

const buildHinglish = (type: GuardianAlertType, f: AlertFacts, name: string): AlertContent => {
  const rt = READING_TYPE_WORD.hinglish[f.readingTypeKey];
  switch (type) {
    case "med_adherence":
      return {
        title: "Dawai chhoot rahi hai",
        summary: `${name} ne pichhle hafte ${f.missedCount} baar dawai nahi li.`,
        explanation: `Pichhle ${f.windowDays} dino mein ${name} ne dawai ${f.missedCount} baar skip ki. Dawai niyamit lena zaroori hai.`,
        suggestedAction:
          "Phone karke baat karein. Dawai ka time yaad dilaayein. Achanak dawai band na karne dein.",
      };
    case "trend_concern":
      return {
        title: "Sugar badh raha hai",
        summary: `${name} ki ${rt} sugar dheere-dheere badh rahi hai.`,
        explanation: `${name} ki ${rt} reading roz lagbhag ${f.slopePerDay} mg/dL badh rahi hai. Yeh pichhle hafte ka pattern hai.`,
        suggestedAction:
          "Phone karke haal poochein. Khaan-paan aur dawai ke baare mein baat karein. Zaroorat ho to doctor se milne ki salah dein.",
      };
    case "combined":
      return {
        title: "Dhyaan dene ki zaroorat hai",
        summary: `${name} ki dawai chhoot rahi hai aur ${rt} sugar bhi badh rahi hai.`,
        explanation: `${name} ne pichhle ${f.windowDays} dino mein dawai ${f.missedCount} baar skip ki, aur ${rt} sugar roz lagbhag ${f.slopePerDay} mg/dL badh rahi hai.`,
        suggestedAction:
          "Phone karke baat karein. Dawai aur khaan-paan dono par dhyaan dein. Doctor se milne ki salah dein.",
      };
  }
};

const buildEnglish = (type: GuardianAlertType, f: AlertFacts, name: string): AlertContent => {
  const rt = READING_TYPE_WORD.english[f.readingTypeKey];
  switch (type) {
    case "med_adherence":
      return {
        title: "Medication is being missed",
        summary: `${name} missed ${f.missedCount} dose(s) of medication last week.`,
        explanation: `Over the last ${f.windowDays} days ${name} skipped medication ${f.missedCount} time(s). Taking it regularly matters.`,
        suggestedAction:
          "Call and check in. Remind them of the dose timing. Make sure they do not stop the medicine abruptly.",
      };
    case "trend_concern":
      return {
        title: "Sugar is trending up",
        summary: `${name}'s ${rt} sugar is slowly rising.`,
        explanation: `${name}'s ${rt} reading is rising by about ${f.slopePerDay} mg/dL per day — a pattern over the last week.`,
        suggestedAction:
          "Call and check in. Talk about diet and medication. Suggest seeing the doctor if needed.",
      };
    case "combined":
      return {
        title: "Needs attention",
        summary: `${name} is missing medication and ${rt} sugar is also rising.`,
        explanation: `Over the last ${f.windowDays} days ${name} skipped medication ${f.missedCount} time(s), and ${rt} sugar is rising by about ${f.slopePerDay} mg/dL per day.`,
        suggestedAction:
          "Call and check in. Watch both medication and diet. Suggest seeing the doctor.",
      };
  }
};

export const buildAlertContent = (input: AlertContentInput): AlertContent => {
  const alertType = classifyAlertType(input.signals);
  const facts = extractFacts(input.signals);
  return resolveBank(input.language) === "english"
    ? buildEnglish(alertType, facts, input.patientName)
    : buildHinglish(alertType, facts, input.patientName);
};
