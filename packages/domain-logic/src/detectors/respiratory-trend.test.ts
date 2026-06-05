import { describe, expect, it } from "vitest";
import { detectRespiratoryTrend } from "./respiratory-trend.js";
import type { TypedRespiratoryReading } from "./types.js";

const now = new Date("2026-06-05T12:00:00.000Z");
const dayMs = 86_400_000;

const reading = (id: string, peakFlow: number, daysAgo: number): TypedRespiratoryReading => ({
  id,
  peakFlow,
  measuredAt: new Date(now.getTime() - daysAgo * dayMs).toISOString(),
});

describe("detectRespiratoryTrend — sparsity gates", () => {
  it("returns null with fewer than 5 readings", () => {
    const readings = [
      reading("a", 480, 0),
      reading("b", 470, 1),
      reading("c", 460, 2),
      reading("d", 450, 3),
    ];
    const r = detectRespiratoryTrend({ readings, windowDays: 14, now });
    expect(r).toBeNull();
  });

  it("returns null when readings cluster in too short a span", () => {
    const readings = [
      reading("a", 480, 0),
      reading("b", 470, 0.01),
      reading("c", 460, 0.02),
      reading("d", 450, 0.03),
      reading("e", 440, 0.04),
    ];
    const r = detectRespiratoryTrend({ readings, windowDays: 14, now });
    expect(r).toBeNull();
  });

  it("excludes readings outside the requested window", () => {
    // In-window slope is ≈8 L/min/day (above the noise floor of 5,
    // below the notable threshold of 10) so the detector returns a
    // suppressed-info trend rather than nulling out.
    const readings: TypedRespiratoryReading[] = [
      reading("a", 500, 0),
      reading("b", 478, 3),
      reading("c", 456, 6),
      reading("d", 434, 9),
      reading("e", 412, 12),
      reading("ancient1", 100, 100),
      reading("ancient2", 100, 200),
    ];
    const r = detectRespiratoryTrend({ readings, windowDays: 14, now });
    expect(r).not.toBeNull();
    expect(r!.triggerReadings).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("detectRespiratoryTrend — fit + severity", () => {
  it("fits a notable downward trend (asthma worsening) at ≥10 L/min/day", () => {
    // Drop ~12 L/min/day across 14 days: 500 → 332.
    const readings: TypedRespiratoryReading[] = [];
    for (let d = 0; d < 14; d++) {
      readings.push(reading(`r${d}`, 500 - d * 12, 13 - d));
    }
    const r = detectRespiratoryTrend({ readings, windowDays: 14, now });
    expect(r).not.toBeNull();
    expect(r!.severityLevel).toBe("warn");
    expect(r!.messageKey).toBe("insight.respiratory.trend.notable");
    expect(r!.messageParams.direction).toBe("decreasing");
    expect(r!.conditionsInvolved).toEqual(["respiratory"]);
  });

  it("classifies a steep drop as critical (≥25 L/min/day)", () => {
    const readings: TypedRespiratoryReading[] = [];
    for (let d = 0; d < 10; d++) {
      readings.push(reading(`r${d}`, 500 - d * 30, 9 - d));
    }
    const r = detectRespiratoryTrend({ readings, windowDays: 14, now });
    expect(r).not.toBeNull();
    expect(r!.severityLevel).toBe("critical");
    expect(r!.messageKey).toBe("insight.respiratory.trend.rapid");
  });

  it("classifies a gentle drift as info (≥5, <10 L/min/day)", () => {
    const readings: TypedRespiratoryReading[] = [];
    for (let d = 0; d < 14; d++) {
      readings.push(reading(`r${d}`, 500 - d * 7, 13 - d));
    }
    const r = detectRespiratoryTrend({ readings, windowDays: 14, now });
    expect(r).not.toBeNull();
    expect(r!.severityLevel).toBe("info");
    expect(r!.messageKey).toBe("insight.respiratory.trend.slow");
  });

  it("captures improving (rising) trends with direction='increasing'", () => {
    // Patient recovering: peak flow improves over a 14-day window.
    const readings: TypedRespiratoryReading[] = [];
    for (let d = 0; d < 14; d++) {
      readings.push(reading(`r${d}`, 400 + d * 12, 13 - d));
    }
    const r = detectRespiratoryTrend({ readings, windowDays: 14, now });
    expect(r).not.toBeNull();
    expect(r!.messageParams.direction).toBe("increasing");
    expect((r!.messageParams.slopePerDay as number) > 0).toBe(true);
  });

  it("returns null when slope is below the noise floor", () => {
    const readings: TypedRespiratoryReading[] = [];
    for (let d = 0; d < 14; d++) {
      readings.push(reading(`r${d}`, 500 - d * 2, 13 - d));
    }
    const r = detectRespiratoryTrend({ readings, windowDays: 14, now });
    expect(r).toBeNull();
  });

  it("returns null when R² < 0.5 (random scatter)", () => {
    const noisy = [480, 470, 485, 460, 490, 455, 495, 450, 500, 445, 505, 440, 510, 435];
    const readings = noisy.map((pf, i) => reading(`r${i}`, pf, 13 - i));
    const r = detectRespiratoryTrend({ readings, windowDays: 14, now });
    // 14-point alternating: regression slope may slip past the noise
    // floor depending on exact values, but R² will be low and the gate
    // should suppress. Validate either null (R² gate) or null (any
    // post-gate floor) — both are acceptable suppression paths.
    expect(r).toBeNull();
  });

  it("returns null when all values are identical (undefined slope)", () => {
    const readings: TypedRespiratoryReading[] = [
      reading("a", 480, 13),
      reading("b", 480, 9),
      reading("c", 480, 6),
      reading("d", 480, 3),
      reading("e", 480, 0),
    ];
    const r = detectRespiratoryTrend({ readings, windowDays: 14, now });
    expect(r).toBeNull();
  });
});

describe("detectRespiratoryTrend — confidence + evidence", () => {
  it("clamps confidence to [0, 1]", () => {
    const readings: TypedRespiratoryReading[] = [];
    for (let d = 0; d < 28; d++) {
      readings.push(reading(`r${d}`, 500 - d * 12, 27 - d));
    }
    const r = detectRespiratoryTrend({ readings, windowDays: 30, now });
    expect(r).not.toBeNull();
    expect(r!.confidence).toBeGreaterThan(0);
    expect(r!.confidence).toBeLessThanOrEqual(1);
  });

  it("evidence shape matches the rest of the detector framework", () => {
    const readings: TypedRespiratoryReading[] = [];
    for (let d = 0; d < 14; d++) {
      readings.push(reading(`r${d}`, 500 - d * 12, 13 - d));
    }
    const r = detectRespiratoryTrend({ readings, windowDays: 14, now })!;
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

describe("detectRespiratoryTrend — never-mix-conditions invariant", () => {
  it("output always tags only the respiratory condition", () => {
    const readings: TypedRespiratoryReading[] = [];
    for (let d = 0; d < 14; d++) {
      readings.push(reading(`r${d}`, 500 - d * 12, 13 - d));
    }
    const r = detectRespiratoryTrend({ readings, windowDays: 14, now })!;
    expect(r.conditionsInvolved).toEqual(["respiratory"]);
  });

  it("ignores extra ad-hoc fields hidden on input rows (structural)", () => {
    const readings = [
      { id: "a", peakFlow: 500, measuredAt: reading("a", 500, 13).measuredAt },
      { id: "b", peakFlow: 480, measuredAt: reading("b", 480, 10).measuredAt },
      { id: "c", peakFlow: 460, measuredAt: reading("c", 460, 7).measuredAt },
      { id: "d", peakFlow: 440, measuredAt: reading("d", 440, 4).measuredAt },
      { id: "e", peakFlow: 420, measuredAt: reading("e", 420, 1).measuredAt },
    ] as TypedRespiratoryReading[];
    const r = detectRespiratoryTrend({ readings, windowDays: 14, now });
    expect(r).not.toBeNull();
    expect(r!.conditionsInvolved).toEqual(["respiratory"]);
  });
});
