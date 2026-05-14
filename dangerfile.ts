import { danger, fail, warn, message } from "danger";

// Three rules — each one a thing a reviewer would otherwise have to remember
// every PR. Keep this file tight; rules with subjective judgement belong in
// the PR_TEMPLATE checklist, not here.

// ---------------------------------------------------------------------------
// Rule 1 — test-parity for domain-logic.
// Touching a pure-function source file under packages/domain-logic/src/**
// must come with at least one matching .test.ts change. The domain layer
// is safety-critical (CLAUDE.md "Coverage Targets") and a code-only PR
// almost certainly slipped past the per-file ratchet floors.
// ---------------------------------------------------------------------------
const changed = [...danger.git.modified_files, ...danger.git.created_files];

const domainSrc = changed.filter(
  (f) =>
    f.startsWith("packages/domain-logic/src/") &&
    f.endsWith(".ts") &&
    !f.endsWith(".test.ts") &&
    !f.endsWith(".types.ts") &&
    !f.endsWith("/index.ts"),
);
const domainTests = changed.filter(
  (f) => f.startsWith("packages/domain-logic/src/") && f.endsWith(".test.ts"),
);

if (domainSrc.length > 0 && domainTests.length === 0) {
  fail(
    "Domain-logic source changed but no `*.test.ts` was updated.\n\n" +
      "Files changed without matching tests:\n" +
      domainSrc.map((f) => `- \`${f}\``).join("\n") +
      "\n\nDomain logic is safety-critical (CLAUDE.md Coverage Targets). " +
      "If this PR genuinely removes a code path, update the test that asserted it.",
  );
}

// ---------------------------------------------------------------------------
// Rule 2 — migration-parity (PR-visible mirror of the CI job).
// CI already fails the build, but a Danger warning is easier to spot on
// the PR than a buried failing check.
// ---------------------------------------------------------------------------
const schemaTouched = changed.includes("apps/server/prisma/schema.prisma");
const migrationAdded = danger.git.created_files.some((f) =>
  /^apps\/server\/prisma\/migrations\/[^/]+\/migration\.sql$/.test(f),
);

if (schemaTouched && !migrationAdded) {
  fail(
    "`schema.prisma` changed but no new migration file was added under " +
      "`apps/server/prisma/migrations/`.\n\n" +
      "Run: `pnpm --filter @swasth/server prisma:migrate -- --name <slug>`",
  );
}

// ---------------------------------------------------------------------------
// Rule 3 — large-PR explainer.
// PRs above 500 LoC of net change without a "## Why this is large" or
// "## Why so large" section get a soft nudge. Big PRs are sometimes
// correct (refactors, migrations) — we don't fail, we just ask.
// ---------------------------------------------------------------------------
const additions = danger.github.pr.additions ?? 0;
const deletions = danger.github.pr.deletions ?? 0;
const net = additions + deletions;
const body = danger.github.pr.body ?? "";
const hasExplainer = /##\s*why\s+(this\s+is\s+|so\s+)?large/i.test(body);

if (net > 500 && !hasExplainer) {
  warn(
    `This PR changes ${net.toLocaleString()} lines (${additions.toLocaleString()} added, ` +
      `${deletions.toLocaleString()} removed).\n\n` +
      "Add a `## Why this is large` section to the PR body to help reviewers — describe " +
      "what couldn't be split out and why. If this is a sweep (formatter, dep bump, " +
      "lockfile churn), say so explicitly.",
  );
}

// Positive signal — if there's nothing to flag, drop a quiet success message
// rather than a silent green light, so reviewers know Danger ran.
if (
  !(domainSrc.length > 0 && domainTests.length === 0) &&
  !(schemaTouched && !migrationAdded) &&
  !(net > 500 && !hasExplainer)
) {
  message("Danger: all rules passed.");
}
