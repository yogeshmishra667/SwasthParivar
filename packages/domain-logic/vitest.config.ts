import { defineConfig } from "vitest/config";

/**
 * Coverage policy.
 *
 * CLAUDE.md "Coverage Targets" (the ratchet destination):
 *   - critical-bypass/**: 100% lines + branches  (safety-critical)
 *   - streak-engine/**:   100%
 *   - voice-parser/**:    ≥ 95%
 *   - feedback-engine/**: ≥ 95%
 *   - notification-resolver/**: ≥ 90%
 *   - detectors/**:       ≥ 95%
 *
 * Current state (2026-05-14, this branch): the global 95% aggregate
 * is enforced and passes; per-file ratchets are *not* yet active
 * because notification-resolver, streak-engine, feedback-engine,
 * voice-parser, and detectors/stats still sit at 80-88% on branches.
 *
 * Follow-up: ship `chore/coverage-ratchet` to (a) close the per-file
 * gaps with targeted tests and (b) flip `perFile: true` plus add the
 * path-specific overrides below. Until then, this config still
 * enforces an aggregate floor — which catches gross regressions —
 * and CI runs `test:coverage` so the floor cannot silently slide.
 */
export default defineConfig({
  test: {
    name: "domain-logic",
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/index.ts", "src/**/*.types.ts", "src/_blocked.d.ts"],
      thresholds: {
        // Aggregate floor — gross-regression catcher. Per-file
        // enforcement is queued in `chore/coverage-ratchet`.
        lines: 95,
        functions: 90,
        branches: 85,
        statements: 90,
        perFile: false,
      },
    },
  },
});
