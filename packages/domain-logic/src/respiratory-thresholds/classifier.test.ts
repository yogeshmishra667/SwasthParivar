import { describe, expect, it } from "vitest";
import type { RespiratoryClassificationInput } from "./types.js";
import { classifyRespiratoryReading, shouldTriggerRespiratoryBypass } from "./classifier.js";

const base: RespiratoryClassificationInput = {
  peakFlow: 450,
  baselinePeakFlow: 500,
  inhalerUsed: false,
  symptomSeverity: "none",
};

describe("classifyRespiratoryReading — critical-bypass band (CLAUDE.md Phase 4 Invariants)", () => {
  it("peakFlow 49% of baseline → red zone critical (boundary just below 50%)", () => {
    const r = classifyRespiratoryReading({ ...base, peakFlow: 245, baselinePeakFlow: 500 });
    expect(r.severity).toBe("critical_bypass");
    expect(r.reason).toBe("critical.peak_flow_red_zone");
    expect(r.peakFlowRatio).toBeCloseTo(0.49, 5);
  });

  it("peakFlow exactly 50% → NOT critical (threshold is strict <)", () => {
    const r = classifyRespiratoryReading({ ...base, peakFlow: 250, baselinePeakFlow: 500 });
    expect(r.severity).toBe("warn");
    expect(r.reasons).toEqual(["warn.peak_flow_yellow_zone"]);
  });

  it("symptomSeverity 'severe' → critical (no peak-flow needed)", () => {
    const r = classifyRespiratoryReading({
      peakFlow: null,
      baselinePeakFlow: null,
      inhalerUsed: false,
      symptomSeverity: "severe",
    });
    expect(r.severity).toBe("critical_bypass");
    expect(r.reason).toBe("critical.symptom_severe");
    expect(r.peakFlowRatio).toBeNull();
  });

  it("symptomSeverity 'severe' + red zone → both reasons collected, red-zone first", () => {
    const r = classifyRespiratoryReading({
      peakFlow: 100,
      baselinePeakFlow: 500,
      inhalerUsed: true,
      symptomSeverity: "severe",
    });
    expect(r.severity).toBe("critical_bypass");
    expect(r.reasons).toEqual(["critical.peak_flow_red_zone", "critical.symptom_severe"]);
    // Warn-band signals are NOT evaluated when critical fires.
    expect(r.reasons).not.toContain("warn.inhaler_used");
  });
});

describe("classifyRespiratoryReading — warn band", () => {
  it("peakFlow 79% of baseline → yellow zone (just under 80%)", () => {
    const r = classifyRespiratoryReading({ ...base, peakFlow: 395, baselinePeakFlow: 500 });
    expect(r.severity).toBe("warn");
    expect(r.reason).toBe("warn.peak_flow_yellow_zone");
    expect(r.peakFlowRatio).toBeCloseTo(0.79, 5);
  });

  it("peakFlow exactly 80% → NOT warn yellow (threshold strict <)", () => {
    const r = classifyRespiratoryReading({ ...base, peakFlow: 400, baselinePeakFlow: 500 });
    expect(r.severity).toBe("normal");
  });

  it("peakFlow exactly 50% of baseline → bottom of yellow band", () => {
    const r = classifyRespiratoryReading({ ...base, peakFlow: 250, baselinePeakFlow: 500 });
    expect(r.severity).toBe("warn");
    expect(r.reasons).toContain("warn.peak_flow_yellow_zone");
  });

  it("symptomSeverity 'moderate' alone → warn", () => {
    const r = classifyRespiratoryReading({ ...base, symptomSeverity: "moderate" });
    expect(r.severity).toBe("warn");
    expect(r.reason).toBe("warn.symptom_moderate");
  });

  it("symptomSeverity 'mild' alone → warn", () => {
    const r = classifyRespiratoryReading({ ...base, symptomSeverity: "mild" });
    expect(r.severity).toBe("warn");
    expect(r.reason).toBe("warn.symptom_mild");
  });

  it("inhalerUsed alone → warn", () => {
    const r = classifyRespiratoryReading({ ...base, inhalerUsed: true });
    expect(r.severity).toBe("warn");
    expect(r.reason).toBe("warn.inhaler_used");
  });

  it("yellow zone + moderate + inhaler → all collected, peak-flow first", () => {
    const r = classifyRespiratoryReading({
      peakFlow: 320,
      baselinePeakFlow: 500,
      inhalerUsed: true,
      symptomSeverity: "moderate",
    });
    expect(r.severity).toBe("warn");
    expect(r.reasons).toEqual([
      "warn.peak_flow_yellow_zone",
      "warn.symptom_moderate",
      "warn.inhaler_used",
    ]);
  });

  it("mild + inhaler → both warns collected, mild first (no moderate)", () => {
    const r = classifyRespiratoryReading({
      ...base,
      inhalerUsed: true,
      symptomSeverity: "mild",
    });
    expect(r.severity).toBe("warn");
    expect(r.reasons).toEqual(["warn.symptom_mild", "warn.inhaler_used"]);
  });
});

