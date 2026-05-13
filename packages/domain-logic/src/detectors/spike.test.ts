import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { detectSpike } from "./spike.js";
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

describe("detectSpike — minimum-data gates", () => {
  it("returns null when no readings exist", () => {
    expect(
      detectSpike({
        readings: [],
        targetReadingId: "x",
        targetReadingType: "fasting",
        now: NOW,
      }),
    ).toBeNull();
  });

  it("returns null when target id is not present", () => {
    expect(
      detectSpike({
        readings: [r("a", 100, 1)],
        targetReadingId: "missing",
        targetReadingType: "fasting",
        now: NOW,
      }),
    ).toBeNull();
  });

  it("returns null with fewer than 3 history points", () => {
    expect(
      detectSpike({
        readings: [r("target", 200, 0), r("a", 100, 7)],
        targetReadingId: "target",
        targetReadingType: "fasting",
        now: NOW,
      }),
    ).toBeNull();
  });

  it("returns null when same-type data spans < 7 days", () => {
    // 4 history points clumped into 5 days → minimum-data gate fails.
    const readings: TypedReading[] = [
      r("target", 250, 0),
      r("a", 100, 1),
      r("b", 105, 2),
      r("c", 110, 3),
      r("d", 108, 4),
    ];
    expect(
      detectSpike({
        readings,
        targetReadingId: "target",
        targetReadingType: "fasting",
        now: NOW,
      }),
    ).toBeNull();
  });

  it("returns null when stdDev is zero and value is below critical-high", () => {
    // Identical baseline + non-critical value → no spike concept.
    const readings: TypedReading[] = [
      r("target", 130, 0),
      r("a", 110, 1),
      r("b", 110, 4),
      r("c", 110, 7),
      r("d", 110, 10),
    ];
    expect(
      detectSpike({
        readings,
        targetReadingId: "target",
        targetReadingType: "fasting",
        now: NOW,
      }),
    ).toBeNull();
  });
});

describe("detectSpike — same-type isolation", () => {
  it("ignores readings of a different type when building the baseline", () => {
    // Fasting target ~250 against fasting baseline 100s; post_meal noise
    // injected at 200s should NOT raise the baseline.
    const readings: TypedReading[] = [
      r("target", 250, 0, "fasting"),
      r("a", 100, 1, "fasting"),
      r("b", 105, 4, "fasting"),
      r("c", 95, 7, "fasting"),
      r("d", 100, 10, "fasting"),
      r("noise1", 200, 1, "post_meal"),
      r("noise2", 200, 2, "post_meal"),
    ];
    const result = detectSpike({
      readings,
      targetReadingId: "target",
      targetReadingType: "fasting",
      now: NOW,
    });
    expect(result).not.toBeNull();
    // Baseline should reflect fasting 100s only.
    expect(result!.evidence.baseline).toBe(100);
  });
});

describe("detectSpike — severity bands", () => {
  // Baseline = [100, 105, 95, 105, 95] → median 100, σ=√20 ≈ 4.47.
  // Choose targets that fall cleanly inside each band:
  //   mild         delta=7  → 1.57σ
  //   significant  delta=10 → 2.24σ
  //   severe       delta=20 → 4.47σ
  const tightBaseline = (): TypedReading[] => [
    r("a", 100, 1),
    r("b", 105, 4),
    r("c", 95, 7),
    r("d", 105, 10),
    r("e", 95, 13),
  ];

  it("flags mild (1.5σ ≤ d < 2σ) at severity=info", () => {
    const readings: TypedReading[] = [r("target", 107, 0), ...tightBaseline()];
    const result = detectSpike({
      readings,
      targetReadingId: "target",
      targetReadingType: "fasting",
      now: NOW,
    });
    expect(result).not.toBeNull();
    expect(result!.severityLevel).toBe("info");
    expect(result!.messageKey).toBe("insight.spike.mild");
  });

  it("flags significant (2σ ≤ d < 3σ) at severity=warn", () => {
    const readings: TypedReading[] = [r("target", 110, 0), ...tightBaseline()];
    const result = detectSpike({
      readings,
      targetReadingId: "target",
      targetReadingType: "fasting",
      now: NOW,
    });
    expect(result).not.toBeNull();
    expect(result!.severityLevel).toBe("warn");
    expect(result!.messageKey).toBe("insight.spike.significant");
  });

  it("flags severe (d ≥ 3σ) at severity=critical", () => {
    const readings: TypedReading[] = [r("target", 200, 0), ...tightBaseline()];
    const result = detectSpike({
      readings,
      targetReadingId: "target",
      targetReadingType: "fasting",
      now: NOW,
    });
    expect(result).not.toBeNull();
    expect(result!.severityLevel).toBe("critical");
    expect(result!.messageKey).toBe("insight.spike.severe");
  });
});

