// Phase 2 — derived health endpoints (HbA1c estimate + Health Score).
// Both are cached server-side (HbA1c 1h, score 24h) so the mobile layer
// can call freely on every dashboard pull.

import { isAxiosError } from "axios";

import { api } from "@/services/api";
import { logError } from "@/services/analytics";

export interface HbA1cEstimate {
  /** Estimated HbA1c percentage, rounded to 1 decimal. */
  estimate: number;
  /** Weighted mean glucose used in the formula. */
  weightedMeanMgDl: number;
  /** Number of readings used in the estimate. */
  readingCount: number;
  /** ISO date of the most-recent reading included. */
  computedAt: string;
}

export type HbA1cResult =
  | { kind: "ok"; estimate: HbA1cEstimate }
  | { kind: "insufficient" }
  | { kind: "error" };

/**
 * GET /api/v1/hba1c/estimate.
 *
 * The server returns 422 INSUFFICIENT_DATA when fewer than 30 readings
 * exist in the last 90 days — we map that to a distinct `insufficient`
 * kind so the UI can show the "30 readings ke baad estimate milega"
 * cold-start copy instead of a generic error.
 */
export const getHbA1cEstimate = async (): Promise<HbA1cResult> => {
  try {
    const res = await api.get<{ success: boolean; data: HbA1cEstimate }>("/hba1c/estimate");
    return { kind: "ok", estimate: res.data };
  } catch (err) {
    if (isAxiosError(err) && err.response?.status === 422) {
      return { kind: "insufficient" };
    }
    logError("getHbA1cEstimate", err);
    return { kind: "error" };
  }
};

export interface HealthScoreSnapshot {
  score: number;
  components: {
    logging: number;
    stability: number;
    trend: number;
    medication: number;
    streak: number;
  };
  computedForDate: string;
}

export const getHealthScore = async (): Promise<HealthScoreSnapshot | null> => {
  try {
    const res = await api.get<{ success: boolean; data: HealthScoreSnapshot }>("/health-score");
    return res.data;
  } catch (err) {
    logError("getHealthScore", err);
    return null;
  }
};
