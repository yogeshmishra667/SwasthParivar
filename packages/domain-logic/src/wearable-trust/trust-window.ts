// Wearable trust model (Phase 4 §I, CLAUDE.md "Wearable Trust Model").
//
// Device-sourced data is *evidence, not truth*. It is stored and
// displayed immediately, but it stays OUT of detectors (trend /
// correlation / Silent Guardian) until either:
//   1. the 30-day trust window since the user's first device sync has
//      elapsed (paired manual+device data has had time to agree), OR
//   2. the user / an admin explicitly promotes the device early.
//
// Manual data is always trusted — this gate only ever applies to
// device sources. Critical-bypass is unaffected: it still fires on
// device readings (handled in the bypass chain, not here).
//
// Pure + IO-free: `now` and the window boundary are parameters. The
// caller reads/writes the Redis keys (`wearable_trust:${userId}:until`,
// `wearable_trust:${userId}:promoted`) and converts them into these
// arguments at the service boundary.

/** Length of the paired-confirmation window before device data counts. */
export const WEARABLE_TRUST_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

export type WearableSourceKind = "manual" | "healthkit" | "googlefit";

/** A source is device-originated (subject to the trust gate) iff not manual. */
export const isDeviceSource = (source: WearableSourceKind): boolean => source !== "manual";

export interface DetectorEligibilityInput {
  source: WearableSourceKind;
  now: Date;
  /**
   * ISO timestamp when the trust window ends for this user (Redis
   * `wearable_trust:${userId}:until`). `null` when no device data has
   * ever been synced — in that case there is no window yet.
   */
  trustUntilIso: string | null;
  /** Redis `wearable_trust:${userId}:promoted` === "1". */
  promoted: boolean;
}

/**
 * Whether a reading from `source` may feed detectors right now.
 *
 * - Manual → always eligible.
 * - Device + promoted → eligible (explicit override).
 * - Device + `now` ≥ trustUntil → eligible (window elapsed).
 * - Device + window still open (or never started) → NOT eligible.
 */
export const isWearableDetectorEligible = (input: DetectorEligibilityInput): boolean => {
  if (!isDeviceSource(input.source)) return true;
  if (input.promoted) return true;
  if (input.trustUntilIso === null) return false;
  const untilMs = new Date(input.trustUntilIso).getTime();
  if (Number.isNaN(untilMs)) return false;
  return input.now.getTime() >= untilMs;
};

/**
 * The ISO instant the trust window should end, given the moment device
 * data was first seen. The caller writes this to
 * `wearable_trust:${userId}:until` only if the key is not already set
 * (the countdown starts at first sync and never restarts).
 */
export const trustWindowEndsAt = (firstDeviceSyncAt: Date): string =>
  new Date(firstDeviceSyncAt.getTime() + WEARABLE_TRUST_WINDOW_DAYS * DAY_MS).toISOString();
