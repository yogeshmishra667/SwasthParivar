import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { detectTrend } from "./trend.js";
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

describe("detectTrend — minimum-data gates", () => {
  it("returns null with fewer than 5 same-type readings in window", () => {
    const readings: TypedReading[] = [
      r("a", 100, 0),
      r("b", 110, 2),
      r("c", 120, 4),
      r("d", 130, 6),
    ];
    expect(
      detectTrend({
        readings,
        windowDays: 14,
        targetReadingType: "fasting",
        now: NOW,
      }),
    ).toBeNull();
  });

  it("returns null when readings are packed into < 1/3 of the window", () => {
    // 5 readings spread across 3 days inside a 14-day window — fails
    // the span guard (need ≥ floor(14/3)=4 days of span).
    const readings: TypedReading[] = [
      r("a", 100, 0),
      r("b", 110, 1),
      r("c", 120, 2),
      r("d", 130, 2),
      r("e", 140, 3),
    ];
    expect(
      detectTrend({
        readings,
        windowDays: 14,
        targetReadingType: "fasting",
        now: NOW,
      }),
    ).toBeNull();
  });

  it("returns null when all timestamps collapse to one instant (slope undefined)", () => {
    const readings: TypedReading[] = [
      r("a", 100, 5),
      r("b", 110, 5),
      r("c", 120, 5),
      r("d", 130, 5),
      r("e", 140, 5),
    ];
    expect(
      detectTrend({
        readings,
        windowDays: 14,
        targetReadingType: "fasting",
        now: NOW,
      }),
    ).toBeNull();
  });

  it("returns null when R² is below 0.5 (scatter, not a trend)", () => {
    const readings: TypedReading[] = [
      r("a", 100, 0),
      r("b", 200, 3),
      r("c", 50, 6),
      r("d", 180, 9),
      r("e", 110, 12),
    ];
    expect(
      detectTrend({
        readings,
        windowDays: 14,
        targetReadingType: "fasting",
        now: NOW,
      }),
    ).toBeNull();
  });

  it("returns null when slope is below the noise floor (< 1 mg/dL/day)", () => {
    // Perfectly fit but slope is 0.5 mg/dL/day → drift not actionable.
    const readings: TypedReading[] = [
      r("a", 100, 0),
      r("b", 99.5, 1),
      r("c", 99, 2),
      r("d", 98.5, 3),
      r("e", 98, 4),
      r("f", 97.5, 5),
    ].map((x) => ({ ...x, valueMgDl: Math.round(x.valueMgDl) }));
    // Round to ints → still ~0.5 slope, ~null trend.
    const result = detectTrend({
      readings,
      windowDays: 14,
      targetReadingType: "fasting",
      now: NOW,
    });
    // Either null or a result whose absSlope >= 1 — we want null here.
    expect(result).toBeNull();
  });
});

describe("detectTrend — same-type isolation", () => {
  it("excludes other reading types from the regression", () => {
    // 5 fasting readings on a clean upward slope. Inject post_meal
    // outliers on the same days — they must NOT pull the fit.
    const readings: TypedReading[] = [
      r("a", 100, 12, "fasting"),
      r("b", 115, 9, "fasting"),
      r("c", 130, 6, "fasting"),
      r("d", 145, 3, "fasting"),
      r("e", 160, 0, "fasting"),
      r("noise1", 50, 12, "post_meal"),
      r("noise2", 60, 6, "post_meal"),
      r("noise3", 70, 0, "post_meal"),
    ];
    const result = detectTrend({
      readings,
      windowDays: 14,
      targetReadingType: "fasting",
      now: NOW,
    });
    expect(result).not.toBeNull();
    expect(result!.messageParams.direction).toBe("increasing");
    expect(result!.evidence.sampleSize).toBe(5);
  });
});

describe("detectTrend — severity bands", () => {
  it("flags slow trend (1 ≤ slope < 2) at info", () => {
    const readings: TypedReading[] = [
      r("a", 100, 0),
      r("b", 102, 2),
      r("c", 104, 4),
      r("d", 106, 6),
      r("e", 108, 8),
      r("f", 110, 10),
    ];
    const result = detectTrend({
      readings,
      windowDays: 14,
      targetReadingType: "fasting",
      now: NOW,
    });
    expect(result).not.toBeNull();
    expect(result!.severityLevel).toBe("info");
    expect(result!.messageKey).toBe("insight.trend.slow");
  });

  it("flags notable trend (2 ≤ slope < 5) at warn", () => {
    const readings: TypedReading[] = [
      r("a", 100, 0),
      r("b", 103, 1),
      r("c", 106, 2),
      r("d", 109, 3),
      r("e", 112, 4),
      r("f", 115, 5),
    ];
    const result = detectTrend({
      readings,
      windowDays: 14,
      targetReadingType: "fasting",
      now: NOW,
    });
    expect(result).not.toBeNull();
    expect(result!.severityLevel).toBe("warn");
    expect(result!.messageKey).toBe("insight.trend.notable");
  });

  it("flags rapid trend (slope ≥ 5) at critical", () => {
    const readings: TypedReading[] = [
      r("a", 100, 0),
      r("b", 110, 1),
      r("c", 120, 2),
      r("d", 130, 3),
      r("e", 140, 4),
      r("f", 150, 5),
    ];
    const result = detectTrend({
      readings,
      windowDays: 14,
      targetReadingType: "fasting",
      now: NOW,
    });
    expect(result).not.toBeNull();
    expect(result!.severityLevel).toBe("critical");
    expect(result!.messageKey).toBe("insight.trend.rapid");
  });
});

describe("detectTrend — direction", () => {
  it("tags decreasing slope correctly", () => {
    // daysAgo=0 is the newest reading. For a *decreasing-over-time*
    // trend, older readings (higher daysAgo) must have higher values.
    const readings: TypedReading[] = [
      r("a", 150, 0),
      r("b", 160, 2),
      r("c", 170, 4),
      r("d", 180, 6),
      r("e", 190, 8),
      r("f", 200, 10),
    ];
    const result = detectTrend({
      readings,
      windowDays: 14,
      targetReadingType: "fasting",
      now: NOW,
    });
    expect(result).not.toBeNull();
    expect(result!.messageParams.direction).toBe("decreasing");
  });
});

describe("detectTrend — confidence behaviour", () => {
  it("a tight notable fit comfortably clears the 0.7 feed floor", () => {
    const readings: TypedReading[] = [
      r("a", 100, 0),
      r("b", 103, 1),
      r("c", 106, 2),
      r("d", 109, 3),
      r("e", 112, 4),
      r("f", 115, 5),
      r("g", 118, 6),
      r("h", 121, 7),
    ];
    const result = detectTrend({
      readings,
      windowDays: 14,
      targetReadingType: "fasting",
      now: NOW,
    });
    expect(result).not.toBeNull();
    expect(result!.confidence).toBeGreaterThanOrEqual(0.7);
  });
});

describe("detectTrend — property invariants", () => {
  it("severityScore is always in [0, 100] when a result is returned", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 50, max: 300 }), { minLength: 5, maxLength: 30 }),
        (values) => {
          const readings: TypedReading[] = values.map((v, i) => r(`x${i}`, v, i));
          const result = detectTrend({
            readings,
            windowDays: 30,
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
        fc.array(fc.integer({ min: 50, max: 300 }), { minLength: 5, maxLength: 30 }),
        (values) => {
          const readings: TypedReading[] = values.map((v, i) => r(`x${i}`, v, i));
          const result = detectTrend({
            readings,
            windowDays: 30,
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
