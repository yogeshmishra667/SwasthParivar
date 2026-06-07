// Phase 4 Feature E — respiratory voice parser. Thin wrapper over the
// shared numeric parser with respiratory intent keywords + the peak-
// flow valid range from `@swasth/shared-types`.

import { PEAK_FLOW_VALID_MAX, PEAK_FLOW_VALID_MIN } from "@swasth/shared-types";
import { RESPIRATORY_INTENT_KEYWORDS } from "./dictionary.js";
import { parseNumericVoiceTranscript, type NumericVoiceParseResult } from "./numeric-parser.js";

export interface RespiratoryVoiceParseInput {
  transcript: string;
  confidence: number;
}

export type RespiratoryVoiceParseResult = NumericVoiceParseResult;

/**
 * Parse a respiratory voice transcript (e.g. "peak flow do sau hai")
 * into a peak-flow reading.
 */
export const parseRespiratoryVoiceTranscript = (
  input: RespiratoryVoiceParseInput,
): RespiratoryVoiceParseResult =>
  parseNumericVoiceTranscript({
    transcript: input.transcript,
    confidence: input.confidence,
    intentKeywords: RESPIRATORY_INTENT_KEYWORDS,
    validRange: { min: PEAK_FLOW_VALID_MIN, max: PEAK_FLOW_VALID_MAX },
  });
