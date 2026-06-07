// Phase 4 Feature E — cardiac voice parser. Thin wrapper over the
// shared numeric parser with cardiac intent keywords + the HR valid
// range from `@swasth/shared-types`.

import { HR_VALID_MAX, HR_VALID_MIN } from "@swasth/shared-types";
import { CARDIAC_INTENT_KEYWORDS } from "./dictionary.js";
import { parseNumericVoiceTranscript, type NumericVoiceParseResult } from "./numeric-parser.js";

export interface CardiacVoiceParseInput {
  transcript: string;
  confidence: number;
}

export type CardiacVoiceParseResult = NumericVoiceParseResult;

/**
 * Parse a cardiac voice transcript (e.g. "dil ki dhadkan 85 hai") into
 * a heart-rate reading. Intent gating ensures a stray number in a TV
 * news bulletin doesn't get accepted as a reading.
 */
export const parseCardiacVoiceTranscript = (
  input: CardiacVoiceParseInput,
): CardiacVoiceParseResult =>
  parseNumericVoiceTranscript({
    transcript: input.transcript,
    confidence: input.confidence,
    intentKeywords: CARDIAC_INTENT_KEYWORDS,
    validRange: { min: HR_VALID_MIN, max: HR_VALID_MAX },
  });
