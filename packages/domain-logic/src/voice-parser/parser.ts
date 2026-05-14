import {
  GLUCOSE_CRITICAL_HIGH,
  GLUCOSE_CRITICAL_LOW,
  GLUCOSE_VALID_MAX,
  GLUCOSE_VALID_MIN,
  type GlucoseReadingType,
} from "@swasth/shared-types";
import {
  FASTING_KEYWORDS,
  HINDI_COLLOQUIAL,
  INTENT_KEYWORDS,
  NEGATED_INTENT,
  PAST_INDICATORS,
  POST_MEAL_KEYWORDS,
  PRESENT_INDICATORS,
  UNCERTAINTY_WORDS,
} from "./dictionary.js";
import type { NumberCandidate, VoiceParseInput, VoiceParseResult } from "./types.js";

const CONFIDENCE_THRESHOLD = 0.6;

const containsAny = (haystack: string, needles: readonly string[]): boolean =>
  needles.some((n) => haystack.includes(n));

const findFirstIndexOfAny = (haystack: string, needles: readonly string[]): number => {
  let min = -1;
  for (const n of needles) {
    const idx = haystack.indexOf(n);
    if (idx !== -1 && (min === -1 || idx < min)) min = idx;
  }
  return min;
};

const extractColloquial = (text: string): { candidates: NumberCandidate[]; remaining: string } => {
  const out: NumberCandidate[] = [];
  const phrasesByLength = [...HINDI_COLLOQUIAL.entries()].sort((a, b) => b[0].length - a[0].length);
  let remaining = text;
  for (const [phrase, value] of phrasesByLength) {
    if (remaining.includes(phrase)) {
      out.push({ value, recommended: false, source: "colloquial" });
      remaining = remaining.split(phrase).join(" ");
    }
  }
  return { candidates: out, remaining };
};

const extractDigits = (text: string): NumberCandidate[] => {
  const matches = text.match(/\b\d{2,3}\b/g) ?? [];
  return matches.map((m) => ({ value: Number(m), recommended: false, source: "digit" as const }));
};

const inferTypeFromClock = (hour: number): { type: GlucoseReadingType; uncertain: boolean } => {
  if (hour >= 6 && hour < 10) return { type: "fasting", uncertain: false };
  if (hour >= 12 && hour < 14) return { type: "post_meal", uncertain: false };
  if (hour >= 19 && hour < 21) return { type: "post_meal", uncertain: false };
  return { type: "random", uncertain: true };
};

const inferTypeFromKeywords = (text: string): GlucoseReadingType | null => {
  if (containsAny(text, POST_MEAL_KEYWORDS)) return "post_meal";
  if (containsAny(text, FASTING_KEYWORDS)) return "fasting";
  return null;
};

const rankCandidates = (cands: NumberCandidate[], text: string): NumberCandidate[] => {
  if (cands.length === 0) return cands;
  const intentIdx = findFirstIndexOfAny(text, INTENT_KEYWORDS);
  if (intentIdx === -1) {
    const ranked = [...cands];
    ranked[0] = { ...ranked[0]!, recommended: true };
    return ranked;
  }
  const scored = cands.map((c) => {
    const idx = text.indexOf(String(c.value));
    const distance = idx === -1 ? Number.MAX_SAFE_INTEGER : Math.abs(idx - intentIdx);
    return { c, distance };
  });
  scored.sort((a, b) => a.distance - b.distance);
  return scored.map(({ c }, i) => ({ ...c, recommended: i === 0 }));
};

export const parseVoiceTranscript = (input: VoiceParseInput): VoiceParseResult => {
  const text = input.transcript.toLowerCase().trim();
  if (!text) return { kind: "rejected", reason: "no_number" };

  const hasPresent = containsAny(text, PRESENT_INDICATORS);
  const hasPast = containsAny(text, PAST_INDICATORS);
  const hasNegated = containsAny(text, NEGATED_INTENT);

  if (hasNegated) return { kind: "rejected", reason: "negated_intent" };
  if (hasPast && !hasPresent) return { kind: "rejected", reason: "past_tense_only" };

  const { candidates: colloquial, remaining } = extractColloquial(text);
  const digits = extractDigits(remaining);
  const merged = [...colloquial, ...digits];
  if (merged.length === 0) return { kind: "rejected", reason: "no_number" };

  const ranked = rankCandidates(merged, text);
  const chosen = ranked.find((c) => c.recommended) ?? ranked[0]!;
  const value = chosen.value;

  if (value < GLUCOSE_VALID_MIN || value > GLUCOSE_VALID_MAX) {
    return { kind: "rejected", reason: "out_of_range" };
  }

  const keywordType = inferTypeFromKeywords(text);
  const clockInferred = inferTypeFromClock(input.capturedAtHourLocal);
  const readingType = keywordType ?? clockInferred.type;
  const requiresTypeConfirmation = keywordType === null && clockInferred.uncertain;

  const uncertaintyDetected = containsAny(text, UNCERTAINTY_WORDS);
  const requiresStrongConfirmation = uncertaintyDetected || input.confidence < CONFIDENCE_THRESHOLD;
  const requiresDoubleConfirmation = value < GLUCOSE_CRITICAL_LOW || value > GLUCOSE_CRITICAL_HIGH;

  return {
    kind: "ok",
    value,
    candidates: ranked,
    readingType,
    requiresTypeConfirmation,
    requiresStrongConfirmation,
    requiresDoubleConfirmation,
    uncertaintyDetected,
    colloquialMatch: colloquial.length > 0,
  };
};