describe("detectSpike — critical-high override", () => {
  it("flags value > GLUCOSE_CRITICAL_HIGH as severe even with a wide baseline", () => {
    // Baseline of 100-300 (wild scatter, σ ≈ 70). Target 320 mg/dL.
    // Without the override the σ-distance is ~3σ — already severe.
    // With the override the result must be severe regardless.
    const readings: TypedReading[] = [
      r("target", 320, 0),
      r("a", 100, 1),
      r("b", 300, 4),
      r("c", 110, 7),
      r("d", 290, 10),
      r("e", 105, 13),
    ];
    const result = detectSpike({
      readings,
      targetReadingId: "target",
      targetReadingType: "fasting",
      now: NOW,
    });
    expect(result).not.toBeNull();
    expect(result!.severityLevel).toBe("critical");
    expect(result!.evidence.criticalHighOverride).toBe(true);
  });

  it("fires the critical-high path even when σ-distance is below mild", () => {
    // Pathological baseline that *includes* highs, so σ is huge and the
    // target's σ-distance is tiny — but the medical threshold still
    // demands "severe".
    const readings: TypedReading[] = [
      r("target", 316, 0),
      r("a", 50, 1),
      r("b", 300, 2),
      r("c", 60, 3),
      r("d", 310, 4),
      r("e", 55, 5),
      r("f", 305, 8),
    ];
    const result = detectSpike({
      readings,
      targetReadingId: "target",
      targetReadingType: "fasting",
      now: NOW,
    });
    expect(result).not.toBeNull();
    expect(result!.severityLevel).toBe("critical");
    expect(result!.evidence.criticalHighOverride).toBe(true);
  });
});

describe("detectSpike — confidence behaviour", () => {
  it("severe spikes always clear the 0.7 feed floor", () => {
    const readings: TypedReading[] = [
      r("target", 250, 0),
      r("a", 100, 1),
      r("b", 105, 4),
      r("c", 95, 7),
      r("d", 100, 10),
      r("e", 100, 13),
    ];
    const result = detectSpike({
      readings,
      targetReadingId: "target",
      targetReadingType: "fasting",
      now: NOW,
    });
    expect(result).not.toBeNull();
    expect(result!.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("mild spike with minimum data lands below the 0.7 floor", () => {
    // Mild + 5 history points (well below the 14-day window depth) →
    // confidence ≈ 0.4 + 0.3*(5/14) ≈ 0.5.
    const readings: TypedReading[] = [
      r("target", 107, 0),
      r("a", 100, 1),
      r("b", 105, 4),
      r("c", 95, 7),
      r("d", 105, 10),
      r("e", 95, 13),
    ];
    const result = detectSpike({
      readings,
      targetReadingId: "target",
      targetReadingType: "fasting",
      now: NOW,
    });
    expect(result).not.toBeNull();
    expect(result!.severityLevel).toBe("info");
    expect(result!.confidence).toBeLessThan(0.7);
  });
});

describe("detectSpike — property invariants", () => {
  it("severityScore is always in [0, 100] when a result is returned", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 40, max: 500 }), { minLength: 5, maxLength: 30 }),
        (values) => {
          const readings: TypedReading[] = values.map((v, i) => r(`x${i}`, v, i));
          const result = detectSpike({
            readings,
            targetReadingId: "x0",
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
        fc.array(fc.integer({ min: 40, max: 500 }), { minLength: 5, maxLength: 30 }),
        (values) => {
          const readings: TypedReading[] = values.map((v, i) => r(`x${i}`, v, i));
          const result = detectSpike({
            readings,
            targetReadingId: "x0",
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
