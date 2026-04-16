import { describe, expect, it } from "vitest";
import { computeFeedback } from "./engine.js";

const baseInput = {
  currentValue: 120,
  currentType: "fasting" as const,
  context: "normal" as const,
  userStageDays: 0,
  isFirstReading: false,
  sameTypeReadingsLast7d: [],
  lastSameTypeValue: null,
  recentVariantIds: [],
  currentStreakDays: 1,
};

describe("feedback engine", () => {
  it("first reading → celebrate regardless of value", () => {
    const r = computeFeedback({ ...baseInput, isFirstReading: true, currentValue: 200 });
    expect(r.tone).toBe("celebrate");
    expect(r.type).toBe("first_reading");
  });

  it("critical low → gentle_warn", () => {
    const r = computeFeedback({ ...baseInput, currentValue: 50 });
    expect(r.tone).toBe("gentle_warn");
    expect(r.type).toBe("critical_warn");
  });

  it("delta < 10 → neutral always (noise floor)", () => {
    const r = computeFeedback({
      ...baseInput,
      currentValue: 125,
      lastSameTypeValue: 120,
    });
    expect(r.tone).toBe("neutral");
  });

  it("delta -15 (improvement) → celebrate", () => {
    const r = computeFeedback({
      ...baseInput,
      currentValue: 105,
      lastSameTypeValue: 120,
    });
    expect(r.tone).toBe("celebrate");
  });

  it("delta +20 → gentle_warn", () => {
    const r = computeFeedback({
      ...baseInput,
      currentValue: 140,
      lastSameTypeValue: 120,
    });
    expect(r.tone).toBe("gentle_warn");
  });

  it("festive context flips gentle_warn → celebrate", () => {
    const r = computeFeedback({
      ...baseInput,
      currentValue: 140,
      lastSameTypeValue: 120,
      context: "festive",
    });
    expect(r.tone).toBe("celebrate");
  });

  it("festive does NOT override critical warning", () => {
    const r = computeFeedback({ ...baseInput, currentValue: 50, context: "festive" });
    expect(r.tone).toBe("gentle_warn");
  });

  it("uses 7d median when stage>=7 and >=3 same-type readings", () => {
    const r = computeFeedback({
      ...baseInput,
      userStageDays: 14,
      currentValue: 100,
      sameTypeReadingsLast7d: [
        { valueMgDl: 130, measuredAt: "2026-04-10T05:00:00Z" },
        { valueMgDl: 140, measuredAt: "2026-04-11T05:00:00Z" },
        { valueMgDl: 135, measuredAt: "2026-04-12T05:00:00Z" },
      ],
      lastSameTypeValue: 90,
    });
    expect(r.tone).toBe("celebrate");
  });
});
