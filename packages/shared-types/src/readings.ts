export type GlucoseReadingType = "fasting" | "pre_meal" | "post_meal" | "random" | "bedtime";

export type ReadingSource = "manual" | "voice" | "device";

export type ReadingContext = "normal" | "festive";

export interface GlucoseReading {
  id: string;
  clientUuid: string;
  userId: string;
  valueMgDl: number;
  readingType: GlucoseReadingType;
  context: ReadingContext;
  notes?: string;
  source: ReadingSource;
  measuredAt: string;
  streakCreditedTo: string;
  version: number;
  syncedAt?: string;
}

export interface CreateGlucoseReadingInput {
  clientUuid: string;
  valueMgDl: number;
  readingType: GlucoseReadingType;
  context?: ReadingContext;
  notes?: string;
  source: ReadingSource;
  measuredAt: string;
  version?: number;
}

export const GLUCOSE_CRITICAL_LOW = 65 as const;
export const GLUCOSE_CRITICAL_HIGH = 315 as const;
export const GLUCOSE_VALID_MIN = 20 as const;
export const GLUCOSE_VALID_MAX = 600 as const;

export const isCriticalGlucose = (value: number): boolean =>
  value < GLUCOSE_CRITICAL_LOW || value > GLUCOSE_CRITICAL_HIGH;

// ─────────────────────────────────────────────────────────────
// BP (Phase 2)
// ─────────────────────────────────────────────────────────────

export interface BPReading {
  id: string;
  clientUuid: string;
  userId: string;
  systolic: number;
  diastolic: number;
  pulse?: number;
  context: ReadingContext;
  notes?: string;
  source: ReadingSource;
  measuredAt: string;
  version: number;
  syncedAt?: string;
}

export interface CreateBPReadingInput {
  clientUuid: string;
  systolic: number;
  diastolic: number;
  pulse?: number;
  context?: ReadingContext;
  notes?: string;
  source: ReadingSource;
  measuredAt: string;
  version?: number;
}

export const BP_SYSTOLIC_MIN = 60 as const;
export const BP_SYSTOLIC_MAX = 250 as const;
export const BP_DIASTOLIC_MIN = 40 as const;
export const BP_DIASTOLIC_MAX = 150 as const;
export const BP_PULSE_MIN = 30 as const;
export const BP_PULSE_MAX = 250 as const;

// Critical-bypass thresholds — HARDCODED medical safety (CLAUDE.md
// "Phase 4 Invariants — Multi-condition Critical-Bypass Dispatch"):
// low = sys < 90 OR dia < 60, high = sys > 180 OR dia > 110.
export const BP_CRITICAL_SYSTOLIC_LOW = 90 as const;
export const BP_CRITICAL_DIASTOLIC_LOW = 60 as const;
export const BP_CRITICAL_SYSTOLIC_HIGH = 180 as const;
export const BP_CRITICAL_DIASTOLIC_HIGH = 110 as const;

/**
 * Which way a BP reading is critical, or null when it isn't. A reading
 * that is both (e.g. 190/55) reads as "high": a hypertensive-crisis
 * systolic is the more acute signal, and both copies say "call now".
 */
export const bpCriticalDirection = (systolic: number, diastolic: number): "low" | "high" | null => {
  if (systolic > BP_CRITICAL_SYSTOLIC_HIGH || diastolic > BP_CRITICAL_DIASTOLIC_HIGH) return "high";
  if (systolic < BP_CRITICAL_SYSTOLIC_LOW || diastolic < BP_CRITICAL_DIASTOLIC_LOW) return "low";
  return null;
};

export const isCriticalBP = (systolic: number, diastolic: number): boolean =>
  bpCriticalDirection(systolic, diastolic) !== null;

// ─────────────────────────────────────────────────────────────
// Cardiac (Phase 4 Feature E.1)
// CLAUDE.md "Phase 4 Invariants — Multi-condition Critical-Bypass
// Dispatch": HR < 40 OR HR > 150 OR (chestPain && severity ≥ 7).
// Hardcoded — these thresholds are medical-safety constants and are
// not flag-tunable, same constraint as the glucose values above.
// ─────────────────────────────────────────────────────────────

