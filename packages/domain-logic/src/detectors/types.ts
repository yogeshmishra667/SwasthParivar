// Shared types for all Phase 2 detectors. Pattern strings + severity
// levels are re-exported from @swasth/shared-types so client + server +
// domain-logic all agree on the contract.

import type {
  InsightPatternType,
  InsightSeverityLevel,
} from "@swasth/shared-types";

/**
 * The minimum reading shape detectors need. Mirrors GlucoseReading /
 * BPReading minus DB-internal fields. Detectors stay pure; the caller
 * (a server service or worker) is responsible for converting Prisma
 * rows into this shape.
 */
export interface TypedReading {
  id: string;
  valueMgDl: number;
  readingType: "fasting" | "pre_meal" | "post_meal" | "random" | "bedtime";
  measuredAt: string;
}

/**
 * Uniform output shape for every detector. Returning `null` is how a
 * detector says "not enough data" or "below confidence floor" — it is
 * NOT an error and the caller never logs it. Persisting null-results
 * would just clutter the feed without giving the patient any signal.
 */
export interface DetectorResult {
  patternType: InsightPatternType;
  conditionsInvolved: readonly string[];
  severityScore: number; // 0-100
  severityLevel: InsightSeverityLevel;
  messageKey: string;
  messageParams: Record<string, unknown>;
  triggerReadings: readonly string[]; // reading ids
  evidence: Record<string, unknown>;
  confidence: number; // 0-1
}

/**
 * Detector contract: pure function from (readings + now) to (result | null).
 * Time is always a parameter — never call `new Date()` inside a detector.
 */
export type Detector<TInput> = (input: TInput) => DetectorResult | null;
