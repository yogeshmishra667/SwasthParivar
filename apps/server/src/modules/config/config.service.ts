/**
 * Phase 3 — Feature config endpoint (service) — phase3.md CC.12.4.
 *
 * Resolves the rollout state of every built Phase 3 feature for one
 * user, via the shared CC.12 `isFeatureEnabled` gate.
 */

import { isFeatureEnabled } from "../../shared/rollout.js";
import type { FeatureConfigResponse } from "./config.types.js";

/**
 * Public feature name → rollout flag key.
 *
 * Only BUILT features appear here. Mobile gates navigation on this
 * map, so an unbuilt feature must not surface — even as `false`. Each
 * Phase 3 feature appends its row when it opts into CC.12 targeting:
 *   - Feature C (Silent Guardian) → `silent_guardian: "silent_guardian_enabled"`
 *   - Feature D (SOS)             → `sos: "sos_enabled"`
 * (kept out today per the "no preemptive flag keys" rule).
 */
const FEATURE_REGISTRY: Readonly<Record<string, string>> = {
  ai_chat: "ai_chat_enabled",
};

export const resolveFeatures = async (userId: string): Promise<FeatureConfigResponse> => {
  const resolved = await Promise.all(
    Object.entries(FEATURE_REGISTRY).map(
      async ([feature, flagKey]): Promise<readonly [string, boolean]> => [
        feature,
        await isFeatureEnabled(flagKey, userId),
      ],
    ),
  );
  return { features: Object.fromEntries(resolved) };
};
