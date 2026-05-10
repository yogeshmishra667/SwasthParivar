/**
 * Commitlint config — enforces Conventional Commits as documented in
 * CONTRIBUTING.md. The hook at `.husky/commit-msg` invokes this.
 *
 * Anything beyond the standard ruleset is annotated with WHY below.
 */
/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Project allows `hotfix` (production-blocking fix) on top of the standard list.
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "perf",
        "refactor",
        "test",
        "docs",
        "chore",
        "hotfix",
        "build",
        "ci",
        "style",
        "revert",
      ],
    ],
    // Subject in the imperative, lowercase first word, no trailing period.
    // The default `subject-case` is too restrictive (excludes acronyms like
    // "Patch #18", "API"); disable and rely on review.
    "subject-case": [0],
    // Headers wrap at 100 to fit Conventional Commits headlines like:
    //   "feat(server): server-time streak fallback for anomalous device clocks (Patch #18)"
    "header-max-length": [2, "always", 100],
    // Body / footer lines wrap at 100 — same reasoning.
    "body-max-line-length": [2, "always", 100],
    "footer-max-line-length": [2, "always", 100],
  },
};
