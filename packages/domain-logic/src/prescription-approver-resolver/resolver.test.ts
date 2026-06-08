import { describe, expect, it } from "vitest";

import { relationshipFamily } from "./relationship.js";
import { resolveApprover } from "./resolver.js";
import type { AcceptedFamilyLink, ApproverResolverInput } from "./types.js";

const link = (overrides: Partial<AcceptedFamilyLink> = {}): AcceptedFamilyLink => ({
  guardianId: "g-1",
  relationship: "son",
  acceptedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const input = (overrides: Partial<ApproverResolverInput> = {}): ApproverResolverInput => ({
  patientUserId: "patient-1",
  acceptedFamilyLinks: [],
  patientIsGuardianElsewhere: false,
  ...overrides,
});

describe("relationshipFamily", () => {
  it.each([
    ["son", "child"],
    ["daughter", "child"],
    ["beta", "child"],
    ["beti", "child"],
    ["Beta ji", "child"], // honorific + casing
    ["बेटा", "child"], // devanagari
    ["husband", "spouse"],
    ["wife", "spouse"],
    ["pati", "spouse"],
    ["biwi", "spouse"],
    ["पति", "spouse"],
    ["caregiver", "caregiver"],
    ["nurse", "caregiver"],
    ["nurse ji", "caregiver"], // honorific stripping
    ["father", "other"],
    ["bhai", "other"],
    ["dost", "other"],
    [null, "unknown"],
    ["", "unknown"],
    ["   ", "unknown"],
    ["something random", "unknown"],
    // Multi-word labels — exercises the regex word-boundary path,
    // not just the exact-equality fast path.
    ["my eldest son", "child"],
    ["father in law", "other"],
    ["nurse aaya from delhi", "caregiver"],
  ] as const)("maps %s → %s", (input, expected) => {
    expect(relationshipFamily(input)).toBe(expected);
  });

  it("does not match 'father' inside 'godfather' (word-boundary)", () => {
    // Specific anti-regression check: a substring matcher would
    // mis-classify "godfather" as "other".
    expect(relationshipFamily("godfather")).toBe("unknown");
  });
});

describe("resolveApprover — guardian-primary branches", () => {
  it("child guardian is the approver (single child)", () => {
    const result = resolveApprover(
      input({
        acceptedFamilyLinks: [link({ guardianId: "child-1", relationship: "son" })],
      }),
    );
    expect(result).toEqual({
      approverUserId: "child-1",
      requiresGuardianApproval: true,
      frictionLevel: "none",
      reason: "guardian_primary_child",
    });
  });

  it("spouse guardian when no child is linked", () => {
    const result = resolveApprover(
      input({
        acceptedFamilyLinks: [link({ guardianId: "spouse-1", relationship: "wife" })],
      }),
    );
    expect(result.approverUserId).toBe("spouse-1");
    expect(result.reason).toBe("guardian_primary_spouse");
    expect(result.requiresGuardianApproval).toBe(true);
    expect(result.frictionLevel).toBe("none");
  });

  it("caregiver guardian when no child or spouse", () => {
    const result = resolveApprover(
      input({
        acceptedFamilyLinks: [link({ guardianId: "nurse-1", relationship: "nurse ji" })],
      }),
    );
    expect(result.approverUserId).toBe("nurse-1");
    expect(result.reason).toBe("guardian_primary_caregiver");
  });

  it("child wins over spouse when both are linked", () => {
    const result = resolveApprover(
      input({
        acceptedFamilyLinks: [
          link({
            guardianId: "spouse-1",
            relationship: "husband",
            acceptedAt: "2025-12-01T00:00:00.000Z",
          }),
          link({
            guardianId: "child-1",
            relationship: "beta",
            acceptedAt: "2026-02-01T00:00:00.000Z",
          }),
        ],
      }),
    );
    expect(result.approverUserId).toBe("child-1");
    expect(result.reason).toBe("guardian_primary_child");
  });

  it("spouse wins over caregiver", () => {
    const result = resolveApprover(
      input({
        acceptedFamilyLinks: [
          link({ guardianId: "nurse-1", relationship: "caregiver" }),
          link({ guardianId: "spouse-1", relationship: "patni" }),
        ],
      }),
    );
    expect(result.approverUserId).toBe("spouse-1");
    expect(result.reason).toBe("guardian_primary_spouse");
  });

  it("earliest acceptance wins as tiebreaker within the same family", () => {
    const result = resolveApprover(
      input({
        acceptedFamilyLinks: [
          link({
            guardianId: "child-late",
            relationship: "daughter",
            acceptedAt: "2026-03-01T00:00:00.000Z",
          }),
          link({
            guardianId: "child-early",
            relationship: "son",
            acceptedAt: "2026-01-15T00:00:00.000Z",
          }),
          link({
            guardianId: "child-mid",
            relationship: "beta",
            acceptedAt: "2026-02-15T00:00:00.000Z",
          }),
        ],
      }),
    );
    expect(result.approverUserId).toBe("child-early");
    expect(result.reason).toBe("guardian_primary_child");
  });

  it("identical acceptedAt → stable order (first occurrence in input wins)", () => {
    const sameTs = "2026-01-01T00:00:00.000Z";
    const result = resolveApprover(
      input({
        acceptedFamilyLinks: [
          link({ guardianId: "child-A", relationship: "son", acceptedAt: sameTs }),
          link({ guardianId: "child-B", relationship: "beta", acceptedAt: sameTs }),
        ],
      }),
    );
    // The reducer prefers the first candidate when comparisons return 0.
    expect(result.approverUserId).toBe("child-A");
  });

  it("non-approver relationships (father, brother) are ignored", () => {
    const result = resolveApprover(
      input({
        acceptedFamilyLinks: [
          link({ guardianId: "father-1", relationship: "father" }),
          link({ guardianId: "brother-1", relationship: "bhai" }),
        ],
      }),
    );
    // No qualifying guardian → falls through to solo flow.
    expect(result.approverUserId).toBe("patient-1");
    expect(result.requiresGuardianApproval).toBe(false);
    expect(result.frictionLevel).toBe("high");
    expect(result.reason).toBe("self_solo_with_friction");
  });

  it("null relationship is ignored — not approver-eligible", () => {
    const result = resolveApprover(
      input({
        acceptedFamilyLinks: [link({ guardianId: "g-null", relationship: null })],
      }),
    );
    expect(result.approverUserId).toBe("patient-1");
    expect(result.reason).toBe("self_solo_with_friction");
  });
});

describe("resolveApprover — self branches", () => {
  it("self-capable adult: no qualifying guardian, but acts as guardian elsewhere", () => {
    const result = resolveApprover(input({ patientIsGuardianElsewhere: true }));
    expect(result).toEqual({
      approverUserId: "patient-1",
      requiresGuardianApproval: false,
      frictionLevel: "none",
      reason: "self_capable_adult",
    });
  });

  it("self-capable adult: only non-approver relationships present + acts as guardian elsewhere", () => {
    const result = resolveApprover(
      input({
        acceptedFamilyLinks: [link({ guardianId: "father-1", relationship: "father" })],
        patientIsGuardianElsewhere: true,
      }),
    );
    expect(result.reason).toBe("self_capable_adult");
  });

  it("self solo with friction: no guardian + not a guardian elsewhere", () => {
    const result = resolveApprover(input());
    expect(result).toEqual({
      approverUserId: "patient-1",
      requiresGuardianApproval: false,
      frictionLevel: "high",
      reason: "self_solo_with_friction",
    });
  });
});

describe("resolveApprover — invariants", () => {
  it("requiresGuardianApproval is true IFF approverUserId !== patientUserId", () => {
    const cases: ApproverResolverInput[] = [
      input(),
      input({ patientIsGuardianElsewhere: true }),
      input({ acceptedFamilyLinks: [link({ guardianId: "g-1", relationship: "son" })] }),
      input({
        acceptedFamilyLinks: [link({ guardianId: "g-1", relationship: "father" })],
      }),
    ];
    for (const c of cases) {
      const r = resolveApprover(c);
      expect(r.requiresGuardianApproval).toBe(r.approverUserId !== c.patientUserId);
    }
  });

  it("high friction is ONLY ever produced by self_solo_with_friction", () => {
    const cases: ApproverResolverInput[] = [
      input(),
      input({ patientIsGuardianElsewhere: true }),
      input({ acceptedFamilyLinks: [link({ guardianId: "g-1", relationship: "son" })] }),
    ];
    for (const c of cases) {
      const r = resolveApprover(c);
      if (r.frictionLevel === "high") {
        expect(r.reason).toBe("self_solo_with_friction");
      }
    }
  });
});
