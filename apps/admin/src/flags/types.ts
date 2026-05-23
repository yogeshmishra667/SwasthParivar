// Flag value shapes — mirror the server's `shared/flags/types.ts` /
// `shared/rollout.ts`. Kept local rather than in @swasth/shared-types
// because the server's runtime helpers (evaluateRollout) are not part
// of the client contract; only the value shape is.

export type RolloutKind = "cohort" | "percentage" | "cohort_or_percentage";

export interface CohortRollout {
  rollout: "cohort";
  userIds: string[];
}

export interface PercentageRollout {
  rollout: "percentage";
  percent: number;
}

export interface CohortOrPercentageRollout {
  rollout: "cohort_or_percentage";
  userIds: string[];
  percent: number;
}

export type RolloutConfig = CohortRollout | PercentageRollout | CohortOrPercentageRollout;

/**
 * A flag value is either a global kill-switch boolean, a typed rollout
 * config, or an arbitrary JSON object (free-form config, e.g.
 * `{ provider: "log" }` for `auth.otp.provider`).
 */
export type FlagValue = boolean | RolloutConfig | Record<string, unknown>;

/** The editor variant rendered by `<FlagEditor>` for a given value. */
export type FlagEditorKind = "boolean" | RolloutKind | "raw";

/**
 * Classify a flag value into the editor variant that should render it.
 * `"raw"` is the fallback for free-form config objects.
 */
export function detectFlagKind(value: FlagValue): FlagEditorKind {
  if (typeof value === "boolean") return "boolean";
  if (value !== null && typeof value === "object" && "rollout" in value) {
    const r = (value as { rollout?: unknown }).rollout;
    if (r === "cohort" || r === "percentage" || r === "cohort_or_percentage") return r;
  }
  return "raw";
}
