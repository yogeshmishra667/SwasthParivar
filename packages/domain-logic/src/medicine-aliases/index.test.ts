import { describe, expect, it } from "vitest";

import { __ALIAS_GROUPS_FOR_TESTS, canonicaliseMedicineName } from "./index.js";

describe("canonicaliseMedicineName", () => {
  it("resolves a canonical key to itself", () => {
    expect(canonicaliseMedicineName("metformin")).toBe("metformin");
    expect(canonicaliseMedicineName("telmisartan")).toBe("telmisartan");
  });

  it("resolves brand aliases to the canonical key (case-insensitive)", () => {
    expect(canonicaliseMedicineName("Glycomet")).toBe("metformin");
    expect(canonicaliseMedicineName("OBIMET")).toBe("metformin");
    expect(canonicaliseMedicineName("Telma")).toBe("telmisartan");
    expect(canonicaliseMedicineName("Amlong")).toBe("amlodipine");
  });

  it("normalises whitespace inside multi-word brand names", () => {
    expect(canonicaliseMedicineName("  Glycomet GP 1  ")).toBe("metformin_gp1");
    expect(canonicaliseMedicineName("glycomet  gp  1")).toBe("metformin_gp1");
  });

  it("returns null for unknown brands so callers fall through to fuzzy matching", () => {
    expect(canonicaliseMedicineName("CompletelyMadeUpDrug")).toBeNull();
    expect(canonicaliseMedicineName("")).toBeNull();
    expect(canonicaliseMedicineName("   ")).toBeNull();
  });

  it("skips the _meta block in the JSON (no canonical key looks like a comment)", () => {
    for (const group of __ALIAS_GROUPS_FOR_TESTS) {
      expect(group.key.startsWith("_")).toBe(false);
    }
  });

  it("covers the top diabetes / BP / asthma / cardiac classes from phase4.md §F.6", () => {
    const canonicalKeys = new Set(__ALIAS_GROUPS_FOR_TESTS.map((g) => g.key));
    for (const required of [
      "metformin",
      "glimepiride",
      "amlodipine",
      "telmisartan",
      "ramipril",
      "atenolol",
      "salbutamol",
      "budesonide",
      "atorvastatin",
      "clopidogrel",
    ]) {
      expect(canonicalKeys.has(required)).toBe(true);
    }
  });
});
