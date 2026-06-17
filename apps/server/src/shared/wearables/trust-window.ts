// Redis side of the wearable trust window (Phase 4 §I.1 / CLAUDE.md
// "Wearable Trust Model"). The decision logic is the pure
// `isWearableDetectorEligible` in @swasth/domain-logic; this module only
// reads/writes the two Redis keys it needs as inputs:
//
//   wearable_trust:${userId}:until      ISO instant the 30-day window ends
//   wearable_trust:${userId}:promoted   "1" → device promoted early
//
// All ops are best-effort: a Redis outage must never block logging
// (CLAUDE.md "Redis down → bypass"). On failure we fail SAFE — the
// reader returns "no window / not promoted", which keeps device data
// OUT of detectors rather than wrongly trusting it.

import { trustWindowEndsAt } from "@swasth/domain-logic";
import { redis } from "../redis.js";
import { logger } from "../logger.js";

const untilKey = (userId: string): string => `wearable_trust:${userId}:until`;
const promotedKey = (userId: string): string => `wearable_trust:${userId}:promoted`;

/**
 * Start the 30-day trust countdown on the user's FIRST device sync.
 * NX so a later sync never restarts the clock. No-op for manual data.
 */
export const startTrustWindowIfUnset = async (userId: string, now: Date): Promise<void> => {
  try {
    await redis.set(untilKey(userId), trustWindowEndsAt(now), "NX");
  } catch (err) {
    logger.warn({ err, userId }, "wearable trust-window write failed (non-fatal)");
  }
};

export interface TrustState {
  trustUntilIso: string | null;
  promoted: boolean;
}

/** Reads the trust-window inputs for the detector-eligibility check. */
export const readTrustState = async (userId: string): Promise<TrustState> => {
  try {
    const [until, promoted] = await Promise.all([
      redis.get(untilKey(userId)),
      redis.get(promotedKey(userId)),
    ]);
    return { trustUntilIso: until, promoted: promoted === "1" };
  } catch (err) {
    logger.warn({ err, userId }, "wearable trust-window read failed — failing safe (untrusted)");
    return { trustUntilIso: null, promoted: false };
  }
};
