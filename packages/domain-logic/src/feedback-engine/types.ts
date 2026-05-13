import type { FeedbackEvent, GlucoseReadingType, ReadingContext } from "@swasth/shared-types";

export interface FeedbackComputeInput {
  currentValue: number;
  currentType: GlucoseReadingType;
  context: ReadingContext;
  userStageDays: number;
  isFirstReading: boolean;
  sameTypeReadingsLast7d: { valueMgDl: number; measuredAt: string }[];
  lastSameTypeValue: number | null;
  recentVariantIds: string[];
  currentStreakDays: number;
}

export type FeedbackResult = FeedbackEvent;
