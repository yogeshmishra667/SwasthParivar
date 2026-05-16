// Phase 2 — HbA1c estimator input/output types. Pure data shapes; the
// caller (server service) translates Prisma rows into these.

/**
 * A glucose reading reduced to the two fields the estimator needs.
 * Both glucose and timestamp are required — `null`/`undefined` filtering
 * happens at the service boundary, not inside the pure function.
 */
export interface HbA1cReadingInput {
  valueMgDl: number;
  measuredAt: string; // ISO 8601
}

/**
 * Result shape for a successful estimate. `null` is the alternative —
 * `estimateHbA1c` returns null when the input fails the minimum-data
 * gate. The caller maps null to a 422 `INSUFFICIENT_DATA` response.
 *
 * Why we expose `weightedAverageMgDl` + the per-window stats: the
 * dashboard can show "based on N readings spanning M days" so the
 * patient understands why the number moved.
 */
export interface HbA1cEstimate {
  hba1cPercent: number;
  weightedAverageMgDl: number;
  // Total readings counted across all three windows.
  totalReadings: number;
  windows: {
    recent: HbA1cWindowStats;
    middle: HbA1cWindowStats;
    oldest: HbA1cWindowStats;
  };
  // Patient-facing label — never drop this.
  label: "ESTIMATE";
  computedAtIso: string;
}

export interface HbA1cWindowStats {
  meanMgDl: number;
  readingCount: number;
  weight: number;
}