describe("classifyRespiratoryReading — missing data branches", () => {
  it("peakFlow null, baseline set → peak-flow branches skipped, falls back to symptom", () => {
    const r = classifyRespiratoryReading({
      peakFlow: null,
      baselinePeakFlow: 500,
      inhalerUsed: false,
      symptomSeverity: "none",
    });
    expect(r.severity).toBe("normal");
    expect(r.peakFlowRatio).toBeNull();
  });

  it("peakFlow set, baseline null → peak-flow branches skipped", () => {
    const r = classifyRespiratoryReading({
      peakFlow: 100, // would be red zone if baseline=500, but no baseline
      baselinePeakFlow: null,
      inhalerUsed: false,
      symptomSeverity: "none",
    });
    expect(r.severity).toBe("normal");
    expect(r.peakFlowRatio).toBeNull();
  });

  it("both peakFlow and baseline null → symptom-only mode", () => {
    const r = classifyRespiratoryReading({
      peakFlow: null,
      baselinePeakFlow: null,
      inhalerUsed: false,
      symptomSeverity: "mild",
    });
    expect(r.severity).toBe("warn");
    expect(r.reasons).toEqual(["warn.symptom_mild"]);
  });

  it("baseline 0 → divide-by-zero guard, peak-flow branches skipped", () => {
    const r = classifyRespiratoryReading({
      peakFlow: 100,
      baselinePeakFlow: 0,
      inhalerUsed: false,
      symptomSeverity: "none",
    });
    expect(r.severity).toBe("normal");
    expect(r.peakFlowRatio).toBeNull();
  });

  it("baseline negative (defensive) → treated as no-baseline", () => {
    const r = classifyRespiratoryReading({
      peakFlow: 100,
      baselinePeakFlow: -10,
      inhalerUsed: false,
      symptomSeverity: "none",
    });
    expect(r.peakFlowRatio).toBeNull();
  });
});

describe("classifyRespiratoryReading — normal band", () => {
  it("healthy adult, no symptoms, no inhaler → normal", () => {
    const r = classifyRespiratoryReading({
      peakFlow: 500,
      baselinePeakFlow: 500,
      inhalerUsed: false,
      symptomSeverity: "none",
    });
    expect(r).toEqual({
      severity: "normal",
      reason: "normal",
      reasons: [],
      peakFlowRatio: 1,
    });
  });

  it("peakFlow above baseline → normal (e.g., personal best beaten)", () => {
    const r = classifyRespiratoryReading({
      peakFlow: 520,
      baselinePeakFlow: 500,
      inhalerUsed: false,
      symptomSeverity: "none",
    });
    expect(r.severity).toBe("normal");
    expect(r.peakFlowRatio).toBeCloseTo(1.04, 5);
  });
});

describe("shouldTriggerRespiratoryBypass", () => {
  it("true for red-zone peak flow", () => {
    expect(shouldTriggerRespiratoryBypass({ ...base, peakFlow: 100, baselinePeakFlow: 500 })).toBe(
      true,
    );
  });

  it("true for severe symptom", () => {
    expect(shouldTriggerRespiratoryBypass({ ...base, symptomSeverity: "severe" })).toBe(true);
  });

  it("false for yellow-zone peak flow", () => {
    expect(shouldTriggerRespiratoryBypass({ ...base, peakFlow: 300, baselinePeakFlow: 500 })).toBe(
      false,
    );
  });

  it("false for inhaler-used alone", () => {
    expect(shouldTriggerRespiratoryBypass({ ...base, inhalerUsed: true })).toBe(false);
  });

  it("false for normal", () => {
    expect(shouldTriggerRespiratoryBypass(base)).toBe(false);
  });
});
