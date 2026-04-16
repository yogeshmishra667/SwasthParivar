import {
  GLUCOSE_CRITICAL_HIGH,
  GLUCOSE_CRITICAL_LOW,
  type FeedbackTone,
} from "@swasth/shared-types";
import type { FeedbackComputeInput, FeedbackResult } from "./types.js";

const NOISE_FLOOR = 10;
const SAME_TYPE_MIN_FOR_MEDIAN = 3;
const STAGE_THRESHOLD_DAYS = 7;

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
};

const VARIANT_KEYS: Record<FeedbackTone, string[]> = {
  celebrate: ["celebrate.v1", "celebrate.v2", "celebrate.v3", "celebrate.v4", "celebrate.v5"],
  neutral: ["neutral.v1", "neutral.v2", "neutral.v3", "neutral.v4", "neutral.v5"],
  gentle_warn: ["warn.v1", "warn.v2", "warn.v3", "warn.v4", "warn.v5"],
  encourage: ["encourage.v1", "encourage.v2", "encourage.v3"],
};

const pickVariant = (
  tone: FeedbackTone,
  recent: string[],
): { key: string; index: number } => {
  const pool = VARIANT_KEYS[tone];
  const eligible = pool.filter((k) => !recent.includes(k));
  const chosen = eligible.length > 0 ? eligible[0]! : pool[0]!;
  return { key: chosen, index: pool.indexOf(chosen) };
};

const toneFromDelta = (delta: number): FeedbackTone => {
  if (Math.abs(delta) < NOISE_FLOOR) return "neutral";
  if (delta <= -NOISE_FLOOR) return "celebrate";
  return "gentle_warn";
};

export const computeFeedback = (input: FeedbackComputeInput): FeedbackResult => {
  const isCritical =
    input.currentValue < GLUCOSE_CRITICAL_LOW || input.currentValue > GLUCOSE_CRITICAL_HIGH;

  if (isCritical) {
    const variant = pickVariant("gentle_warn", input.recentVariantIds);
    return {
      tone: "gentle_warn",
      type: "critical_warn",
      messageKey: "critical.warn",
      variantIndex: variant.index,
      params: { value: input.currentValue },
    };
  }

  if (input.isFirstReading) {
    const variant = pickVariant("celebrate", input.recentVariantIds);
    return {
      tone: "celebrate",
      type: "first_reading",
      messageKey: "first.reading",
      variantIndex: variant.index,
      params: { value: input.currentValue },
    };
  }

  let baseline: number | null = null;
  if (
    input.userStageDays >= STAGE_THRESHOLD_DAYS &&
    input.sameTypeReadingsLast7d.length >= SAME_TYPE_MIN_FOR_MEDIAN
  ) {
    baseline = median(input.sameTypeReadingsLast7d.map((r) => r.valueMgDl));
  } else if (input.lastSameTypeValue !== null) {
    baseline = input.lastSameTypeValue;
  }

  if (baseline === null) {
    const variant = pickVariant("neutral", input.recentVariantIds);
    return {
      tone: "neutral",
      type: "post_log_compare",
      messageKey: variant.key,
      variantIndex: variant.index,
      params: { value: input.currentValue, streak: input.currentStreakDays },
    };
  }

  const delta = input.currentValue - baseline;
  let tone = toneFromDelta(delta);

  if (input.context === "festive" && tone === "gentle_warn") {
    tone = "celebrate";
  }

  const variant = pickVariant(tone, input.recentVariantIds);
  return {
    tone,
    type: "post_log_compare",
    messageKey: variant.key,
    variantIndex: variant.index,
    params: {
      value: input.currentValue,
      delta: Math.round(delta),
      baseline: Math.round(baseline),
      streak: input.currentStreakDays,
    },
  };
};
