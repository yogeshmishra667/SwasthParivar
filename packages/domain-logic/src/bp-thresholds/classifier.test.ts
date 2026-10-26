import { describe, expect, it } from "vitest";
import { bpCriticalDirection, isCriticalBP } from "@swasth/shared-types";

import { classifyBPReading, shouldTriggerBPBypass } from "./classifier.js";

const bp = (systolic: number, diastolic: number) => ({ systolic, diastolic });

describe("classifyBPReading — hardcoded critical thresholds", () => {
  it.each([
    // [systolic, diastolic, expected reasons]
    [120, 80, []],
    [90, 60, []], // both low thresholds are exclusive
    [180, 110, []], // both high thresholds are exclusive
    [89, 70, ["critical.sys_low"]],
    [120, 59, ["critical.dia_low"]],
    [181, 90, ["critical.sys_high"]],
    [150, 111, ["critical.dia_high"]],
    [85, 55, ["critical.sys_low", "critical.dia_low"]],
    [200, 120, ["critical.sys_high", "critical.dia_high"]],
    [190, 55, ["critical.sys_high", "critical.dia_low"]], // both directions → high first
  ])("%i/%i → %j", (systolic, diastolic, reasons) => {
    const r = classifyBPReading(bp(systolic, diastolic));
    expect(r.reasons).toEqual(reasons);
    expect(r.severity).toBe(reasons.length > 0 ? "critical_bypass" : "normal");
    expect(r.reason).toBe(reasons[0] ?? "normal");
    expect(shouldTriggerBPBypass(bp(systolic, diastolic))).toBe(reasons.length > 0);
  });
});

describe("bpCriticalDirection / isCriticalBP (shared with the mobile app)", () => {
  it.each([
    [120, 80, null],
    [90, 60, null],
    [180, 110, null],
    [89, 80, "low"],
    [120, 59, "low"],
    [181, 80, "high"],
    [120, 111, "high"],
    [190, 55, "high"],
  ] as const)("%i/%i → %s", (systolic, diastolic, direction) => {
    expect(bpCriticalDirection(systolic, diastolic)).toBe(direction);
    expect(isCriticalBP(systolic, diastolic)).toBe(direction !== null);
  });

  it("agrees with the classifier on every reading in the valid range", () => {
    for (let sys = 60; sys <= 250; sys += 1) {
      for (let dia = 40; dia <= 150; dia += 1) {
        expect(isCriticalBP(sys, dia)).toBe(shouldTriggerBPBypass(bp(sys, dia)));
      }
    }
  });
});
