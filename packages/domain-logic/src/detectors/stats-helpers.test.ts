import { describe, expect, it } from "vitest";
import { variance, welchTTest, incompleteBeta, studentTTwoTailedP } from "./stats-helpers.js";

describe("variance", () => {
  it("returns 0 for fewer than 2 values", () => {
    expect(variance([])).toBe(0);
    expect(variance([7])).toBe(0);
  });

  it("computes the Bessel-corrected sample variance", () => {
    // [2,4,6,8]: mean 5, sum of squares 20, /(4-1) = 6.666…
    expect(variance([2, 4, 6, 8])).toBeCloseTo(6.6667, 3);
  });

  it("returns 0 for a constant sample", () => {
    expect(variance([5, 5, 5, 5])).toBe(0);
  });
});

describe("incompleteBeta", () => {
  it("clamps to 0 at/below x=0 and to 1 at/above x=1", () => {
    expect(incompleteBeta(0, 2, 3)).toBe(0);
    expect(incompleteBeta(-0.5, 2, 3)).toBe(0);
    expect(incompleteBeta(1, 2, 3)).toBe(1);
    expect(incompleteBeta(1.5, 2, 3)).toBe(1);
  });

  it("I_x(1,1) equals x (the uniform case)", () => {
    expect(incompleteBeta(0.25, 1, 1)).toBeCloseTo(0.25, 6); // continued-fraction branch
    expect(incompleteBeta(0.5, 1, 1)).toBeCloseTo(0.5, 6); // mirrored branch
    expect(incompleteBeta(0.8, 1, 1)).toBeCloseTo(0.8, 6);
  });

  it("satisfies the symmetry identity I_x(a,b) = 1 - I_(1-x)(b,a)", () => {
    const x = 0.37;
    expect(incompleteBeta(x, 2.5, 4)).toBeCloseTo(1 - incompleteBeta(1 - x, 4, 2.5), 6);
  });

  it("handles sub-1 shape parameters (exercises the log-gamma reflection)", () => {
    // a = 0.3 < 0.5 routes log-gamma through its reflection formula.
    expect(incompleteBeta(0.4, 0.3, 0.7)).toBeCloseTo(1 - incompleteBeta(0.6, 0.7, 0.3), 6);
  });
});

describe("studentTTwoTailedP", () => {
  it("returns 1 for t=0 (no difference)", () => {
    expect(studentTTwoTailedP(0, 10)).toBeCloseTo(1, 6);
  });

  it("returns 1 for non-positive degrees of freedom", () => {
    expect(studentTTwoTailedP(3, 0)).toBe(1);
  });

  it("shrinks toward 0 as |t| grows", () => {
    const small = studentTTwoTailedP(1, 10);
    const large = studentTTwoTailedP(6, 10);
    expect(large).toBeLessThan(small);
    expect(large).toBeLessThan(0.01);
  });

  it("matches the known critical value t=2.228, df=10 → p≈0.05", () => {
    expect(studentTTwoTailedP(2.228, 10)).toBeCloseTo(0.05, 2);
  });
});

describe("welchTTest", () => {
  it("returns null when a sample has fewer than 2 values", () => {
    expect(welchTTest([1], [1, 2, 3])).toBeNull();
    expect(welchTTest([1, 2, 3], [])).toBeNull();
  });

  it("gives t=0, p=1 for identical samples", () => {
    const r = welchTTest([10, 20, 30], [10, 20, 30]);
    expect(r).not.toBeNull();
    expect(r?.t).toBeCloseTo(0, 6);
    expect(r?.pValue).toBeCloseTo(1, 6);
  });

  it("computes t, df and p for two clearly separated samples", () => {
    // A=[2,4,6,8] mean 5, B=[12,14,16,18] mean 15. Hand-computed:
    // t = -5.4772, df = 6.
    const r = welchTTest([2, 4, 6, 8], [12, 14, 16, 18]);
    expect(r).not.toBeNull();
    expect(r?.t).toBeCloseTo(-5.4772, 3);
    expect(r?.df).toBeCloseTo(6, 6);
    expect(r?.pValue).toBeGreaterThan(0.0005);
    expect(r?.pValue).toBeLessThan(0.005);
  });

  it("flips the t sign when samples are swapped; p is unchanged", () => {
    const a = welchTTest([2, 4, 6, 8], [12, 14, 16, 18]);
    const b = welchTTest([12, 14, 16, 18], [2, 4, 6, 8]);
    expect(a?.t).toBeCloseTo(-(b?.t ?? 0), 6);
    expect(a?.pValue).toBeCloseTo(b?.pValue ?? 0, 6);
  });

  it("handles both samples constant — equal means → p=1", () => {
    const r = welchTTest([5, 5, 5], [5, 5, 5]);
    expect(r?.t).toBe(0);
    expect(r?.pValue).toBe(1);
  });

  it("handles both samples constant — unequal means → p=0", () => {
    const r = welchTTest([5, 5], [9, 9]);
    expect(r?.t).toBe(0);
    expect(r?.pValue).toBe(0);
  });
});
