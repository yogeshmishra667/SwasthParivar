/**
 * Phase 3 — Feature Rollout & Targeting gate (phase3.md CC.12.3).
 *
 * `isFeatureEnabled(featureKey, userId)` is the single call every
 * feature service uses in place of an ad-hoc `getFlag<boolean>`. It:
 *
 *   1. reads the flag value via the existing flag service (`getFlag`),
 *   2. computes a stable 0–99 bucket from SHA-256(featureKey:userId),
 *   3. delegates the decision to the pure `evaluateRollout` resolver.
 *
 * Fail-safe: Redis down → `getFlag` returns the default `false` →
 * `evaluateRollout(false, …)` → feature stays OFF. A flag misread can
 * never turn a patient-facing feature ON.
 *
 * Back-compat (CC.12.0): a plain boolean flag resolves through the
 * boolean arm of `evaluateRollout` unchanged. This helper is purely
 * additive — it does not modify the flag service.
 */

import { createHash } from "node:crypto";
import { evaluateRollout } from "@swasth/domain-logic";
import { getFlag, type FlagValue } from "./flags/index.js";

const BUCKET_COUNT = 100;

/**
 * Deterministic 0–99 bucket for a (feature, user) pair. Stable across
 * processes and deploys — the same pair always lands in the same
 * bucket, so ramping a percentage up never reshuffles existing users.
 * Keyed by featureKey so a user in the 5% bucket for one feature is
 * not correlated into the 5% bucket for another.
 */
export const computeBucket = (featureKey: string, userId: string): number => {
  const digest = createHash("sha256").update(`${featureKey}:${userId}`).digest();
  return digest.readUInt32BE(0) % BUCKET_COUNT;
};

/**
 * Resolve a rollout flag for one user. `featureKey` is the flag key
 * (e.g. `ai_chat_enabled`); the default is `false` so an unset flag —
 * or a Redis outage — keeps the feature dark.
 */
export const isFeatureEnabled = async (featureKey: string, userId: string): Promise<boolean> => {
  const config = await getFlag<FlagValue>(featureKey, false);
  return evaluateRollout(config, { id: userId, bucket: computeBucket(featureKey, userId) });
};
