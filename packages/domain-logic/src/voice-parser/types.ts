import type { GlucoseReadingType } from "@swasth/shared-types";

export interface VoiceParseInput {
  transcript: string;
  confidence: number;
  capturedAtHourLocal: number;
}

export interface NumberCandidate {
  value: number;
  recommended: boolean;
  source: "digit" | "colloquial" | "english_word";
}

export type VoiceParseResult =
  | {
      kind: "ok";
      value: number;
      candidates: NumberCandidate[];
      readingType: GlucoseReadingType;
      requiresTypeConfirmation: boolean;
      requiresStrongConfirmation: boolean;
      requiresDoubleConfirmation: boolean;
      uncertaintyDetected: boolean;
      colloquialMatch: boolean;
    }
  | {
      kind: "rejected";
      reason:
        | "no_number"
        | "past_tense_only"
        | "negated_intent"
        | "out_of_range"
        | "no_intent";
    };
