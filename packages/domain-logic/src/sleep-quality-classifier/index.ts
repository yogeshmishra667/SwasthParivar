// Sleep classification (Phase 4 §E.2 #4, Feature I dashboard).
//
// Pure. Categorises one night's sleep on an OBJECTIVE duration +
// fragmentation axis: adequate | short | fragmented | long.
//
// NOTE: this is deliberately DISTINCT from the `SleepQuality` DB enum
// (poor | fair | good), which is the patient's SUBJECTIVE rating stored
// on `SleepLog.quality`. This classifier derives a category from the
// numbers a wearable reports, for a dashboard summary ("kal raat: neend
// kam thi") or a future Silent Guardian signal — it never overwrites the
// stored subjective rating.
//
// Decision tree (elderly-focused thresholds; ~7–8h is the target band):
//   1. duration  < 6h  → "short"      (insufficient total sleep)
//   2. duration  > 9h  → "long"       (oversleeping / possible malaise)
//   3. adequate duration (6–9h):
//        awake-in-bed ≥ 60min → "fragmented" (enough total, but broken)
//        else                  → "adequate"
// Short/long dominate on total duration; fragmentation is only judged
// once the total is in the healthy band.

export type SleepCategory = "adequate" | "short" | "fragmented" | "long";

/** Below this total sleep → "short". */
export const SLEEP_SHORT_MAX_MIN = 6 * 60; // 360
/** Above this total sleep → "long". */
export const SLEEP_LONG_MIN_MIN = 9 * 60; // 540
/** Awake-in-bed minutes (in-bed span minus asleep) that mark "fragmented". */
export const SLEEP_FRAGMENT_AWAKE_MIN = 60;

export interface SleepInput {
  /** Minutes actually asleep, as reported by the device/user. */
  durationMinutes: number;
  sleepStart: Date;
  sleepEnd: Date;
}

export interface SleepClassification {
  category: SleepCategory;
  /** Minutes spent in bed but awake (in-bed span − asleep), clamped ≥ 0. */
  awakeMinutes: number;
  reason: string;
}

const MIN_MS = 60_000;

/**
 * Classify one night's sleep. Pure — no clocks, no IO. `awakeMinutes` is
 * the in-bed span (`sleepEnd − sleepStart`) minus the asleep duration,
 * clamped to ≥ 0 so a device that over-counts asleep time never yields a
 * negative gap.
 */
export const classifySleep = (input: SleepInput): SleepClassification => {
  const inBedMinutes = Math.max(
    0,
    (input.sleepEnd.getTime() - input.sleepStart.getTime()) / MIN_MS,
  );
  const awakeMinutes = Math.max(0, inBedMinutes - input.durationMinutes);

  if (input.durationMinutes < SLEEP_SHORT_MAX_MIN) {
    return {
      category: "short",
      awakeMinutes,
      reason: `only ${input.durationMinutes} min asleep (< ${SLEEP_SHORT_MAX_MIN})`,
    };
  }
  if (input.durationMinutes > SLEEP_LONG_MIN_MIN) {
    return {
      category: "long",
      awakeMinutes,
      reason: `${input.durationMinutes} min asleep (> ${SLEEP_LONG_MIN_MIN})`,
    };
  }
  if (awakeMinutes >= SLEEP_FRAGMENT_AWAKE_MIN) {
    return {
      category: "fragmented",
      awakeMinutes,
      reason: `${Math.round(awakeMinutes)} min awake in bed (≥ ${SLEEP_FRAGMENT_AWAKE_MIN})`,
    };
  }
  return {
    category: "adequate",
    awakeMinutes,
    reason: `${input.durationMinutes} min asleep, ${Math.round(awakeMinutes)} min awake`,
  };
};
