// Feature Rollout & Targeting resolver (phase3.md CC.12.2).
//
// Pure, zero-IO decision function. Given a flag value and a user
// (id + precomputed 0–99 bucket), decide whether the feature is on
// for that user. The caller (apps/server/src/shared/rollout.ts) reads
// the flag from Redis and computes the bucket via SHA-256 — this
// module imports no node builtins so it stays in domain-logic.
//
// Backward compatibility (CC.12.0): a plain boolean flag value keeps
// meaning global on/off. Every flag predating CC.12 — and any feature
// that never opts into targeting — resolves through the boolean arm
// unchanged.
//
// Fail-closed: anything that isn't a boolean or a recognised rollout
// object resolves to `false`. Malformed flag JSON can never turn a
// feature ON for a patient.
//
// Coverage: 100% branches, locked in vitest.config.ts (CC.12.2).

export interface RolloutUser {
  /** Database user id — matched against a cohort allowlist. */
  readonly id: string;
  /** Deterministic 0–99 hash bucket, computed by the caller. */
  readonly bucket: number;
}

export interface CohortConfig {
  readonly rollout: "cohort";
  readonly userIds: readonly string[];
}

export interface PercentageConfig {
  readonly rollout: "percentage";
  readonly percent: number;
}

export interface CohortOrPercentageConfig {
  readonly rollout: "cohort_or_percentage";
  readonly userIds: readonly string[];
  readonly percent: number;
}

/** The four flag-value shapes a rollout flag may carry (CC.12.1). */
export type RolloutConfig = boolean | CohortConfig | PercentageConfig | CohortOrPercentageConfig;

/** True when `userId` appears in the allowlist. Fail-closed if it isn't an array. */
const inCohort = (userIds: unknown, userId: string): boolean =>
  Array.isArray(userIds) && userIds.includes(userId);

/**
 * True when the user's bucket falls under the rollout percentage.
 * `bucket < percent` is stable per user: ramping `percent` up never
 * flips an already-in user out, and rolling back removes only the
 * highest buckets (CC.12.5).
 */
const inPercentage = (percent: unknown, bucket: number): boolean =>
  typeof percent === "number" && bucket < percent;

/**
 * Resolve a rollout flag for one user. `config` is accepted as
 * `unknown` so a malformed Redis value (wrong shape, stray string)
 * fails closed rather than throwing.
 */
export const evaluateRollout = (config: unknown, user: RolloutUser): boolean => {
  // Global on/off — back-compatible with every pre-CC.12 flag.
  if (typeof config === "boolean") return config;

  // Not a boolean and not a plain object → unrecognised → OFF.
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    return false;
  }

  const c = config as Record<string, unknown>;
  switch (c.rollout) {
    case "cohort":
      return inCohort(c.userIds, user.id);
    case "percentage":
      return inPercentage(c.percent, user.bucket);
    case "cohort_or_percentage":
      return inCohort(c.userIds, user.id) || inPercentage(c.percent, user.bucket);
    default:
      return false;
  }
};
