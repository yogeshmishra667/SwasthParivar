import { describe, expect, it } from "vitest";
import { detectCrossCondition, type CrossConditionInput } from "./cross-condition.js";

const DAY = 86_400_000;
const NOW = new Date("2026-05-01T12:00:00Z");

const iso = (offsetDays: number): string =>
  new Date(NOW.getTime() - offsetDays * DAY).toISOString();

interface DaySpec {
  offset: number;
  glucose: number;
  systolic: number;
}

const build = (specs: readonly DaySpec[]): CrossConditionInput => ({
  now: NOW,
  glucoseReadings: specs.map((s, i) => ({
    id: `g${i}`,
    valueMgDl: s.glucose,
    readingType: "fasting" as const,
    measuredAt: iso(s.offset),
  })),
  bpReadings: specs.map((s, i) => ({
    id: `b${i}`,
    systolic: s.systolic,
    diastolic: 85,
    measuredAt: iso(s.offset),
  })),
});

// `count` consecutive days from `startOffset`, one reading each, all at
// `systolic`; glucose = base + a small deterministic spread so each
// group has non-zero variance.
const WIDE = [-4, -2, 0, 2, 4];
const TIGHT = [-1, 0, 1, 0, -1];

const days = (
  count: number,
  startOffset: number,
  systolic: number,
  base: number,
  spread: readonly number[] = WIDE,
): DaySpec[] =>
  Array.from({ length: count }, (_, i) => ({
    offset: startOffset + i,
    systolic,
    glucose: base + (spread[i % spread.length] ?? 0),
  }));

describe("detectCrossCondition", () => {
  it("returns null when paired data spans fewer than 30 days", () => {
    // 12 high + 12 normal BP days, but the whole span is only 24 days.
    const input = build([...days(12, 1, 150, 165), ...days(12, 13, 120, 135)]);
    expect(detectCrossCondition(input)).toBeNull();
  });

  it("returns null when a BP group has fewer than 10 paired days", () => {
    const input = build([...days(8, 1, 150, 165), ...days(15, 20, 120, 135)]);
    expect(detectCrossCondition(input)).toBeNull();
  });

  it("returns null when the difference is not significant (p ≥ 0.05)", () => {
    // Both groups drawn from the same glucose distribution.
    const input = build([...days(14, 1, 150, 145), ...days(14, 20, 120, 145)]);
    expect(detectCrossCondition(input)).toBeNull();
  });

  it("returns null when confidence is below the 0.70 feed floor", () => {
    // Tight groups → tiny p (clears the significance gate), but only a
    // ~11 mg/dL effect on the minimum sample → confidence ≈ 0.66.
    const input = build([...days(10, 1, 150, 150, TIGHT), ...days(10, 20, 120, 139, TIGHT)]);
    expect(detectCrossCondition(input)).toBeNull();
  });

  it("does not fire when high-BP days run LOWER than normal-BP days", () => {
    const input = build([...days(14, 1, 150, 130), ...days(14, 20, 120, 165)]);
    expect(detectCrossCondition(input)).toBeNull();
  });

  it("flags a cross-condition pattern with warn severity for a clear signal", () => {
    // 14 high-BP days run ~30 mg/dL above 14 normal-BP days.
    const input = build([...days(14, 1, 150, 165), ...days(14, 20, 120, 135)]);
    const result = detectCrossCondition(input);
    expect(result).not.toBeNull();
    expect(result?.patternType).toBe("cross_condition");
    expect(result?.conditionsInvolved).toEqual(["glucose", "bp"]);
    expect(result?.severityLevel).toBe("warn"); // delta ≈ 30 → [20, 35)
    expect((result?.evidence as { delta: number }).delta).toBeGreaterThan(25);
    expect(result?.confidence).toBeGreaterThanOrEqual(0.7);
    expect(result?.triggerReadings.length).toBeGreaterThan(0);
  });

  it("reports info severity for a modest but real glucose lift", () => {
    // delta ≈ 15 → [INFO_DELTA, WARN_DELTA); tight groups keep p tiny so
    // confidence still clears the 0.70 floor at 28 paired days.
    const input = build([...days(14, 1, 150, 150, TIGHT), ...days(14, 20, 120, 135, TIGHT)]);
    expect(detectCrossCondition(input)?.severityLevel).toBe("info");
  });

  it("escalates to critical severity for a large glucose lift", () => {
    const input = build([...days(16, 1, 150, 178), ...days(16, 20, 120, 130)]);
    const result = detectCrossCondition(input);
    expect(result?.severityLevel).toBe("critical"); // delta ≈ 48 ≥ 35
  });

  it("ignores a glucose reading on a day with no BP reading", () => {
    const base = build([...days(14, 1, 150, 165), ...days(14, 20, 120, 135)]);
    const withOrphan: CrossConditionInput = {
      ...base,
      glucoseReadings: [
        ...base.glucoseReadings,
        { id: "orphan", valueMgDl: 400, readingType: "random", measuredAt: iso(60) },
      ],
    };
    // The unpaired day is skipped — result matches the clean fixture.
    expect(detectCrossCondition(withOrphan)?.severityLevel).toBe("warn");
  });
});
