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
