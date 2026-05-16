/**
 * lint-staged config (moved out of package.json so the prisma block
 * can use a function — see WHY below).
 *
 * Runs on every `git commit` via .husky/pre-commit.
 *
 * Glob → command(s) array → lint-staged spawns each command with the
 * matched staged files appended. Edits get auto-re-staged.
 *
 * WHY the prisma block uses a function:
 *   `pnpm --filter @swasth/server exec X` runs X with cwd inside
 *   apps/server/. If lint-staged appends the matched path
 *   `apps/server/prisma/schema.prisma`, prisma looks for
 *   `apps/server/apps/server/prisma/schema.prisma` — file-not-found.
 *   Function syntax (return string[]) suppresses the path append, so
 *   prisma format reads from its default location (apps/server/prisma/
 *   schema.prisma) under that cwd. There's only one schema in the repo;
 *   path-explicit is unnecessary.
 */
module.exports = {
  "*.{ts,tsx}": [
    "eslint --fix --no-warn-ignored --max-warnings=0",
    "prettier --write",
  ],
  "*.{json,md,yml,yaml}": ["prettier --write"],
  "apps/server/prisma/schema.prisma": () => [
    "pnpm --filter @swasth/server exec prisma format",
  ],
};
