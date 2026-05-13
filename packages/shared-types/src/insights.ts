// Phase 2 — Insight engine output shape, shared between the server,
// the domain-logic detectors (pure functions), and the mobile client.

// Pattern types map 1:1 to detector modules in
// `packages/domain-logic/src/detectors/`. Add new entries when adding
// new detectors; never reuse a string.
export type InsightPatternType =
  | "spike"
  | "trend"
  | "meal_correlation"
  | "anomaly"
  | "cross_condition";

// Three-band severity used uniformly across detectors. Stays small on
// purpose — UI maps these to colors / haptics / sort order without
// branching on detector internals.
export type InsightSeverityLevel = "info" | "warn" | "critical";

export interface InsightEvent {
  id: string;
  userId: string;
  patternType: InsightPatternType;
  conditionsInvolved: readonly string[];
  severityScore: number; // 0-100
  severityLevel: InsightSeverityLevel;
  messageKey: string;
  messageParams: Record<string, unknown>;
  triggerReadings: readonly string[]; // reading ids
  evidence: Record<string, unknown>;
  acknowledged: boolean;
  helpful: boolean | null;
  createdAt: string;
  expiresAt: string | null;
}

// Confidence floor below which a DetectorResult is "stored only" — the
// row is persisted with `acknowledged: false` AND surfaced only after
// analytics review. The mobile UI suppresses these from the feed.
// Source: CLAUDE.md "Insight Engine — Minimum Data" section.
export const INSIGHT_CONFIDENCE_FLOOR = 0.7 as const;

// Per-detector minimum-data gates. Each detector enforces these at its
// own entry point; the constants live here so the dashboard can show
// progress ("3 more days of data unlocks spike detection") without
// duplicating numbers.
export const INSIGHT_MIN_DATA_DAYS = {
  spike: 7,
  trend: 5, // also requires R² > 0.5
  meal_correlation: 7, // 5 instances per category in a 7-day window
  anomaly: 21,
  cross_condition: 30,
} as const;
