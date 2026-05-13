import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { detectAnomaly } from "./anomaly.js";
import type { TypedReading } from "./types.js";

const NOW = new Date("2026-05-13T08:00:00.000Z");
const dayMs = 86_400_000;

const r = (
  id: string,
  value: number,
  daysAgo: number,
  readingType: TypedReading["readingType"] = "fasting",
): TypedReading => ({
  id,
  valueMgDl: value,
  readingType,
  measuredAt: new Date(NOW.getTime() - daysAgo * dayMs).toISOString(),
});

/**
 * Build a 21-day baseline of values [start, start+step, start+2*step, ...]
 * one reading per day. Use this so tests don't have to hand-craft 21 entries.
 */
const baseline21 = (start = 100, step = 1): TypedReading[] => {
  const out: TypedReading[] = [];
  for (let day = 1; day <= 21; day++) {
    out.push(r(`b${day}`, start + (day - 1) * step, day));
  }
  return out;
};

describe("detectAnomaly — minimum-data gates", () => {
  it("returns null with no readings", () => {
    expect(
      detectAnomaly({
        readings: [],
        targetReadingId: "x",
        targetReadingType: "fasting",
        now: NOW,
      }),
    ).toBeNull();
  });

  it("returns null when target is missing", () => {
    expect(
      detectAnomaly({
        readings: baseline21(),
        targetReadingId: "ghost",
        targetReadingType: "fasting",
        now: NOW,
      }),
    ).toBeNull();
  });

  it("returns null with fewer than 5 history points", () => {
    const readings: TypedReading[] = [
      r("target", 999, 0),
      r("a", 100, 1),
      r("b", 110, 2),
      r("c", 120, 3),
    ];
    expect(
      detectAnomaly({
        readings,
        targetReadingId: "target",
        targetReadingType: "fasting",
        now: NOW,
      }),
    ).toBeNull();
  });

  it("returns null when same-type history spans < 21 days", () => {
    const readings: TypedReading[] = [
      r("target", 999, 0),
      r("a", 100, 1),
      r("b", 110, 5),
      r("c", 105, 10),
      r("d", 108, 15),
      r("e", 102, 18),
    ];
    expect(
      detectAnomaly({
        readings,
        targetReadingId: "target",
        targetReadingType: "fasting",
        now: NOW,
      }),
    ).toBeNull();
  });

  it("returns null when IQR is zero (constant baseline)", () => {
    const readings: TypedReading[] = [
      r("target", 200, 0),
      ...Array.from({ length: 21 }, (_, i) => r(`b${i}`, 100, i + 1)),
    ];
    expect(
      detectAnomaly({
        readings,
        targetReadingId: "target",
        targetReadingType: "fasting",
        now: NOW,
      }),
    ).toBeNull();
  });
});

describe("detectAnomaly — same-type isolation", () => {
  it("ignores readings of a different type", () => {
    // Fasting baseline 100-120, target fasting=200 should be flagged.
    // post_meal injections at 250 must NOT contaminate the IQR.
    const readings: TypedReading[] = [
      r("target", 200, 0, "fasting"),
      ...baseline21(100, 1),
      r("noise1", 250, 1, "post_meal"),
      r("noise2", 250, 2, "post_meal"),
      r("noise3", 250, 3, "post_meal"),
    ];
    const result = detectAnomaly({
      readings,
      targetReadingId: "target",
      targetReadingType: "fasting",
      now: NOW,
    });
    expect(result).not.toBeNull();
    // q3 of the fasting-only history should be far below 200.
    expect(result!.evidence.q3).toBeLessThan(140);
  });
});

describe("detectAnomaly — fence bands", () => {
  it("returns null when value is inside the fences", () => {
    // baseline 100..120 → Q1≈105, Q3≈115, IQR≈10, fences ≈ [90, 130].
    // target 118 is inside.
    const readings: TypedReading[] = [r("target", 118, 0), ...baseline21(100, 1)];
    expect(
      detectAnomaly({
        readings,
        targetReadingId: "target",
        targetReadingType: "fasting",
        now: NOW,
      }),
    ).toBeNull();
  });

  it("flags a mild high outlier at severity=warn", () => {
    const readings: TypedReading[] = [r("target", 140, 0), ...baseline21(100, 1)];
    const result = detectAnomaly({
      readings,
      targetReadingId: "target",
      targetReadingType: "fasting",
      now: NOW,
    });
    expect(result).not.toBeNull();
    expect(result!.severityLevel).toBe("warn");
    expect(result!.messageParams.direction).toBe("high");
  });

  it("flags an extreme high outlier (≥ 3*IQR beyond Q3) at severity=critical", () => {
    // Q3≈115, IQR≈10 → 3*IQR = 30, extreme upper ≈ 145. Target 200 is well past.
    const readings: TypedReading[] = [r("target", 200, 0), ...baseline21(100, 1)];
    const result = detectAnomaly({
      readings,
      targetReadingId: "target",
      targetReadingType: "fasting",
      now: NOW,
    });
    expect(result).not.toBeNull();
    expect(result!.severityLevel).toBe("critical");
    expect(result!.evidence.extreme).toBe(true);
  });

  it("flags a low outlier with direction=low", () => {
    // Target sits well below Q1 - 1.5*IQR.
    const readings: TypedReading[] = [r("target", 50, 0), ...baseline21(100, 1)];
    const result = detectAnomaly({
      readings,
      targetReadingId: "target",
      targetReadingType: "fasting",
      now: NOW,
    });
    expect(result).not.toBeNull();
    expect(result!.messageParams.direction).toBe("low");
    expect(result!.messageKey).toMatch(/_low$/);
  });
});

describe("detectAnomaly — confidence behaviour", () => {
  it("extreme anomalies always clear the 0.7 feed floor", () => {
    const readings: TypedReading[] = [r("target", 250, 0), ...baseline21(100, 1)];
    const result = detectAnomaly({
      readings,
      targetReadingId: "target",
      targetReadingType: "fasting",
      now: NOW,
    });
    expect(result).not.toBeNull();
    expect(result!.confidence).toBeGreaterThanOrEqual(0.7);
  });
});

describe("detectAnomaly — property invariants", () => {
  it("severityScore is always in [0, 100] when a result is returned", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 60, max: 400 }), {
          minLength: 22,
          maxLength: 30,
        }),
        (values) => {
          const target = values[0]!;
          const baseline = values.slice(1).map((v, i) => r(`b${i}`, v, i + 1));
          const readings: TypedReading[] = [r("target", target, 0), ...baseline];
          const result = detectAnomaly({
            readings,
            targetReadingId: "target",
            targetReadingType: "fasting",
            now: NOW,
          });
          if (result === null) return true;
          return result.severityScore >= 0 && result.severityScore <= 100;
        },
      ),
    );
  });

  it("confidence is always in [0, 1] when a result is returned", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 60, max: 400 }), {
          minLength: 22,
          maxLength: 30,
        }),
        (values) => {
          const target = values[0]!;
          const baseline = values.slice(1).map((v, i) => r(`b${i}`, v, i + 1));
          const readings: TypedReading[] = [r("target", target, 0), ...baseline];
          const result = detectAnomaly({
            readings,
            targetReadingId: "target",
            targetReadingType: "fasting",
            now: NOW,
          });
          if (result === null) return true;
          return result.confidence >= 0 && result.confidence <= 1;
        },
      ),
    );
  });
});