export type RhythmStatus = "regular" | "irregular" | "unknown";
export type ExerciseTolerance = "normal" | "reduced" | "severe";

export const HR_CRITICAL_LOW = 40 as const;
export const HR_CRITICAL_HIGH = 150 as const;
export const CHEST_PAIN_CRITICAL_SEVERITY = 7 as const;
export const HR_VALID_MIN = 30 as const;
export const HR_VALID_MAX = 250 as const;
export const PAIN_SEVERITY_MIN = 0 as const;
export const PAIN_SEVERITY_MAX = 10 as const;

// ─────────────────────────────────────────────────────────────
// Respiratory (Phase 4 Feature E.1)
// CLAUDE.md "Phase 4 Invariants": peakFlow < baseline * 0.5 OR
// symptomSeverity === "severe". Hardcoded.
// ─────────────────────────────────────────────────────────────

export type SymptomSeverity = "none" | "mild" | "moderate" | "severe";

// Asthma red-zone: < 50% of personal best. Asthma yellow-zone: 50–80%.
export const PEAK_FLOW_RED_ZONE_RATIO = 0.5 as const;
export const PEAK_FLOW_YELLOW_ZONE_RATIO = 0.8 as const;
export const PEAK_FLOW_VALID_MIN = 50 as const;
export const PEAK_FLOW_VALID_MAX = 800 as const;

// ─────────────────────────────────────────────────────────────
// Cardiac log shapes (Phase 4 Feature E)
// ─────────────────────────────────────────────────────────────

export interface CardiacLog {
  id: string;
  clientUuid: string;
  userId: string;
  heartRate: number;
  rhythmStatus: RhythmStatus;
  chestPain: boolean;
  painSeverity?: number | null;
  exerciseTolerance: ExerciseTolerance;
  notes?: string | null;
  source: ReadingSource;
  measuredAt: string;
  version: number;
  syncedAt?: string | null;
}

export interface CreateCardiacLogInput {
  clientUuid: string;
  heartRate: number;
  rhythmStatus?: RhythmStatus;
  chestPain?: boolean;
  painSeverity?: number;
  exerciseTolerance?: ExerciseTolerance;
  notes?: string;
  source: ReadingSource;
  measuredAt: string;
  version?: number;
}

// ─────────────────────────────────────────────────────────────
// Respiratory log shapes (Phase 4 Feature E)
// ─────────────────────────────────────────────────────────────

export interface RespiratoryLog {
  id: string;
  clientUuid: string;
  userId: string;
  peakFlow?: number | null;
  baselinePeakFlow?: number | null;
  inhalerUsed: boolean;
  inhalerType?: string | null;
  puffs?: number | null;
  triggerNote?: string | null;
  symptomSeverity: SymptomSeverity;
  notes?: string | null;
  source: ReadingSource;
  measuredAt: string;
  version: number;
  syncedAt?: string | null;
}

export interface CreateRespiratoryLogInput {
  clientUuid: string;
  peakFlow?: number;
  /**
   * Optional. Client may override the patient's stored baseline for this
   * single log (e.g. a new personal best measured in clinic). When
   * omitted, the server snapshots the user's stored baseline at insert
   * time so the row is self-describing.
   */
  baselinePeakFlow?: number;
  inhalerUsed?: boolean;
  inhalerType?: string;
  puffs?: number;
  triggerNote?: string;
  symptomSeverity?: SymptomSeverity;
  notes?: string;
  source: ReadingSource;
  measuredAt: string;
  version?: number;
}

// ─────────────────────────────────────────────────────────────
// Multi-condition critical-bypass dispatch (Phase 4 Feature E
// + CLAUDE.md "Phase 4 Invariants — Multi-condition Critical-
// Bypass Dispatch"). Glucose continues to use the original
// `BypassDecision` shape from `critical-bypass/types.ts`; the
// new cardiac/respiratory surfaces share the category-aware
// shape below.
// ─────────────────────────────────────────────────────────────

export type CriticalBypassCategory = "glucose" | "bp" | "cardiac" | "respiratory";
