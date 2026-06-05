import { describe, expect, it } from "vitest";
import type { CardiacClassificationInput } from "./types.js";
import { classifyCardiacReading, shouldTriggerCardiacBypass } from "./classifier.js";

const base: CardiacClassificationInput = {
  heartRateBpm: 72,
  rhythmStatus: "regular",
  chestPain: false,
  painSeverity: null,
  exerciseTolerance: "normal",
};

const withHr = (hr: number): CardiacClassificationInput => ({ ...base, heartRateBpm: hr });

describe("classifyCardiacReading — critical-bypass band (CLAUDE.md Phase 4 Invariants)", () => {
  it("HR 39 → critical low (boundary just below 40)", () => {
    const r = classifyCardiacReading(withHr(39));
    expect(r.severity).toBe("critical_bypass");
    expect(r.reason).toBe("critical.hr_low");
    expect(r.reasons).toEqual(["critical.hr_low"]);
  });

  it("HR 40 → NOT critical low (threshold is strict <40)", () => {
    const r = classifyCardiacReading(withHr(40));
    expect(r.severity).toBe("warn");
    expect(r.reasons).toContain("warn.hr_borderline_low");
  });

  it("HR 150 → NOT critical high (threshold is strict >150)", () => {
    const r = classifyCardiacReading(withHr(150));
    expect(r.severity).toBe("warn");
    expect(r.reasons).toContain("warn.hr_borderline_high");
  });

  it("HR 151 → critical high (boundary just above 150)", () => {
    const r = classifyCardiacReading(withHr(151));
    expect(r.severity).toBe("critical_bypass");
    expect(r.reason).toBe("critical.hr_high");
  });

  it("chestPain + severity 7 → critical chest pain (boundary)", () => {
    const r = classifyCardiacReading({ ...base, chestPain: true, painSeverity: 7 });
    expect(r.severity).toBe("critical_bypass");
    expect(r.reason).toBe("critical.chest_pain_severe");
  });

  it("chestPain + severity 10 → critical chest pain (top of band)", () => {
    const r = classifyCardiacReading({ ...base, chestPain: true, painSeverity: 10 });
    expect(r.severity).toBe("critical_bypass");
    expect(r.reason).toBe("critical.chest_pain_severe");
  });

  it("chestPain + severity 6 → warn (just below critical floor)", () => {
    const r = classifyCardiacReading({ ...base, chestPain: true, painSeverity: 6 });
    expect(r.severity).toBe("warn");
    expect(r.reason).toBe("warn.chest_pain");
  });

  it("chestPain + null severity → warn (conservative: treated as 0)", () => {
    const r = classifyCardiacReading({ ...base, chestPain: true, painSeverity: null });
    expect(r.severity).toBe("warn");
    expect(r.reason).toBe("warn.chest_pain");
  });

  it("chestPain=false + severity 10 → NOT critical (gated by chestPain)", () => {
    const r = classifyCardiacReading({ ...base, chestPain: false, painSeverity: 10 });
    expect(r.severity).toBe("normal");
  });

  it("multiple critical conditions → all collected, top precedence wins", () => {
    const r = classifyCardiacReading({
      ...base,
      heartRateBpm: 30,
      chestPain: true,
      painSeverity: 9,
    });
    expect(r.severity).toBe("critical_bypass");
    expect(r.reason).toBe("critical.hr_low");
    expect(r.reasons).toEqual(["critical.hr_low", "critical.chest_pain_severe"]);
  });

  it("HR low AND high cannot both fire, but both branches exit critical early", () => {
    const r = classifyCardiacReading({
      ...base,
      heartRateBpm: 200,
      chestPain: true,
      painSeverity: 9,
      rhythmStatus: "irregular",
      exerciseTolerance: "severe",
    });
    // Even with warn-band signals also present, critical wins and warn
    // branch is not evaluated (reasons stay critical-only).
    expect(r.severity).toBe("critical_bypass");
    expect(r.reasons).toEqual(["critical.hr_high", "critical.chest_pain_severe"]);
  });
});

