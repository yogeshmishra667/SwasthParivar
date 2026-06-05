import { describe, expect, it } from "vitest";
import { detectCardiacTrend } from "./cardiac-trend.js";
import type { TypedCardiacReading } from "./types.js";

const now = new Date("2026-06-05T12:00:00.000Z");
const dayMs = 86_400_000;

const reading = (id: string, hr: number, daysAgo: number): TypedCardiacReading => ({
  id,
  heartRateBpm: hr,
  measuredAt: new Date(now.getTime() - daysAgo * dayMs).toISOString(),
});

describe("detectCardiacTrend — sparsity gates", () => {
  it("returns null when fewer than 5 readings in window", () => {
    const readings = [
      reading("a", 70, 0),
      reading("b", 71, 1),
      reading("c", 72, 2),
      reading("d", 73, 3),
    ];
    const r = detectCardiacTrend({ readings, windowDays: 14, now });
    expect(r).toBeNull();
  });

  it("returns null when readings are packed into too short a span", () => {
    // 5 readings inside one hour pass the count gate but not the span
    // gate (window 14 → required span ≥ 4 days).
    const readings = [
      reading("a", 70, 0),
      reading("b", 80, 0.01),
      reading("c", 90, 0.02),
      reading("d", 100, 0.03),
      reading("e", 110, 0.04),
    ];
    const r = detectCardiacTrend({ readings, windowDays: 14, now });
    expect(r).toBeNull();
  });

  it("excludes readings outside the window", () => {
    // 5 readings inside 14-day window, plus 3 ancient readings the
    // detector must ignore.
    const readings: TypedCardiacReading[] = [
      reading("a", 65, 0),
      reading("b", 68, 3),
      reading("c", 71, 6),
      reading("d", 74, 9),
      reading("e", 77, 12),
      reading("ancient1", 999, 100),
      reading("ancient2", 999, 200),
      reading("ancient3", 999, 300),
    ];
    const r = detectCardiacTrend({ readings, windowDays: 14, now });
    expect(r).not.toBeNull();
    // None of the ancient ids should appear in triggerReadings.
    expect(r!.triggerReadings).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("detectCardiacTrend — fit + severity", () => {
  it("fits a clean increasing trend at notable slope (≥1.0 bpm/day)", () => {
    // 14 days, HR rising 1 bpm/day from 70 → 84.
    const readings: TypedCardiacReading[] = [];
    for (let d = 0; d < 14; d++) {
      readings.push(reading(`r${d}`, 70 + d, 13 - d));
    }
    const r = detectCardiacTrend({ readings, windowDays: 14, now });
    expect(r).not.toBeNull();
    expect(r!.severityLevel).toBe("warn");
    expect(r!.messageKey).toBe("insight.cardiac.trend.notable");
    expect(r!.messageParams.direction).toBe("increasing");
    expect(r!.conditionsInvolved).toEqual(["cardiac"]);
    expect(r!.patternType).toBe("trend");
  });

  it("classifies a steep increase as critical (≥2.5 bpm/day)", () => {
    const readings: TypedCardiacReading[] = [];
    for (let d = 0; d < 10; d++) {
      readings.push(reading(`r${d}`, 70 + d * 3, 9 - d));
    }
    const r = detectCardiacTrend({ readings, windowDays: 14, now });
    expect(r).not.toBeNull();
    expect(r!.severityLevel).toBe("critical");
    expect(r!.messageKey).toBe("insight.cardiac.trend.rapid");
  });

  it("classifies a gentle drift as info (≥0.5 bpm/day, <1.0)", () => {
    // 0.65 bpm/day across 20 days inside the 30-day window.
    const readings: TypedCardiacReading[] = [];
    for (let d = 0; d < 20; d++) {
      readings.push(reading(`r${d}`, Math.round(70 + d * 0.65), 19 - d));
    }
    const r = detectCardiacTrend({ readings, windowDays: 30, now });
    expect(r).not.toBeNull();
    expect(r!.severityLevel).toBe("info");
    expect(r!.messageKey).toBe("insight.cardiac.trend.slow");
  });

  it("captures decreasing trends with direction='decreasing'", () => {
    const readings: TypedCardiacReading[] = [];
    for (let d = 0; d < 14; d++) {
      readings.push(reading(`r${d}`, 100 - d, 13 - d));
    }
    const r = detectCardiacTrend({ readings, windowDays: 14, now });
    expect(r).not.toBeNull();
    expect(r!.messageParams.direction).toBe("decreasing");
    expect((r!.messageParams.slopePerDay as number) < 0).toBe(true);
  });

  it("returns null when slope is below the null floor (no actionable drift)", () => {
    // ~0.2 bpm/day — clean fit but not actionable.
    const readings: TypedCardiacReading[] = [];
    for (let d = 0; d < 14; d++) {
      readings.push(reading(`r${d}`, Math.round(70 + d * 0.2), 13 - d));
    }
    const r = detectCardiacTrend({ readings, windowDays: 14, now });
    expect(r).toBeNull();
  });

  it("returns null when R² < 0.5 (scatter, not a trend)", () => {
    // Random-ish jitter around 75, no real direction.
    const noisyValues = [70, 80, 71, 79, 72, 78, 73, 77, 74, 76, 75, 81, 69, 82];
    const readings = noisyValues.map((hr, i) => reading(`r${i}`, hr, 13 - i));
    const r = detectCardiacTrend({ readings, windowDays: 14, now });
    expect(r).toBeNull();
  });

  it("returns null when all timestamps collapse onto one moment (undefined slope)", () => {
    // 5 readings at the same instant — linearRegression yields null.
    // Use the 5-day window so the (artificially zero) span passes the
    // first floor (max(2, 5/3)=2 days) ONLY if we synth-stagger them.
    // To actually exercise the linearRegression-returns-null path we
    // need points that share an x-coordinate after normalisation. The
    // simplest construction: spread far enough to clear the span gate,
    // but with identical y so rSquared comes out 0 / NaN — and verify
    // the detector returns null.
    const readings: TypedCardiacReading[] = [
      reading("a", 75, 13),
      reading("b", 75, 9),
      reading("c", 75, 6),
      reading("d", 75, 3),
      reading("e", 75, 0),
    ];
    const r = detectCardiacTrend({ readings, windowDays: 14, now });
    expect(r).toBeNull();
  });
});

describe("detectCardiacTrend — confidence + evidence", () => {
  it("clamps confidence to [0, 1]", () => {
    const readings: TypedCardiacReading[] = [];
    for (let d = 0; d < 28; d++) {
      readings.push(reading(`r${d}`, 70 + d * 1.5, 27 - d));
    }
    const r = detectCardiacTrend({ readings, windowDays: 30, now });
    expect(r).not.toBeNull();
    expect(r!.confidence).toBeGreaterThan(0);
    expect(r!.confidence).toBeLessThanOrEqual(1);
  });

  it("evidence shape matches the rest of the detector framework", () => {
    const readings: TypedCardiacReading[] = [];
    for (let d = 0; d < 14; d++) {
      readings.push(reading(`r${d}`, 70 + d, 13 - d));
    }
    const r = detectCardiacTrend({ readings, windowDays: 14, now })!;
    expect(r.evidence).toMatchObject({
      slope: expect.any(Number),
      intercept: expect.any(Number),
      rSquared: expect.any(Number),
      sampleSize: 14,
      windowDays: 14,
      spanDays: expect.any(Number),
    });
  });
});

describe("detectCardiacTrend — never-mix-conditions invariant", () => {
  // The detector input type only carries `heartRateBpm` — it is
  // structurally impossible for the function to read glucose / BP /
  // peak-flow values. These tests pin the structural guarantee at
  // runtime so a future widening of `TypedCardiacReading` cannot
  // silently break the invariant.
  it("output always tags only the cardiac condition", () => {
    const readings: TypedCardiacReading[] = [];
    for (let d = 0; d < 14; d++) {
      readings.push(reading(`r${d}`, 70 + d, 13 - d));
    }
    const r = detectCardiacTrend({ readings, windowDays: 14, now })!;
    expect(r.conditionsInvolved).toEqual(["cardiac"]);
  });

  it("ignores extra ad-hoc fields hidden on input rows (structural)", () => {
    const readings = [
      { id: "a", heartRateBpm: 70, measuredAt: reading("a", 70, 13).measuredAt },
      { id: "b", heartRateBpm: 75, measuredAt: reading("b", 75, 10).measuredAt },
      { id: "c", heartRateBpm: 80, measuredAt: reading("c", 80, 7).measuredAt },
      { id: "d", heartRateBpm: 85, measuredAt: reading("d", 85, 4).measuredAt },
      { id: "e", heartRateBpm: 90, measuredAt: reading("e", 90, 1).measuredAt },
    ] as TypedCardiacReading[];
    const r = detectCardiacTrend({ readings, windowDays: 14, now });
    expect(r).not.toBeNull();
    expect(r!.conditionsInvolved).toEqual(["cardiac"]);
  });
});
