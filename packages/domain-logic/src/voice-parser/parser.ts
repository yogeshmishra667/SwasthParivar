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

// Word-boundary matchers. The earlier implementation used naive
// `text.includes(needle)`, which matched "tha" inside "thank you" and
// "kal" inside "Kalpana" — both produced false past-tense rejections.
// We treat ASCII whitespace + common punctuation + Devanagari space as
// boundaries. The Devanagari dictionary entries already are full
// phrases, not roots, so substring-on-them is safe; the risk is only on
// ASCII transliterations.
const WORD_BOUNDARY = /[\s.,!?'"()[\]{}\-—]/;

const isStandalone = (haystack: string, needle: string, idx: number): boolean => {
  const before = idx === 0 ? "" : haystack[idx - 1]!;
  const after = idx + needle.length >= haystack.length ? "" : haystack[idx + needle.length]!;
  const okBefore = before === "" || WORD_BOUNDARY.test(before);
  const okAfter = after === "" || WORD_BOUNDARY.test(after);
  return okBefore && okAfter;
};

const containsAnyWord = (haystack: string, needles: readonly string[]): boolean => {
  for (const n of needles) {
    let idx = haystack.indexOf(n);
    while (idx !== -1) {
      if (isStandalone(haystack, n, idx)) return true;
      idx = haystack.indexOf(n, idx + 1);
    }
  }
  return false;
};

// `containsAny` (substring) is kept for the colloquial dictionary —
// the entries there are multi-word phrases (e.g. "sava sau", "do sau")
// and want substring matching, not word matching. Past/present/intent
// detectors should use containsAnyWord.
const containsAny = (haystack: string, needles: readonly string[]): boolean =>
  needles.some((n) => haystack.includes(n));

const findFirstIndexOfAnyWord = (haystack: string, needles: readonly string[]): number => {
  let min = -1;
  for (const n of needles) {
    let idx = haystack.indexOf(n);
    while (idx !== -1) {
      if (isStandalone(haystack, n, idx)) {
        if (min === -1 || idx < min) min = idx;
        break;
      }
      idx = haystack.indexOf(n, idx + 1);
    }
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

// Returns the ranked candidates if an intent keyword grounds them, or
// null when there's no intent in the transcript at all (CLAUDE.md:
// "TV/radio numbers without intent → ignore"). The caller decides
// whether absent-intent is a rejection or just "first candidate wins";
// this function only reports what it found.
const rankCandidates = (
  cands: NumberCandidate[],
  text: string,
): { ranked: NumberCandidate[]; hasIntent: boolean } => {
  if (cands.length === 0) return { ranked: cands, hasIntent: false };
  const intentIdx = findFirstIndexOfAnyWord(text, INTENT_KEYWORDS);
  if (intentIdx === -1) {
    return { ranked: cands, hasIntent: false };
  }
  // CLAUDE.md: "Prioritize numbers AFTER intent keywords."
  // Hindi/Hinglish utterance pattern is "<intent> <value>", so a number
  // appearing before the intent keyword ("address 220, sugar 145 hai")
  // is structurally LESS likely to be the reading. Score asymmetrically:
  // after-intent numbers always rank above before-intent numbers, then
  // break ties by distance.
  const BEFORE_PENALTY = 10_000;
  const scored = cands.map((c) => {
    const idx = text.indexOf(String(c.value));
    let distance: number;
    if (idx === -1) {
      distance = Number.MAX_SAFE_INTEGER;
    } else if (idx >= intentIdx) {
      distance = idx - intentIdx;
    } else {
      distance = BEFORE_PENALTY + (intentIdx - idx);
    }
    return { c, distance };
  });
  scored.sort((a, b) => a.distance - b.distance);
  return {
    ranked: scored.map(({ c }, i) => ({ ...c, recommended: i === 0 })),
    hasIntent: true,
  };
};

export const parseVoiceTranscript = (input: VoiceParseInput): VoiceParseResult => {
  const text = input.transcript.toLowerCase().trim();
  if (!text) return { kind: "rejected", reason: "no_number" };

  // Word-boundary matching here — `text.includes("tha")` matched
  // "thank you" and falsely rejected past-tense; `text.includes("kal")`
  // matched "Kalpana" similarly. NEGATED_INTENT entries are multi-word
  // ("nahi ki", "check nahi") and want substring matching, but the
  // single-word past/present indicators get word-boundary checks.
  const hasPresent = containsAnyWord(text, PRESENT_INDICATORS);
  const hasPast = containsAnyWord(text, PAST_INDICATORS);
  const hasNegated = containsAny(text, NEGATED_INTENT);

  if (hasNegated) return { kind: "rejected", reason: "negated_intent" };
  if (hasPast && !hasPresent) return { kind: "rejected", reason: "past_tense_only" };

  const { candidates: colloquial, remaining } = extractColloquial(text);
  const digits = extractDigits(remaining);
  const merged = [...colloquial, ...digits];
  if (merged.length === 0) return { kind: "rejected", reason: "no_number" };

  const { ranked, hasIntent } = rankCandidates(merged, text);
  // CLAUDE.md: "TV/radio numbers without intent → ignore."
  // No intent keyword in the transcript = background noise; refuse to
  // suggest a value. The mobile UI is expected to fall back to numpad
  // when it sees this rejection.
  if (!hasIntent) return { kind: "rejected", reason: "no_intent" };

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

// (`containsAny` is still referenced for NEGATED_INTENT above. Kept the
// export-free declaration to avoid an unused-var lint trip if the
// matcher set changes later.)