describe("classifyCardiacReading — warn band", () => {
  it("HR 49 → warn.hr_borderline_low (top of band)", () => {
    const r = classifyCardiacReading(withHr(49));
    expect(r.severity).toBe("warn");
    expect(r.reasons).toEqual(["warn.hr_borderline_low"]);
  });

  it("HR 50 → normal (above warn-low band)", () => {
    const r = classifyCardiacReading(withHr(50));
    expect(r.severity).toBe("normal");
  });

  it("HR 120 → normal (below warn-high band)", () => {
    const r = classifyCardiacReading(withHr(120));
    expect(r.severity).toBe("normal");
  });

  it("HR 121 → warn.hr_borderline_high (bottom of band)", () => {
    const r = classifyCardiacReading(withHr(121));
    expect(r.severity).toBe("warn");
    expect(r.reasons).toEqual(["warn.hr_borderline_high"]);
  });

  it("irregular rhythm alone → warn", () => {
    const r = classifyCardiacReading({ ...base, rhythmStatus: "irregular" });
    expect(r.severity).toBe("warn");
    expect(r.reason).toBe("warn.rhythm_irregular");
  });

  it("rhythm unknown → no warn contribution", () => {
    const r = classifyCardiacReading({ ...base, rhythmStatus: "unknown" });
    expect(r.severity).toBe("normal");
  });

  it("exerciseTolerance reduced → warn", () => {
    const r = classifyCardiacReading({ ...base, exerciseTolerance: "reduced" });
    expect(r.severity).toBe("warn");
    expect(r.reason).toBe("warn.exercise_intolerance");
  });

  it("exerciseTolerance severe → warn", () => {
    const r = classifyCardiacReading({ ...base, exerciseTolerance: "severe" });
    expect(r.severity).toBe("warn");
    expect(r.reason).toBe("warn.exercise_intolerance");
  });

  it("exerciseTolerance normal → no warn contribution", () => {
    const r = classifyCardiacReading({ ...base, exerciseTolerance: "normal" });
    expect(r.severity).toBe("normal");
  });

  it("multiple warn signals are all collected in precedence order", () => {
    const r = classifyCardiacReading({
      ...base,
      heartRateBpm: 125,
      chestPain: true,
      painSeverity: 4,
      rhythmStatus: "irregular",
      exerciseTolerance: "reduced",
    });
    expect(r.severity).toBe("warn");
    expect(r.reasons).toEqual([
      "warn.hr_borderline_high",
      "warn.chest_pain",
      "warn.rhythm_irregular",
      "warn.exercise_intolerance",
    ]);
    // Top precedence reason exposed as the singular `reason`.
    expect(r.reason).toBe("warn.hr_borderline_high");
  });
});

describe("classifyCardiacReading — normal band", () => {
  it("resting healthy adult → normal", () => {
    expect(classifyCardiacReading(withHr(72))).toEqual({
      severity: "normal",
      reason: "normal",
      reasons: [],
    });
  });

  it("base input is normal (defends against accidental warn defaults)", () => {
    expect(classifyCardiacReading(base).severity).toBe("normal");
  });
});

describe("shouldTriggerCardiacBypass", () => {
  it("true for HR < 40", () => {
    expect(shouldTriggerCardiacBypass(withHr(35))).toBe(true);
  });

  it("true for HR > 150", () => {
    expect(shouldTriggerCardiacBypass(withHr(200))).toBe(true);
  });

  it("true for chestPain + severity ≥ 7", () => {
    expect(shouldTriggerCardiacBypass({ ...base, chestPain: true, painSeverity: 8 })).toBe(true);
  });

  it("false for warn-band only", () => {
    expect(shouldTriggerCardiacBypass(withHr(45))).toBe(false);
    expect(shouldTriggerCardiacBypass({ ...base, rhythmStatus: "irregular" })).toBe(false);
  });

  it("false for normal", () => {
    expect(shouldTriggerCardiacBypass(base)).toBe(false);
  });
});
