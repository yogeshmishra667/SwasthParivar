import { describe, expect, it } from "vitest";
import type { ChatIntent } from "@swasth/shared-types";
import {
  COLD_START_DAY_THRESHOLD,
  MIN_READINGS_FOR_PERSONALISATION,
  pickCostTier,
  type CostTierInput,
} from "./router.js";

// Default "healthy mature user" — adjust per case via spread.
const base: CostTierInput = {
  intent: "open_ended",
  userStageDays: 30,
  readingsAvailable: 50,
  historyMatch: false,
};

describe("pickCostTier — priority chain", () => {
  it("medication_question always returns template (safety pre-empts everything)", () => {
    expect(pickCostTier({ ...base, intent: "medication_question", historyMatch: true })).toBe(
      "template",
    );
    expect(
      pickCostTier({
        ...base,
        intent: "medication_question",
        userStageDays: 30,
        readingsAvailable: 100,
      }),
    ).toBe("template");
  });

  it("historyMatch returns cached when not a medication question", () => {
    expect(pickCostTier({ ...base, historyMatch: true })).toBe("cached");
  });

  it("cold-start by stage returns template (boundary: day < 14)", () => {
    expect(
      pickCostTier({
        ...base,
        userStageDays: COLD_START_DAY_THRESHOLD - 1,
      }),
    ).toBe("template");
  });

  it("at the cold-start day threshold (=14) does NOT trigger cold-start path", () => {
    // Threshold is strict less-than; day 14 is no longer cold-start.
    expect(
      pickCostTier({
        ...base,
        userStageDays: COLD_START_DAY_THRESHOLD,
        readingsAvailable: 100,
        intent: "open_ended",
      }),
    ).toBe("sonnet");
  });

  it("sparse-data triggers template (readings < 5)", () => {
    expect(
      pickCostTier({
        ...base,
        readingsAvailable: MIN_READINGS_FOR_PERSONALISATION - 1,
      }),
    ).toBe("template");
  });

  it("data_explainer goes template even with rich data", () => {
    expect(pickCostTier({ ...base, intent: "data_explainer" })).toBe("template");
  });

  it("lifestyle goes template even with rich data", () => {
    expect(pickCostTier({ ...base, intent: "lifestyle" })).toBe("template");
  });

  it("reading_summary with rich data → sonnet", () => {
    expect(pickCostTier({ ...base, intent: "reading_summary" })).toBe("sonnet");
  });

  it("open_ended with rich data → sonnet", () => {
    expect(pickCostTier({ ...base, intent: "open_ended" })).toBe("sonnet");
  });

  it("default branch — unknown intent shape falls to template (defensive)", () => {
    // The intent type is a closed union but TS-erased at runtime; the
    // default branch protects against shape drift from upstream.
    const odd = { ...base, intent: "unknown_intent" as unknown as ChatIntent };
    expect(pickCostTier(odd)).toBe("template");
  });
});

describe("pickCostTier — distribution sanity (~60/20/20 on synthetic mix)", () => {
  it("hits the expected mix on a representative request distribution", () => {
    // Synthetic distribution matching the assumptions in phase3.md:
    //   - 30% of requests have historyMatch=true  (cached)
    //   - 25% are open_ended or reading_summary with rich data (sonnet)
    //   - the rest are template (cold-start, sparse, deterministic intents)
    const sample: CostTierInput[] = [
      // 30 cached hits
      ...Array.from({ length: 30 }, () => ({ ...base, historyMatch: true })),
      // 25 sonnet
      ...Array.from({ length: 13 }, () => ({ ...base, intent: "open_ended" as const })),
      ...Array.from({ length: 12 }, () => ({ ...base, intent: "reading_summary" as const })),
      // 45 template (cold start + sparse + lifestyle/data_explainer + medication)
      ...Array.from({ length: 10 }, () => ({ ...base, userStageDays: 5 })),
      ...Array.from({ length: 10 }, () => ({ ...base, readingsAvailable: 2 })),
      ...Array.from({ length: 10 }, () => ({ ...base, intent: "lifestyle" as const })),
      ...Array.from({ length: 10 }, () => ({ ...base, intent: "data_explainer" as const })),
      ...Array.from({ length: 5 }, () => ({
        ...base,
        intent: "medication_question" as const,
      })),
    ];

    const tally = { template: 0, cached: 0, sonnet: 0 };
    for (const req of sample) tally[pickCostTier(req)] += 1;

    // 100 requests, allow generous bands. The point is to fail loudly
    // if the priority chain drifts and 80%+ end up in one bucket.
    expect(tally.cached).toBeGreaterThanOrEqual(25);
    expect(tally.sonnet).toBeGreaterThanOrEqual(20);
    expect(tally.template).toBeGreaterThanOrEqual(40);
  });
});
