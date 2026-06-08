import { describe, expect, it } from "vitest";

import { levenshtein, nameSimilarity } from "./similarity.js";

describe("levenshtein", () => {
  it.each([
    ["", "", 0],
    ["a", "", 1],
    ["", "a", 1],
    ["abc", "abc", 0],
    ["abc", "abd", 1],
    ["kitten", "sitting", 3],
    ["glycomet", "glycornet", 2], // insert 'r' + substitute m→n
    ["glycormet", "glycomet", 1], // delete 'r'
    ["GLYCOMET", "glycomet", 8], // case-sensitive — caller normalises
  ])('"%s" vs "%s" → %d', (a, b, expected) => {
    expect(levenshtein(a, b)).toBe(expected);
  });

  it("is symmetric (a→b distance equals b→a distance)", () => {
    expect(levenshtein("glycomet 500", "glycomet gp 1")).toBe(
      levenshtein("glycomet gp 1", "glycomet 500"),
    );
  });
});

describe("nameSimilarity — alias-table fast path", () => {
  it("returns 1.0 when both names canonicalise to the same alias group", () => {
    // "Glycomet" → metformin canonical; "obimet" → metformin canonical
    expect(nameSimilarity("Glycomet", "Obimet")).toBe(1);
  });

  it("returns 1.0 across casing / whitespace differences", () => {
    expect(nameSimilarity("  GLYCOMET  ", "glyciphage")).toBe(1);
  });

  it("returns 0.05 (clear disagreement) when both canonicalise to DIFFERENT groups", () => {
    // metformin family vs telmisartan family — clearly different drugs
    expect(nameSimilarity("Glycomet", "Telma")).toBe(0.05);
  });

  it("0.05 short-circuits the Levenshtein fallback even when the strings overlap", () => {
    // "metformin" and "metoprolol" share a stem ("met") but the alias
    // table knows they are different drugs — the fast path must win.
    expect(nameSimilarity("Metformin", "Metoprolol")).toBe(0.05);
  });
});

describe("nameSimilarity — Levenshtein fallback", () => {
  it("falls through to Levenshtein when one name is unknown to the alias table", () => {
    // "glycormet" (OCR typo, missing alias) vs "glycomet" (canonical) →
    // one-char distance → similarity ~ 0.88
    const s = nameSimilarity("glycormet", "glycomet");
    expect(s).toBeGreaterThan(0.85);
    expect(s).toBeLessThan(1);
  });

  it("falls through to Levenshtein when neither name is in the alias table", () => {
    const s = nameSimilarity("dolopar 500", "dolopar 650");
    expect(s).toBeGreaterThan(0.5);
    expect(s).toBeLessThan(1);
  });

  it("returns 0 when either string is empty", () => {
    expect(nameSimilarity("", "metformin")).toBe(0);
    expect(nameSimilarity("metformin", "")).toBe(0);
    expect(nameSimilarity("", "")).toBe(0);
  });

  it("scores 'Glycomet 500' vs 'Glycomet GP 1' in the mismatch band (substantively different variant)", () => {
    // Same stem (Glycomet) but variant differs. After whitespace
    // normalisation Levenshtein produces ~0.5 → mismatch band, not
    // match.
    const s = nameSimilarity("Glycomet 500", "Glycomet GP 1");
    expect(s).toBeGreaterThan(0.3);
    expect(s).toBeLessThan(0.8);
  });
});
