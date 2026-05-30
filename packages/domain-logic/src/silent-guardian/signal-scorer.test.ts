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

// ─────────────────────────────────────────────────────────────
// Phase 4 §C' — chat_sentiment / schedule_miss / activity_drop /
// cross_signal. Each scorer is total: zero-evidence → contribution 0,
// progressively heavier evidence → larger contribution clamped at 100.
// ─────────────────────────────────────────────────────────────

describe("scoreSignal — chat_sentiment", () => {
  const chat = (evidence: Record<string, unknown>) =>
    scoreSignal({ source: "chat_sentiment", evidence, userBaseline: null });

  it("returns 0 when no distressed turns logged", () => {
    expect(chat({ distressedTurns: 0, totalTurns: 5 }).contribution).toBe(0);
    expect(chat({ distressedTurns: 0, totalTurns: 5 }).signalType).toBe("chat_sentiment_ok");
  });

  it("scales contribution by density and absolute distress count", () => {
    // density 1/10 = 0.1, distressed < 2 → 25
    expect(chat({ distressedTurns: 1, totalTurns: 10 }).contribution).toBe(25);
    // density 2/10 = 0.2 → 40
    expect(chat({ distressedTurns: 2, totalTurns: 10 }).contribution).toBe(40);
    // distressed >= 4 → 60 regardless of density
    expect(chat({ distressedTurns: 4, totalTurns: 20 }).contribution).toBe(60);
    // density >= 0.4 → 60
    expect(chat({ distressedTurns: 4, totalTurns: 10 }).contribution).toBe(60);
  });

  it("uses _persistent signal type at distressed≥4", () => {
    expect(chat({ distressedTurns: 4, totalTurns: 10 }).signalType).toBe(
      "chat_distress_persistent",
    );
    expect(chat({ distressedTurns: 2, totalTurns: 10 }).signalType).toBe("chat_distress_present");
  });

  it("guards divide-by-zero on missing totalTurns", () => {
    expect(chat({ distressedTurns: 1 }).contribution).toBeGreaterThan(0);
  });
});

describe("scoreSignal — schedule_miss", () => {
  const sched = (evidence: Record<string, unknown>) =>
    scoreSignal({ source: "schedule_miss", evidence, userBaseline: null });

  it("returns 0 when no slots missed", () => {
    expect(sched({ missedSlots: 0, missedConsecutive: 0, checkType: "glucose" }).contribution).toBe(
      0,
    );
  });

  it("scores by the consecutive-run band first, then absolute count", () => {
    expect(sched({ missedSlots: 5, missedConsecutive: 5 }).contribution).toBe(70);
    expect(sched({ missedSlots: 3, missedConsecutive: 3 }).contribution).toBe(55);
    expect(sched({ missedSlots: 2, missedConsecutive: 2 }).contribution).toBe(38);
    expect(sched({ missedSlots: 4, missedConsecutive: 1 }).contribution).toBe(38);
    expect(sched({ missedSlots: 1, missedConsecutive: 1 }).contribution).toBe(22);
  });

  it("uses _streak signal type for runs of 3+, _isolated otherwise", () => {
    expect(sched({ missedSlots: 3, missedConsecutive: 3 }).signalType).toBe("schedule_miss_streak");
    expect(sched({ missedSlots: 2, missedConsecutive: 1 }).signalType).toBe(
      "schedule_miss_isolated",
    );
  });

  it("names the check type in reasoning, defaulting to 'check'", () => {
    expect(sched({ missedSlots: 2, missedConsecutive: 2, checkType: "bp" }).reasoning).toContain(
      "bp",
    );
    expect(sched({ missedSlots: 2, missedConsecutive: 2 }).reasoning).toContain("check");
  });
});

describe("scoreSignal — activity_drop (wired-but-dormant)", () => {
  const act = (evidence: Record<string, unknown>) =>
    scoreSignal({ source: "activity_drop", evidence, userBaseline: null });

  it("returns 0 when no evidence (default state until Feature I lands)", () => {
    expect(act({}).contribution).toBe(0);
  });

  it("returns 0 below the 20% drop floor", () => {
    expect(act({ pctDrop: 0.15 }).contribution).toBe(0);
  });

  it("scales in 3 bands: 25 / 40 / 60", () => {
    expect(act({ pctDrop: 0.3 }).contribution).toBe(25);
    expect(act({ pctDrop: 0.45 }).contribution).toBe(40);
    expect(act({ pctDrop: 0.7 }).contribution).toBe(60);
  });

  it("uses _severe signal type at pctDrop>=0.6", () => {
    expect(act({ pctDrop: 0.7 }).signalType).toBe("activity_drop_severe");
    expect(act({ pctDrop: 0.45 }).signalType).toBe("activity_drop_present");
  });
});

describe("scoreSignal — cross_signal", () => {
  const cross = (evidence: Record<string, unknown>) =>
    scoreSignal({ source: "cross_signal", evidence, userBaseline: null });

  it("returns 0 when fewer than 2 sources contributed", () => {
    expect(cross({ contributingSourceCount: 0 }).contribution).toBe(0);
    expect(cross({ contributingSourceCount: 1 }).contribution).toBe(0);
    expect(cross({ contributingSourceCount: 1 }).signalType).toBe("cross_signal_none");
  });

  it("scales 12 / 18 / 25 by stack depth", () => {
    expect(cross({ contributingSourceCount: 2 }).contribution).toBe(12);
    expect(cross({ contributingSourceCount: 3 }).contribution).toBe(18);
    expect(cross({ contributingSourceCount: 4 }).contribution).toBe(25);
    expect(cross({ contributingSourceCount: 6 }).contribution).toBe(25);
  });

  it("signal type marks the stacking when it fires", () => {
    expect(cross({ contributingSourceCount: 2 }).signalType).toBe("cross_signal_stack");
  });
});
