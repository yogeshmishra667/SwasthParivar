/**
 * Phase 3 — Feature config endpoint (phase3.md CC.12.4).
 *
 * Shared shape for `GET /api/v1/config/features`. Mobile gates
 * navigation + screen registration on this map so a patient never
 * sees UI for a feature that is off for them. Server and mobile read
 * the SAME resolved answer (the CC.12 rollout gate) — no drift.
 */

export interface FeatureConfigResponse {
  /** Public feature name → resolved-for-this-user enabled flag. */
  readonly features: Readonly<Record<string, boolean>>;
}
