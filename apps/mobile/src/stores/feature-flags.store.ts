import { create } from "zustand";
import { api } from "@/services/api";

/**
 * Phase 3 — mobile feature-flag store (phase3.md CC.12.7 #2).
 *
 * The client side of the CC.12.4 `GET /api/v1/config/features`
 * endpoint. Holds the per-user rollout map so navigation and screen
 * registration can gate on it — a patient never sees UI for a feature
 * that is off for them. Server and mobile resolve from the SAME answer
 * (the CC.12 rollout gate), so there is no drift.
 *
 * Caching mirrors the 60s in-memory pattern in `auth-config.ts`:
 * `refresh()` is cheap to call repeatedly and only hits the network
 * once per TTL window.
 *
 * Fail-safe: on a network failure the last known map is kept; with no
 * prior fetch the map is empty, so every feature reads as `false` —
 * the same fail-closed default the server uses.
 */

// Feature names mirror the server FEATURE_REGISTRY (CC.12.4). Only
// BUILT features appear; Features C/D append `silent_guardian` / `sos`
// here when they land.
export type FeatureName = "ai_chat";

interface FeaturesEnvelope {
  success: boolean;
  data: { features: Record<string, boolean> };
}

const TTL_MS = 60_000;

interface FeatureFlagsState {
  features: Record<string, boolean>;
  fetchedAt: number | null;
  loading: boolean;
  /** Fetch the rollout map. No-op inside the TTL window unless `force`. */
  refresh: (force?: boolean) => Promise<void>;
  /** True only when the feature is explicitly enabled for this user. */
  isEnabled: (feature: FeatureName) => boolean;
}

export const useFeatureFlags = create<FeatureFlagsState>((set, get) => ({
  features: {},
  fetchedAt: null,
  loading: false,

  refresh: async (force = false) => {
    const { fetchedAt, loading } = get();
    if (loading) return;
    if (!force && fetchedAt !== null && Date.now() - fetchedAt < TTL_MS) return;

    set({ loading: true });
    try {
      const envelope = await api.get<FeaturesEnvelope>("/config/features");
      set({ features: envelope.data.features, fetchedAt: Date.now(), loading: false });
    } catch {
      // Keep the last known map. Never throw into the UI — an
      // unresolved feature stays off, matching the server default.
      set({ loading: false });
    }
  },

  isEnabled: (feature) => get().features[feature] === true,
}));

/**
 * Reactive selector — re-renders the caller when the flag for
 * `feature` changes. Prefer this in components over the imperative
 * `isEnabled` (which is not subscribed to the `features` slice).
 */
export const useFeatureEnabled = (feature: FeatureName): boolean =>
  useFeatureFlags((state) => state.features[feature] === true);
