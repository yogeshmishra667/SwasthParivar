import { describe, expect, it } from "vitest";

import { scoreSignal } from "./signal-scorer.js";

describe("scoreSignal — med_adherence", () => {
  const med = (evidence: Record<string, unknown>) =>
    scoreSignal({ source: "med_adherence", evidence, userBaseline: null });

  it("0 missed doses → 0 contribution, med_adherence_ok", () => {
    const r = med({ missedCount: 0, windowDays: 7 });
    expect(r.contribution).toBe(0);
    expect(r.signalType).toBe("med_adherence_ok");
  });

  it("piecewise contribution by missed-dose count", () => {
    expect(med({ missedCount: 1 }).contribution).toBe(30);
    expect(med({ missedCount: 2 }).contribution).toBe(50);
    expect(med({ missedCount: 3 }).contribution).toBe(65);
    expect(med({ missedCount: 4 }).contribution).toBe(78);
    expect(med({ missedCount: 5 }).contribution).toBe(88);
    expect(med({ missedCount: 9 }).contribution).toBe(88);
  });

  it("1-2 misses → occasional, 3+ → frequent", () => {
    expect(med({ missedCount: 1 }).signalType).toBe("med_missed_occasional");
    expect(med({ missedCount: 2 }).signalType).toBe("med_missed_occasional");
    expect(med({ missedCount: 3 }).signalType).toBe("med_missed_frequent");
  });

  it("3 missed doses is orange-grade on its own (≥ 61)", () => {
    expect(med({ missedCount: 3 }).contribution).toBeGreaterThanOrEqual(61);
  });

  it("missing / non-numeric evidence falls back to safe defaults (total)", () => {
    expect(med({}).contribution).toBe(0);
    expect(med({ missedCount: "lots" }).contribution).toBe(0);
    expect(med({ missedCount: Number.NaN }).contribution).toBe(0);
    // windowDays absent → fallback 7; present but ≤ 0 → floored to 1.
    expect(med({ missedCount: 2 }).reasoning).toBe("2 missed dose(s) over 7d");
    expect(med({ missedCount: 2, windowDays: 0 }).reasoning).toBe("2 missed dose(s) over 1d");
  });

  it("negative or fractional missed counts are normalised", () => {
    expect(med({ missedCount: -3 }).contribution).toBe(0);
    expect(med({ missedCount: 2.9 }).contribution).toBe(50);
  });

  it("reasoning reports the structured numbers", () => {
    expect(med({ missedCount: 3, windowDays: 7 }).reasoning).toBe("3 missed dose(s) over 7d");
  });
});

describe("scoreSignal — data_anomaly", () => {
  const anomaly = (
    evidence: Record<string, unknown>,
    userBaseline: { mean: number; sigma: number } | null = null,
  ) => scoreSignal({ source: "data_anomaly", evidence, userBaseline });

  it("a decreasing (improving) trend contributes nothing", () => {
    const r = anomaly({ slopePerDay: -4, direction: "decreasing" });
    expect(r.contribution).toBe(0);
    expect(r.signalType).toBe("trend_stable");
  });

  it("a flat trend (|slope| < 1) contributes nothing", () => {
    expect(anomaly({ slopePerDay: 0.5, direction: "increasing" }).contribution).toBe(0);
  });

  it("falls back to slope sign when direction is absent", () => {
    expect(anomaly({ slopePerDay: 3 }).contribution).toBeGreaterThan(0);
    expect(anomaly({ slopePerDay: -3 }).contribution).toBe(0);
  });

  it("rising-trend slope bands", () => {
    expect(anomaly({ slopePerDay: 1.5, direction: "increasing" }).contribution).toBe(35);
    expect(anomaly({ slopePerDay: 3, direction: "increasing" }).contribution).toBe(55);
    expect(anomaly({ slopePerDay: 6, direction: "increasing" }).contribution).toBe(72);
  });

  it("rapid rise → worsening_trend_rapid signal type", () => {
    expect(anomaly({ slopePerDay: 6, direction: "increasing" }).signalType).toBe(
      "worsening_trend_rapid",
    );
    expect(anomaly({ slopePerDay: 3, direction: "increasing" }).signalType).toBe("worsening_trend");
  });

  it("a rise large vs the patient's own variability gets a +10 bump", () => {
    // sigma 2, slope 3 → ratio 1.5 ≥ 1 → bump.
    expect(
      anomaly({ slopePerDay: 3, direction: "increasing" }, { mean: 120, sigma: 2 }).contribution,
    ).toBe(65);
    // sigma 10, slope 3 → ratio 0.3 < 1 → no bump.
    expect(
      anomaly({ slopePerDay: 3, direction: "increasing" }, { mean: 120, sigma: 10 }).contribution,
    ).toBe(55);
    // sigma 0 → no bump (guards divide-by-zero).
    expect(
      anomaly({ slopePerDay: 3, direction: "increasing" }, { mean: 120, sigma: 0 }).contribution,
    ).toBe(55);
  });

  it("a weak regression fit (low R²) is discounted by 8", () => {
    expect(anomaly({ slopePerDay: 3, direction: "increasing", rSquared: 0.55 }).contribution).toBe(
      47,
    );
    expect(anomaly({ slopePerDay: 3, direction: "increasing", rSquared: 0.9 }).contribution).toBe(
      55,
    );
  });

  it("reasoning names the reading type, defaulting to glucose", () => {
    expect(
      anomaly({ slopePerDay: 3, direction: "increasing", readingType: "fasting" }).reasoning,
    ).toBe("fasting rising ~3 mg/dL/day");
    expect(anomaly({ slopePerDay: 3, direction: "increasing" }).reasoning).toBe(
      "glucose rising ~3 mg/dL/day",
    );
  });
});
