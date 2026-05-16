import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { estimateHbA1c } from "./estimate.js";
import type { HbA1cReadingInput } from "./types.js";

const NOW = new Date("2026-05-15T08:00:00.000Z");
const dayMs = 86_400_000;

const r = (valueMgDl: number, daysAgo: number): HbA1cReadingInput => ({
  valueMgDl,
  measuredAt: new Date(NOW.getTime() - daysAgo * dayMs).toISOString(),
});

// Spread N readings of the given value across `windowStart..windowEnd`
// days ago so each one lands inside the intended bucket.
const fillWindow = (
  value: number,
  count: number,
  windowStart: number,
  windowEnd: number,
): HbA1cReadingInput[] => {
  const out: HbA1cReadingInput[] = [];
  if (count === 0) return out;
  const span = windowEnd - windowStart;
  for (let i = 0; i < count; i++) {
    // Distribute evenly across the bucket; avoid the exact edges so
    // floating-point boundaries can't push a reading into the wrong
    // window.
    const daysAgo = windowStart + 0.5 + (span - 1) * (i / Math.max(1, count - 1));
    out.push(r(value, daysAgo));
  }
  return out;
};

describe("estimateHbA1c — minimum-data gates", () => {
  it("returns null with fewer than 30 readings", () => {
    const readings = fillWindow(140, 29, 0, 30);
    expect(estimateHbA1c({ readings, now: NOW })).toBeNull();
  });

  it("returns null when the recent (0-30d) window is empty", () => {
    // 40 readings all in middle + oldest — total ≥ 30 but no fresh data
    const readings = [...fillWindow(140, 20, 30, 60), ...fillWindow(150, 20, 60, 90)];
    expect(estimateHbA1c({ readings, now: NOW })).toBeNull();
  });

  it("returns an estimate at exactly 30 readings when recent is non-empty", () => {
    const readings = [
      ...fillWindow(140, 10, 0, 30),
      ...fillWindow(140, 10, 30, 60),
      ...fillWindow(140, 10, 60, 90),
    ];
    const result = estimateHbA1c({ readings, now: NOW });
    expect(result).not.toBeNull();
    expect(result?.totalReadings).toBe(30);
  });

  it("drops readings older than 90 days", () => {
    const readings = [
      ...fillWindow(140, 30, 0, 30),
      // 20 readings 100-120 days ago — should be silently ignored
      ...fillWindow(999, 20, 100, 120),
    ];
    const result = estimateHbA1c({ readings, now: NOW });
    expect(result?.totalReadings).toBe(30);
    expect(result?.weightedAverageMgDl).toBe(140);
  });

  it("drops future-dated readings", () => {
    const future: HbA1cReadingInput = {
      valueMgDl: 999,
      measuredAt: new Date(NOW.getTime() + dayMs).toISOString(),
    };
    const readings = [future, ...fillWindow(140, 30, 0, 30)];
    const result = estimateHbA1c({ readings, now: NOW });
    expect(result?.totalReadings).toBe(30);
    expect(result?.weightedAverageMgDl).toBe(140);
  });
});

describe("estimateHbA1c — math correctness", () => {
  it("matches the ADAG formula for a flat 154 mg/dL average → 7.0%", () => {
    // 154 mg/dL is the canonical ADAG worked example: HbA1c ≈ 7.0%
    const readings = [
      ...fillWindow(154, 15, 0, 30),
      ...fillWindow(154, 15, 30, 60),
      ...fillWindow(154, 15, 60, 90),
    ];
    const result = estimateHbA1c({ readings, now: NOW });
    expect(result?.weightedAverageMgDl).toBe(154);
    expect(result?.hba1cPercent).toBeCloseTo(7.0, 1);
  });

  it("recency-weights toward fresh readings", () => {
    // Recent 200 ×30, middle 100 ×30, oldest 100 ×30.
    // Unweighted mean = 133.3. Weighted mean must be > 133.3 because
    // recent carries 1.5× and is the highest-valued bucket.
    const readings = [
      ...fillWindow(200, 30, 0, 30),
      ...fillWindow(100, 30, 30, 60),
      ...fillWindow(100, 30, 60, 90),
    ];
    const result = estimateHbA1c({ readings, now: NOW });
    expect(result?.weightedAverageMgDl).toBeGreaterThan(133.3);
  });

  it("output rounded to one decimal place", () => {
    const readings = fillWindow(143, 30, 0, 30);
    const result = estimateHbA1c({ readings, now: NOW });
    // Whatever the value, it should be rounded to 1dp (no NaN, no long tail)
    expect(result?.hba1cPercent).toBe(Math.round((result?.hba1cPercent ?? 0) * 10) / 10);
  });

  it("label is always 'ESTIMATE'", () => {
    const readings = fillWindow(140, 30, 0, 30);
    const result = estimateHbA1c({ readings, now: NOW });
    expect(result?.label).toBe("ESTIMATE");
  });

  it("computedAtIso reflects the `now` parameter", () => {
    const readings = fillWindow(140, 30, 0, 30);
    const result = estimateHbA1c({ readings, now: NOW });
    expect(result?.computedAtIso).toBe(NOW.toISOString());
  });
});

describe("estimateHbA1c — degenerate windows", () => {
  it("degrades gracefully when only recent is present", () => {
    const readings = fillWindow(140, 30, 0, 30);
    const result = estimateHbA1c({ readings, now: NOW });
    expect(result?.weightedAverageMgDl).toBe(140);
    expect(result?.windows.middle.readingCount).toBe(0);
    expect(result?.windows.oldest.readingCount).toBe(0);
  });

  it("returns a windowStat with zero count/mean for empty buckets", () => {
    const readings = [...fillWindow(140, 25, 0, 30), ...fillWindow(160, 10, 30, 60)];
    const result = estimateHbA1c({ readings, now: NOW });
    expect(result?.windows.oldest.readingCount).toBe(0);
    expect(result?.windows.oldest.meanMgDl).toBe(0);
  });
});

describe("estimateHbA1c — property tests", () => {
  it("hba1cPercent is never NaN and is monotonic in mean glucose", () => {
    fc.assert(
      fc.property(fc.integer({ min: 60, max: 350 }), (mean) => {
        const readings = fillWindow(mean, 30, 0, 30);
        const result = estimateHbA1c({ readings, now: NOW });
        if (result === null) return false; // 30 readings + recent window — must return
        if (Number.isNaN(result.hba1cPercent)) return false;
        // For a flat input, weightedAverage must equal mean
        if (result.weightedAverageMgDl !== mean) return false;
        // Higher mean must yield higher hba1cPercent
        if (mean === 60) return result.hba1cPercent < 4;
        if (mean === 350) return result.hba1cPercent > 13;
        return true;
      }),
    );
  });

  it("returns null whenever total < 30 readings regardless of distribution", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 29 }), (count) => {
        const readings = fillWindow(140, count, 0, 30);
        return estimateHbA1c({ readings, now: NOW }) === null;
      }),
    );
  });
});
