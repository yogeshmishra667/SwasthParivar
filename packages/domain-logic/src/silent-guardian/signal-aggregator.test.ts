import { describe, expect, it } from "vitest";

import { aggregateRisk } from "./signal-aggregator.js";
import type { RiskSignal } from "./types.js";

const NOW = new Date("2026-05-21T12:00:00.000Z");
const DAY_MS = 86_400_000;
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * DAY_MS);

describe("aggregateRisk — empty + bands", () => {
  it("no signals → score 0, safe", () => {
    expect(aggregateRisk({ signals: [], now: NOW })).toEqual({ totalScore: 0, severity: "safe" });
  });

  it("0-30 → safe", () => {
    const r = aggregateRisk({ signals: [{ contribution: 20, detectedAt: NOW }], now: NOW });
    expect(r.totalScore).toBe(20);
    expect(r.severity).toBe("safe");
  });

  it("31-60 → yellow", () => {
    expect(
      aggregateRisk({ signals: [{ contribution: 31, detectedAt: NOW }], now: NOW }).severity,
    ).toBe("yellow");
    expect(
      aggregateRisk({ signals: [{ contribution: 60, detectedAt: NOW }], now: NOW }).severity,
    ).toBe("yellow");
  });

  it("61+ → orange", () => {
    expect(
      aggregateRisk({ signals: [{ contribution: 61, detectedAt: NOW }], now: NOW }).severity,
    ).toBe("orange");
  });
});

describe("aggregateRisk — decay", () => {
  it("a signal at the 7-day halflife is worth 50%", () => {
    const r = aggregateRisk({ signals: [{ contribution: 80, detectedAt: daysAgo(7) }], now: NOW });
    expect(r.totalScore).toBe(40); // 80 * 0.5
  });

  it("a fresh signal is undecayed", () => {
    expect(
      aggregateRisk({ signals: [{ contribution: 50, detectedAt: NOW }], now: NOW }).totalScore,
    ).toBe(50);
  });

  it("a future-dated signal (clock skew) is clamped to fresh, never amplified", () => {
    const future = new Date(NOW.getTime() + 3 * DAY_MS);
    expect(
      aggregateRisk({ signals: [{ contribution: 50, detectedAt: future }], now: NOW }).totalScore,
    ).toBe(50);
  });

  it("respects a custom decay halflife", () => {
    // halflife 14d → a 14-day-old signal is worth 50%.
    const r = aggregateRisk({
      signals: [{ contribution: 80, detectedAt: daysAgo(14) }],
      now: NOW,
      decayHalflifeDays: 14,
    });
    expect(r.totalScore).toBe(40);
  });

  it("sums multiple decayed signals and clamps the total at 100", () => {
    const signals: RiskSignal[] = [
      { contribution: 80, detectedAt: NOW },
      { contribution: 80, detectedAt: NOW },
      { contribution: 80, detectedAt: NOW },
    ];
    const r = aggregateRisk({ signals, now: NOW });
    expect(r.totalScore).toBe(100);
    expect(r.severity).toBe("orange");
  });

  it("stacks an old yellow-grade signal with a fresh one", () => {
    const r = aggregateRisk({
      signals: [
        { contribution: 50, detectedAt: daysAgo(7) }, // → 25
        { contribution: 50, detectedAt: NOW }, // → 50
      ],
      now: NOW,
    });
    expect(r.totalScore).toBe(75); // 25 + 50
    expect(r.severity).toBe("orange");
  });
});
