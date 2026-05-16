import { describe, it, expect } from "vitest";

import { computeHealthScore, HEALTH_SCORE_WEIGHTS } from "./score.js";
import type { HealthScoreInput, HealthScoreReading } from "./types.js";

const NOW = new Date("2026-05-15T08:00:00.000Z");
const dayMs = 86_400_000;

const r = (value: number, daysAgo: number): HealthScoreReading => ({
  valueMgDl: value,
  measuredAt: new Date(NOW.getTime() - daysAgo * dayMs).toISOString(),
});

const emptyInput = (): HealthScoreInput => ({
  allReadingsLast14d: [],
  fastingReadingsLast14d: [],
  fastingReadingsLast30d: [],
  medicationLogsLast14d: [],
  currentStreakDays: 0,
  now: NOW,
});

describe("computeHealthScore — component weights", () => {
  it("weights sum to 100", () => {
    const total = Object.values(HEALTH_SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(100);
  });

  it("returns score 0-100 always", () => {
    const result = computeHealthScore(emptyInput());
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("emits weights and computedForDate alongside the score", () => {
    const result = computeHealthScore(emptyInput());
    expect(result.weights).toEqual(HEALTH_SCORE_WEIGHTS);
    expect(result.computedForDate).toBe("2026-05-15");
  });
});

describe("computeHealthScore — logging component", () => {
  it("logging = 0 when no readings", () => {
    const result = computeHealthScore(emptyInput());
    expect(result.components.logging).toBe(0);
  });

  it("logging = 100 at 28+ readings (2/day × 14d)", () => {
    const readings = Array.from({ length: 28 }, (_, i) => r(110, i / 2));
    const result = computeHealthScore({ ...emptyInput(), allReadingsLast14d: readings });
    expect(result.components.logging).toBe(100);
  });

  it("logging scales linearly between 0 and 28", () => {
    const readings = Array.from({ length: 14 }, (_, i) => r(110, i));
    const result = computeHealthScore({ ...emptyInput(), allReadingsLast14d: readings });
    // 14/28 = 50%
    expect(result.components.logging).toBe(50);
  });
});

describe("computeHealthScore — stability component", () => {
  it("stability = 50 (insufficient data) below 3 fasting readings", () => {
    const result = computeHealthScore({
      ...emptyInput(),
      fastingReadingsLast14d: [r(110, 0), r(115, 1)],
    });
    expect(result.components.stability).toBe(50);
  });

  it("stability = 100 when fasting σ ≤ 15", () => {
    const readings = [r(110, 0), r(115, 1), r(112, 2), r(108, 3), r(113, 4)];
    const result = computeHealthScore({ ...emptyInput(), fastingReadingsLast14d: readings });
    expect(result.components.stability).toBe(100);
  });

  it("stability = 0 when σ ≥ 50", () => {
    const readings = [r(80, 0), r(200, 1), r(90, 2), r(220, 3), r(100, 4)];
    const result = computeHealthScore({ ...emptyInput(), fastingReadingsLast14d: readings });
    expect(result.components.stability).toBe(0);
  });
});

describe("computeHealthScore — trend component", () => {
  it("trend = 50 (insufficient data) below 5 readings", () => {
    const readings = Array.from({ length: 4 }, (_, i) => r(110, i * 5));
    const result = computeHealthScore({ ...emptyInput(), fastingReadingsLast30d: readings });
    expect(result.components.trend).toBe(50);
  });

  it("trend = 100 for a flat or improving slope", () => {
    // Slope ≤ 0: 5 readings drifting *down* over 30 days
    const readings = [r(120, 25), r(118, 20), r(115, 15), r(112, 10), r(110, 5)];
    const result = computeHealthScore({ ...emptyInput(), fastingReadingsLast30d: readings });
    expect(result.components.trend).toBe(100);
  });

  it("trend = 0 for a rapidly worsening slope (≥ 5 mg/dL/day)", () => {
    // 5 mg/dL/day across 4 days = +20 mg/dL — but we need spread; use 8 days.
    const readings = [r(100, 25), r(140, 20), r(180, 15), r(220, 10), r(260, 5)];
    const result = computeHealthScore({ ...emptyInput(), fastingReadingsLast30d: readings });
    expect(result.components.trend).toBe(0);
  });
});

describe("computeHealthScore — medication component", () => {
  it("medication = 50 when no logs (no schedule)", () => {
    const result = computeHealthScore(emptyInput());
    expect(result.components.medication).toBe(50);
  });

  it("medication = 100 when every log is taken", () => {
    const logs = Array.from({ length: 14 }, () => ({ status: "taken" as const }));
    const result = computeHealthScore({ ...emptyInput(), medicationLogsLast14d: logs });
    expect(result.components.medication).toBe(100);
  });

  it("medication counts 'delayed' as taken", () => {
    const logs = [
      { status: "taken" as const },
      { status: "delayed" as const },
      { status: "delayed" as const },
    ];
    const result = computeHealthScore({ ...emptyInput(), medicationLogsLast14d: logs });
    expect(result.components.medication).toBe(100);
  });

  it("medication = 0 when every log is missed/skipped", () => {
    const logs: { status: "missed_no_response" | "skipped" }[] = Array.from(
      { length: 14 },
      (_, i) => ({ status: i % 2 === 0 ? "missed_no_response" : "skipped" }),
    );
    const result = computeHealthScore({ ...emptyInput(), medicationLogsLast14d: logs });
    expect(result.components.medication).toBe(0);
  });
});

describe("computeHealthScore — streak component", () => {
  it("streak = 0 at 0 days", () => {
    const result = computeHealthScore(emptyInput());
    expect(result.components.streak).toBe(0);
  });

  it("streak = 100 at 14+ days", () => {
    expect(computeHealthScore({ ...emptyInput(), currentStreakDays: 14 }).components.streak).toBe(
      100,
    );
    expect(computeHealthScore({ ...emptyInput(), currentStreakDays: 100 }).components.streak).toBe(
      100,
    );
  });

  it("streak scales linearly between 0 and 14", () => {
    expect(computeHealthScore({ ...emptyInput(), currentStreakDays: 7 }).components.streak).toBe(
      50,
    );
  });
});

describe("computeHealthScore — weighted total", () => {
  it("matches manual weighted sum for a perfect-score input", () => {
    const fasting = Array.from({ length: 5 }, (_, i) => r(110, i * 5));
    const meds = Array.from({ length: 10 }, () => ({ status: "taken" as const }));
    const result = computeHealthScore({
      allReadingsLast14d: Array.from({ length: 28 }, (_, i) => r(110, i / 2)),
      fastingReadingsLast14d: [r(110, 0), r(112, 1), r(108, 2), r(113, 3), r(111, 4)],
      fastingReadingsLast30d: fasting,
      medicationLogsLast14d: meds,
      currentStreakDays: 30,
      now: NOW,
    });
    // All components should clear 100 except trend which is 100 for non-positive slope
    expect(result.score).toBe(100);
  });

  it("matches manual weighted sum for a worst-score input", () => {
    const result = computeHealthScore({
      allReadingsLast14d: [],
      fastingReadingsLast14d: [r(80, 0), r(200, 1), r(90, 2), r(220, 3), r(100, 4)],
      fastingReadingsLast30d: [r(100, 25), r(140, 20), r(180, 15), r(220, 10), r(260, 5)],
      medicationLogsLast14d: Array.from({ length: 14 }, () => ({
        status: "missed_no_response" as const,
      })),
      currentStreakDays: 0,
      now: NOW,
    });
    // logging 0×20 + stability 0×25 + trend 0×25 + med 0×20 + streak 0×10 = 0
    expect(result.score).toBe(0);
  });
});
