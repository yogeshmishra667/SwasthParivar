import { describe, expect, it } from "vitest";
import { evaluateRollout, type RolloutUser } from "./rollout.js";

const USER: RolloutUser = { id: "user-in", bucket: 42 };

describe("evaluateRollout — global boolean (CC.12.0 back-compat)", () => {
  it("returns true for a global-on boolean flag", () => {
    expect(evaluateRollout(true, USER)).toBe(true);
  });

  it("returns false for a global-off boolean flag", () => {
    expect(evaluateRollout(false, USER)).toBe(false);
  });
});

describe("evaluateRollout — malformed values fail closed", () => {
  it("returns false for null", () => {
    expect(evaluateRollout(null, USER)).toBe(false);
  });

  it("returns false for a stray string", () => {
    expect(evaluateRollout("firebase", USER)).toBe(false);
  });

  it("returns false for a number", () => {
    expect(evaluateRollout(5, USER)).toBe(false);
  });

  it("returns false for an array", () => {
    expect(evaluateRollout(["user-in"], USER)).toBe(false);
  });

  it("returns false for an object without a rollout discriminant", () => {
    expect(evaluateRollout({}, USER)).toBe(false);
  });

  it("returns false for an unrecognised rollout kind", () => {
    expect(evaluateRollout({ rollout: "geo" }, USER)).toBe(false);
  });
});

describe("evaluateRollout — cohort allowlist", () => {
  it("returns true when the user id is in the allowlist", () => {
    expect(evaluateRollout({ rollout: "cohort", userIds: ["user-in", "x"] }, USER)).toBe(true);
  });

  it("returns false when the user id is not in the allowlist", () => {
    expect(evaluateRollout({ rollout: "cohort", userIds: ["other"] }, USER)).toBe(false);
  });

  it("fails closed when userIds is not an array", () => {
    expect(evaluateRollout({ rollout: "cohort", userIds: "user-in" }, USER)).toBe(false);
  });
});

describe("evaluateRollout — percentage bucket", () => {
  it("returns true when the bucket is under the percentage", () => {
    expect(evaluateRollout({ rollout: "percentage", percent: 50 }, USER)).toBe(true);
  });

  it("returns false when the bucket is at or above the percentage", () => {
    expect(evaluateRollout({ rollout: "percentage", percent: 42 }, USER)).toBe(false);
  });

  it("fails closed when percent is not a number", () => {
    expect(evaluateRollout({ rollout: "percentage", percent: "half" }, USER)).toBe(false);
  });
});

describe("evaluateRollout — cohort_or_percentage union", () => {
  it("returns true via the cohort arm even at percent 0", () => {
    expect(
      evaluateRollout({ rollout: "cohort_or_percentage", userIds: ["user-in"], percent: 0 }, USER),
    ).toBe(true);
  });

  it("returns true via the percentage arm when not in the cohort", () => {
    expect(
      evaluateRollout({ rollout: "cohort_or_percentage", userIds: ["other"], percent: 100 }, USER),
    ).toBe(true);
  });

  it("returns false when neither arm matches", () => {
    expect(
      evaluateRollout({ rollout: "cohort_or_percentage", userIds: ["other"], percent: 0 }, USER),
    ).toBe(false);
  });
});

describe("evaluateRollout — percentage stability (CC.12.5)", () => {
  it("a user in at percent N stays in as percent ramps up", () => {
    const config = (percent: number) => ({ rollout: "percentage" as const, percent });
    // bucket 42 is in at 43, must remain in at every higher percent.
    for (let percent = 43; percent <= 100; percent += 1) {
      expect(evaluateRollout(config(percent), USER)).toBe(true);
    }
  });
});
