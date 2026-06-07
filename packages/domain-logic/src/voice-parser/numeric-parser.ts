// Phase 4 Feature E — generic numeric voice transcript parser.
//
// The glucose parser (`parser.ts`) is reading-type-aware (it has to
// disambiguate fasting vs. post-meal from clock + keywords). Cardiac
// (HR in bpm) and respiratory (peak flow in L/min) have no analogous
// type axis — there is one number, one unit, one reading. So those
// surfaces share this simpler numeric parser, parameterised over the
// intent keywords and valid range.
//
// Helpers (containsAnyWord, extractDigits, extractColloquial,
// rankCandidates) are deliberately duplicated from `parser.ts` rather
// than extracted to a shared module. Glucose is the safety-critical
// path that ships today; isolating the new code keeps a regression
// in the cardiac/respiratory parser from touching glucose tests. A
// follow-up `chore/voice-helpers` can extract the common surface
// once both paths have stabilised in production.
//
// The colloquial Hindi number dictionary IS shared — same "sava sau"
// means 125 whether the patient is reporting glucose, HR, or peak
// flow.

import {
  NEGATED_INTENT,
  PAST_INDICATORS,
  PRESENT_INDICATORS,
  HINDI_COLLOQUIAL,
  UNCERTAINTY_WORDS,
} from "./dictionary.js";
import type { NumberCandidate } from "./types.js";

const CONFIDENCE_THRESHOLD = 0.6;

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
  // Allow up to 3-digit integers — fits all medical numeric surfaces
  // we currently care about (HR 30-250, peak flow 50-800, glucose
  // 20-600). 2-digit floor keeps stray single-digit "1" or "2" inside
  // unrelated sentences from polluting candidates.
  const matches = text.match(/\b\d{2,3}\b/g) ?? [];
  return matches.map((m) => ({ value: Number(m), recommended: false, source: "digit" as const }));
};

const rankCandidates = (
  cands: NumberCandidate[],
  text: string,
  intentKeywords: readonly string[],
): { ranked: NumberCandidate[]; hasIntent: boolean } => {
  if (cands.length === 0) return { ranked: cands, hasIntent: false };
  const intentIdx = findFirstIndexOfAnyWord(text, intentKeywords);
  if (intentIdx === -1) {
    return { ranked: cands, hasIntent: false };
  }
  // CLAUDE.md: "Prioritize numbers AFTER intent keywords."
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

// ─────────────────────────────────────────────────────────────
// Public surface
// ─────────────────────────────────────────────────────────────

export interface NumericVoiceParseInput {
  transcript: string;
  confidence: number;
  /**
   * Intent keywords (in lower-case ASCII) that ground a number as
   * the actual reading. Order does not matter; presence does.
   */
  intentKeywords: readonly string[];
  /**
   * Valid range — values outside [min, max] reject with `out_of_range`.
   * Use the matching `*_VALID_MIN` / `*_VALID_MAX` constants from
   * `@swasth/shared-types`.
   */
  validRange: { min: number; max: number };
}

/**
 * Result shape. Mirrors `VoiceParseResult` minus the reading-type axis.
 * The mobile surface maps `ok` to the confirmation screen and `rejected`
 * to a "didn't catch that, try the numpad" fallback.
 */
export type NumericVoiceParseResult =
  | {
      kind: "ok";
      value: number;
      candidates: NumberCandidate[];
      /**
       * Confidence < 0.6 — service-layer must force a stronger
       * confirmation step before the value persists.
       */
      requiresStrongConfirmation: boolean;
      /**
       * Hindi-style uncertainty hedging detected ("shayad", "lagbhag",
       * etc.). Even at high speech confidence the patient flagged the
       * number themselves as approximate.
       */
      uncertaintyDetected: boolean;
      /**
       * True when the winning candidate came out of the Hindi
       * colloquial dictionary ("sava sau") rather than a raw digit.
       * Surfaced for PostHog so we can see dictionary coverage.
       */
      colloquialMatch: boolean;
    }
  | {
      kind: "rejected";
      reason: "no_number" | "past_tense_only" | "negated_intent" | "out_of_range" | "no_intent";
    };

/**
 * Pure numeric-voice parser. Same gate sequence as the glucose parser:
 * empty → no_number, negation → negated_intent, past-tense-without-
 * present → past_tense_only, no intent keyword → no_intent, no number →
 * no_number, value outside range → out_of_range. Otherwise `ok` with
 * the highest-ranked candidate.
 */
export const parseNumericVoiceTranscript = (
  input: NumericVoiceParseInput,
): NumericVoiceParseResult => {
  const text = input.transcript.toLowerCase().trim();
  if (!text) return { kind: "rejected", reason: "no_number" };

  const hasPresent = containsAnyWord(text, PRESENT_INDICATORS);
  const hasPast = containsAnyWord(text, PAST_INDICATORS);
  const hasNegated = containsAny(text, NEGATED_INTENT);

  if (hasNegated) return { kind: "rejected", reason: "negated_intent" };
  if (hasPast && !hasPresent) return { kind: "rejected", reason: "past_tense_only" };

  const { candidates: colloquial, remaining } = extractColloquial(text);
  const digits = extractDigits(remaining);
  const merged = [...colloquial, ...digits];
  if (merged.length === 0) return { kind: "rejected", reason: "no_number" };

  const { ranked, hasIntent } = rankCandidates(merged, text, input.intentKeywords);
  if (!hasIntent) return { kind: "rejected", reason: "no_intent" };

  const winner = ranked[0];
  if (!winner) return { kind: "rejected", reason: "no_number" };

  if (winner.value < input.validRange.min || winner.value > input.validRange.max) {
    return { kind: "rejected", reason: "out_of_range" };
  }

  const requiresStrongConfirmation = input.confidence < CONFIDENCE_THRESHOLD;
  const uncertaintyDetected = containsAnyWord(text, UNCERTAINTY_WORDS);
  const colloquialMatch = winner.source === "colloquial";

  return {
    kind: "ok",
    value: winner.value,
    candidates: ranked,
    requiresStrongConfirmation,
    uncertaintyDetected,
    colloquialMatch,
  };
};
