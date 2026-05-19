import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Workspace dep aliasing — shared-types' package.json `main` points at
// `./dist/index.js` for production Node resolution, but tests want
// source so a fresh checkout works without a prior build.
const workspaceAliases = {
  "@swasth/shared-types": resolve(__dirname, "../shared-types/src/index.ts"),
};

/**
 * Coverage policy — per-file ratchets active.
 *
 * CLAUDE.md "Coverage Targets" (the destination):
 *   - critical-bypass/**: 100% lines + branches  (safety-critical)
 *   - streak-engine/**:   100%
 *   - voice-parser/**:    ≥ 95%
 *   - feedback-engine/**: ≥ 95%
 *   - notification-resolver/**: ≥ 90%
 *   - detectors/**:       ≥ 95%
 *
 * Current state (2026-05-14): critical-bypass is at 100% and locked.
 * Other files are below CLAUDE.md target; per-file ratchet floors are
 * pinned at their CURRENT measured values so coverage can only move
 * UP. Closing the gap to CLAUDE.md targets is tracked as a follow-up
 * (`chore/coverage-ratchet`).
 *
 * Editing rule: never lower a floor. If a test removal genuinely
 * drops coverage on purpose, raise the question in PR review and
 * adjust both the test and CLAUDE.md.
 */
export default defineConfig({
  resolve: { alias: workspaceAliases },
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
        // Aggregate floor — gross-regression catcher across the package.
        lines: 95,
        functions: 90,
        branches: 85,
        statements: 90,
        perFile: false,

        // Safety-critical: locked at CLAUDE.md target. Never lower.
        "src/critical-bypass/**": { 100: true },
        // Phase 3 — AI Chat Post-Response Safety Filter. Per phase3.md
        // A.9, locked at 100% branches like critical-bypass: a
        // regression here lets unsafe content reach a patient.
        "src/chat-safety-filter/**": { 100: true },
        // Phase 3 — chat cost router. Pure decision function; tests
        // pin every branch of the priority chain. Locked at 100% per
        // phase3.md A.9.
        "src/chat-cost-router/**": { 100: true },
        // Phase 3 — Tier 1 template lookup table. 100% reachable; a
        // regression here usually means a new (intent, condition,
        // language) combo was added without copy.
        "src/chat-template-responses/**": { 100: true },
        // Phase 3 — cold-start day-bucket router. Day boundary bugs
        // here mean wrong stage messaging to early users.
        "src/chat-cold-start/**": { 100: true },
        // Phase 3 — intent classifier. Keyword routing into the cost
        // router. Bugs here send `medication_question` to Tier 3 (the
        // exact safety failure phase3.md A.4 step 6 guards against).
        "src/chat-intent-classifier/**": { 100: true },

        // Ratchet floors at CURRENT measured values (2026-05-14 baseline).
        // Raise these as tests close the gap to CLAUDE.md targets.
        "src/detectors/spike.ts": { lines: 100, functions: 100, branches: 95, statements: 100 },
        "src/detectors/stats.ts": { lines: 100, functions: 100, branches: 80, statements: 98 },
        "src/detectors/trend.ts": { lines: 95, functions: 95, branches: 85, statements: 95 },
        "src/voice-parser/parser.ts": {
          // Ratchet raised 2026-05-14 after the voice-flow soft audit:
          // added word-boundary matching + intent-gating + 11 new test
          // cases. CLAUDE.md target is ≥95 across the board — we're at
          // 94.44 on branches/functions; close the last gap in a
          // follow-up by writing tests for the still-uncovered lines
          // (parser.ts:114, 147, 164, 173).
          lines: 100,
          functions: 94,
          branches: 94,
          statements: 96,
        },
        "src/voice-parser/dictionary.ts": {
          lines: 95,
          functions: 90,
          branches: 85,
          statements: 90,
        },
        "src/feedback-engine/engine.ts": {
          lines: 95,
          functions: 100,
          branches: 82,
          statements: 93,
        },
        "src/notification-resolver/resolver.ts": {
          lines: 89,
          functions: 78,
          branches: 69,
          statements: 87,
        },
        "src/streak-engine/engine.ts": {
          lines: 88,
          functions: 90,
          branches: 83,
          statements: 84,
        },
      },
    },
  },
});
