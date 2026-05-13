import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  mean,
  median,
  stdDev,
  iqr,
  linearRegression,
  rollingMedian,
  daysBetween,
} from "./stats.js";

describe("mean", () => {
  it("returns 0 for empty input (never NaN)", () => {
    expect(mean([])).toBe(0);
  });

  it("returns the value itself for a single-element sample", () => {
    expect(mean([42])).toBe(42);
  });

  it("computes arithmetic mean", () => {
    expect(mean([1, 2, 3, 4, 5])).toBe(3);
  });

  it("handles negative numbers", () => {
    expect(mean([-2, 0, 2])).toBe(0);
  });
});

describe("median", () => {
  it("returns 0 for empty input", () => {
    expect(median([])).toBe(0);
  });

  it("returns the middle element for odd-length samples", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("averages the two middle elements for even-length samples", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("is order-independent", () => {
    expect(median([5, 1, 3, 4, 2])).toBe(median([1, 2, 3, 4, 5]));
  });

  it("does not mutate the input array", () => {
    const input = [3, 1, 2];
    median(input);
    expect(input).toEqual([3, 1, 2]);
  });
});

describe("stdDev", () => {
  it("returns 0 for empty input", () => {
    expect(stdDev([])).toBe(0);
  });

  it("returns 0 for constant input", () => {
    expect(stdDev([5, 5, 5, 5])).toBe(0);
  });

  it("computes population stdDev (matches known value)", () => {
    // For [2, 4, 4, 4, 5, 5, 7, 9]: mean = 5, population variance = 4
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
  });
});

describe("iqr", () => {
  it("returns zeros for empty input", () => {
    expect(iqr([])).toEqual({ q1: 0, q3: 0, iqr: 0 });
  });

  it("returns iqr=0 for constant input (anomaly detector must not divide by zero)", () => {
    const r = iqr([7, 7, 7, 7, 7]);
    expect(r.iqr).toBe(0);
  });

  it("handles a single-element sample (q1 = q3 = the value)", () => {
    expect(iqr([5])).toEqual({ q1: 5, q3: 5, iqr: 0 });
  });

  it("computes Tukey hinges on the canonical [1..9] sample", () => {
    // P25 of [1..9] = 3, P75 = 7, IQR = 4 with linear interpolation
    expect(iqr([1, 2, 3, 4, 5, 6, 7, 8, 9])).toEqual({ q1: 3, q3: 7, iqr: 4 });
  });

  it("is order-independent", () => {
    const r1 = iqr([5, 1, 9, 3, 7]);
    const r2 = iqr([1, 3, 5, 7, 9]);
    expect(r1).toEqual(r2);
  });
});

describe("linearRegression", () => {
  it("returns null for fewer than 2 points", () => {
    expect(linearRegression([])).toBeNull();
    expect(linearRegression([{ x: 1, y: 2 }])).toBeNull();
  });

  it("returns null when all x are identical (slope undefined)", () => {
    expect(
      linearRegression([
        { x: 5, y: 10 },
        { x: 5, y: 20 },
        { x: 5, y: 30 },
      ]),
    ).toBeNull();
  });

  it("recovers a perfect line: y = 2x + 3 → slope=2, intercept=3, R²=1", () => {
    const r = linearRegression([
      { x: 0, y: 3 },
      { x: 1, y: 5 },
      { x: 2, y: 7 },
      { x: 3, y: 9 },
    ]);
    expect(r).not.toBeNull();
    expect(r!.slope).toBeCloseTo(2, 10);
    expect(r!.intercept).toBeCloseTo(3, 10);
    expect(r!.rSquared).toBeCloseTo(1, 10);
  });

  it("returns slope=0, R²=0 for constant y", () => {
    const r = linearRegression([
      { x: 0, y: 100 },
      { x: 1, y: 100 },
      { x: 2, y: 100 },
    ]);
    expect(r).not.toBeNull();
    expect(r!.slope).toBe(0);
    expect(r!.rSquared).toBe(0);
  });

  it("yields low R² for scatter (no real trend)", () => {
    const r = linearRegression([
      { x: 0, y: 100 },
      { x: 1, y: 200 },
      { x: 2, y: 50 },
      { x: 3, y: 180 },
      { x: 4, y: 110 },
    ]);
    expect(r).not.toBeNull();
    // R² should be well below the 0.5 trend-detector gate.
    expect(r!.rSquared).toBeLessThan(0.5);
  });
});

describe("rollingMedian", () => {
  it("returns 0 when no points fall in the window", () => {
    const day = 86_400_000;
    const now = 100 * day;
    // measuredAtMs sits 50 days in the past; window is only 7 days.
    expect(
      rollingMedian(
        [{ measuredAtMs: 50 * day, value: 100 }],
        now,
        7 * day,
      ),
    ).toBe(0);
  });

  it("includes only points in [now - window, now]", () => {
    const now = 1_000_000;
    const day = 86_400_000;
    const points = [
      { measuredAtMs: now - 2 * day, value: 999 }, // outside
      { measuredAtMs: now - day + 1, value: 100 }, // inside
      { measuredAtMs: now - day / 2, value: 200 }, // inside
      { measuredAtMs: now, value: 300 }, // inside (boundary)
    ];
    // median of [100, 200, 300] = 200
    expect(rollingMedian(points, now, day)).toBe(200);
  });
});

describe("daysBetween", () => {
  it("returns 0 when later is before earlier (clamped)", () => {
    expect(daysBetween(2_000_000_000, 1_000_000_000)).toBe(0);
  });

  it("returns 0 for the same instant", () => {
    expect(daysBetween(1_000_000, 1_000_000)).toBe(0);
  });

  it("counts whole 24-hour buckets", () => {
    const dayMs = 86_400_000;
    expect(daysBetween(0, 7 * dayMs)).toBe(7);
    expect(daysBetween(0, 7 * dayMs - 1)).toBe(6); // less than 7 full days
  });
});

// ─────────────────────────────────────────────────────────────
// Property tests — invariants that must hold for any input.
// ─────────────────────────────────────────────────────────────

describe("stats — property invariants", () => {
  it("median is always in [min, max]", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -1000, max: 1000 }), { minLength: 1 }),
        (xs) => {
          const m = median(xs);
          const lo = Math.min(...xs);
          const hi = Math.max(...xs);
          return m >= lo && m <= hi;
        },
      ),
    );
  });

  it("stdDev is always ≥ 0", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -10000, max: 10000 })), (xs) => {
        return stdDev(xs) >= 0;
      }),
    );
  });

  it("iqr.iqr is always ≥ 0", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -10000, max: 10000 })), (xs) => {
        return iqr(xs).iqr >= 0;
      }),
    );
  });

  it("linearRegression is deterministic for the same input", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            x: fc.integer({ min: 0, max: 100 }),
            y: fc.integer({ min: -1000, max: 1000 }),
          }),
          { minLength: 3, maxLength: 50 },
        ),
        (points) => {
          const a = linearRegression(points);
          const b = linearRegression(points);
          return JSON.stringify(a) === JSON.stringify(b);
        },
      ),
    );
  });
});
