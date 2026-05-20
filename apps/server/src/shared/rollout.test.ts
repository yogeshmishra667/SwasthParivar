import { describe, expect, it } from "vitest";
import { computeBucket } from "./rollout.js";

// `isFeatureEnabled` itself reads Redis via getFlag — exercised in the
// config endpoint integration test. `computeBucket` is pure node:crypto
// and is unit-tested here for determinism + range.

describe("computeBucket", () => {
  it("is deterministic for the same (feature, user) pair", () => {
    const a = computeBucket("ai_chat_enabled", "user-123");
    const b = computeBucket("ai_chat_enabled", "user-123");
    expect(a).toBe(b);
  });

  it("always lands in the 0–99 range", () => {
    for (let i = 0; i < 500; i += 1) {
      const bucket = computeBucket("ai_chat_enabled", `user-${i}`);
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(100);
    }
  });

  it("keys the bucket by feature — the same user differs across features", () => {
    // Not a hard guarantee for every user, but across a sample the two
    // features must not produce identical bucket sequences.
    let differs = false;
    for (let i = 0; i < 100 && !differs; i += 1) {
      const userId = `user-${i}`;
      if (computeBucket("feature_a", userId) !== computeBucket("feature_b", userId)) {
        differs = true;
      }
    }
    expect(differs).toBe(true);
  });

  it("spreads users roughly evenly across buckets", () => {
    const counts = new Array<number>(100).fill(0);
    const sampleSize = 10_000;
    for (let i = 0; i < sampleSize; i += 1) {
      const bucket = computeBucket("ai_chat_enabled", `user-${i}`);
      counts[bucket] = (counts[bucket] ?? 0) + 1;
    }
    // Expected ~100 per bucket. A wildly skewed hash would fail this.
    const max = Math.max(...counts);
    const min = Math.min(...counts);
    expect(max).toBeLessThan(200);
    expect(min).toBeGreaterThan(30);
  });
});
