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
