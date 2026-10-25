# Contributing to SwasthParivar

This file is the operating manual for the repo: branching, commits, reviews,
and the safety constraints that come from `CLAUDE.md`. Read it before opening
your first PR — most surprises are documented here.

## TL;DR

```
git switch -c <type>/<short-slug>     # branch
# ...edit, save...
git add <files>                        # never `git add -A`; sensitive files exist
git commit                             # commitlint enforces format; hook runs lint
git push -u origin HEAD                # opens upstream; PR via gh pr create
```

## Branch naming

Pattern: `<type>/<short-slug>`. The slug is kebab-case, ≤ 5 words, scoped to
one logical change. Examples:

```
feat/voice-stt-wiring
feat/watermelon-offline-queue
fix/critical-alert-back-block
chore/upgrade-prisma-7
test/streak-grace-window
docs/onboarding-runbook
hotfix/sos-dialer-crash
```

| Type       | Used for                                            |
| ---------- | --------------------------------------------------- |
| `feat`     | Net-new behaviour or capability                     |
| `fix`      | Bug fix on existing behaviour                       |
| `perf`     | Performance change with no functional delta         |
| `refactor` | Internal restructure, no behavioural change         |
| `test`     | Add/repair tests only                               |
| `docs`     | Documentation only                                  |
| `chore`    | Tooling, deps, config — no production code          |
| `hotfix`   | Production-blocking fix; bypasses normal review SLA |

`main` is the only protected branch. Never push directly to it. Never force-
push to `main`. Force-push elsewhere only on your own feature branches.

## Commit messages — Conventional Commits

Format:

```
<type>(<scope>): <subject>

<body — what changed and WHY, not how. Wrap at 72 cols.>

<footer — issue refs, BREAKING CHANGE notes>
```

Scope is the module touched (`mobile`, `server`, `domain-logic`, `repo`, `ci`,
`readings`, `streak`, `voice`, `critical-alert`, `sync`, etc.). The
`commitlint` hook will reject anything off-format on commit.

**Examples** (modelled on this repo's history):

```
feat(server): server-time streak fallback for anomalous device clocks (Patch #18)
fix(mobile): block back during critical alert + sanitize tel: URIs
test(server): assert critical-alert queue + anti-cheat flag persistence
docs: refresh PROGRESS.md to reflect Session 4
chore(repo): broaden .expo/ ignore to all workspaces
```

Subject in the imperative ("add", "fix", "drop"), no trailing period, ≤ 72
chars on the first line. Body wraps at 72 too.

### Atomic commits

One conceptual change per commit. If you touched 5 things, that's 5 commits.
Reviewers should be able to bisect cleanly. Use `git add -p` when needed to
split a working file into multiple commits.

### No `Co-Authored-By` trailers

Project convention: don't add tool-author trailers. Human authorship only.

## Pre-commit + pre-push hooks

Husky runs three hooks for you (auto-installed via `pnpm install` postinstall):

| Hook         | What it runs                                                                                         | When it blocks      |
| ------------ | ---------------------------------------------------------------------------------------------------- | ------------------- |
| `pre-commit` | `lint-staged` → ESLint + Prettier on staged TS/TSX/JSON/MD/YAML, `prisma format` if schema is staged | Lint or type errors |
| `commit-msg` | `commitlint` against Conventional Commits                                                            | Off-format message  |
| `pre-push`   | `scripts/preflight.sh` — full local CI mirror (see below)                                            | Any failure         |

`scripts/preflight.sh` wipes every build artefact + tsbuildinfo first
(to defeat "passes locally, fails in CI" drift), then runs:

1. Frozen `pnpm install` (matches CI lockfile lock)
2. Workspace `typecheck` (5 projects)
3. Workspace `lint` (max-warnings=0)
4. Prettier `format:check`
5. `prisma format` check on `schema.prisma`
6. Schema ↔ migration parity (`scripts/check-migration-parity.sh`)
7. Squawk migration SQL safety on new migrations only (`scripts/lint-migrations.sh`)
8. Domain-logic purity (`scripts/check-domain-purity.mjs`) + mobile i18n
   parity (`scripts/check-i18n-parity.mjs`)
9. Domain-logic `test:coverage` with per-file ratchets

Optional opt-ins: `PREFLIGHT_FULL=1 git push` adds Testcontainers integration
tests + Docker image build + `/health` smoke (~5min total).

### Gate map — local vs CI

Everything that runs in CI also runs locally **except** the ones below.
The gap is intentional (cost vs. value), not drift.

CI (`.github/workflows/ci.yml`) runs on pull requests, plus a weekly full
run on `main` (Mondays 06:00 IST) and on manual dispatch. On a PR, each job
runs **only when its area changed** — the `Detect changed paths` job routes
them, and every gate fails open (if routing errors, the job runs). There is
no post-merge run: branch protection requires PRs to be up to date with
`main`, so the merged tree is exactly what CI passed.

| Gate (CI job → step)                                    | pre-commit |   pre-push (preflight)    | CI — runs on a PR when…                             |
| ------------------------------------------------------- | :--------: | :-----------------------: | --------------------------------------------------- |
| **Typecheck (workspace)** ★                             |     —      |            ✅             | any app / package / script / root config changed    |
| Lint, format & build → Prettier + Prisma format         | ✅ staged  |            ✅             | always                                              |
| Lint, format & build → domain-logic purity              |     —      |            ✅             | `packages/**` changed                               |
| Lint, format & build → ESLint + workspace build         | ✅ staged  |       ✅ workspace        | any app / package / script / root config changed    |
| **Unit tests (domain-logic)** ★ → domain-logic + cov.   |     —      |            ✅             | `packages/**` changed                               |
| … → server unit / admin / mobile (RNTL) suites          |     —      |             —             | that app (or a package it uses) changed             |
| **Integration tests (server)** ★                        |     —      | opt-in `PREFLIGHT_FULL=1` | server or `packages/**` changed                     |
| **Schema ↔ migration parity** ★ → parity + squawk       |     —      |            ✅             | schema / migrations / migration scripts changed     |
| … → drift (replay migrations, diff vs `schema.prisma`)  |     —      |             —             | same as above                                       |
| Mobile app checks → i18n parity (en ↔ hi)               |     —      |            ✅             | mobile or `packages/**` changed                     |
| … → Expo SDK compatibility + Metro bundle (Android/iOS) |     —      |             —             | same as above                                       |
| Dependency audit (`pnpm audit`, HIGH/CRITICAL)          |     —      |             —             | lockfile / manifests changed (+ weekly on `main`)   |
| Secret scan (gitleaks)                                  |     —      |             —             | always                                              |
| Server image build + `/health` smoke (+ Trivy, info)    |     —      |  opt-in `--with-docker`   | server, `packages/**`, root config, compose changed |
| SBOM (CycloneDX + SPDX) — `sbom.yml`                    |     —      |             —             | release tags only (informational)                   |

★ = required by branch protection on `main` (exact job names — don't rename).
Any change to `ci.yml` or root config (lockfile, root `package.json`,
`tsconfig*.json`, `eslint.config.mjs`) re-runs everything.

Skipping a hook in an emergency: `git commit --no-verify` / `git push --no-verify`.
Use sparingly — CI runs the same checks and will reject the PR. If you find
yourself reaching for `--no-verify` regularly, file an issue: a gate is mis-tuned.

## Pull requests

- Branch off `main`, target `main`. Rebase on `main` before review (no merge
  commits in feature branches).
- Use `gh pr create` — the template at `.github/PULL_REQUEST_TEMPLATE.md`
  pre-fills required sections.
- Title mirrors the lead commit subject.
- Body includes: **summary**, **safety review** (does this touch the critical
  bypass chain, glucose validation, sync conflict resolution, or notifications?),
  **test plan**, **screenshots** for UI changes.
- One reviewer minimum. Two for any change that touches files in
  `.github/CODEOWNERS`'s `safety-critical` paths (critical bypass, streak engine,
  voice parser, sync conflict resolution).

### Review SLA

| Type            | First review |
| --------------- | ------------ |
| `hotfix`        | < 1 hr       |
| `fix`           | < 1 day      |
| Everything else | < 2 days     |

## Phase discipline (from CLAUDE.md)

This project ships in strict phases. Do not add code that's outside the
current phase, even if "it's just a model". Reviewers will reject
out-of-phase changes.

- **Phase 1 (now):** glucose only. Voice + critical bypass + medications + streaks.
- **Phase 2:** BP, meals, insights, dashboard summary, guardian read-only.
- **Phase 3:** AI chat, Silent Guardian, SOS, basic guardian alerts.
- **Phase 4+:** prescription OCR, cardiac/respiratory, doctor appts, regional langs.

If a change reads tempting but feels like Phase 2, it is. Defer it.

## Safety-critical paths

These files are in `CODEOWNERS` and require **two** reviews + the relevant
subagent run before merge:

- `apps/server/src/modules/readings/**` — glucose validation, critical bypass
- `packages/domain-logic/src/critical-bypass/**` — bypass decision engine
- `packages/domain-logic/src/streak-engine/**` — streak math (medical timestamps + gamification)
- `packages/domain-logic/src/voice-parser/**` — Hindi/Hinglish parsing
- `apps/mobile/src/components/logging/CriticalAlert.tsx` — fullscreen safety alert
- `apps/server/src/workers/critical-alert.worker.ts` — push + SMS escalation
- `apps/server/prisma/schema.prisma` — schema; **also** require a matching migration

If you change one of these, run the matching subagent locally before pushing:

```
# Examples
claude /agents safety-reviewer "review changes to critical-bypass.service.ts"
claude /agents domain-logic-reviewer "review streak-engine changes"
claude /agents db-reviewer "review schema migration"
```

## Database migrations

- **Never** edit a migration that has been applied to any environment.
- New migrations: `pnpm --filter @swasth/server prisma:migrate -- --name <slug>`
- Migration name uses underscores, ≤ 60 chars, describes WHAT and WHY:
  `reading_anti_cheat_and_streak_source` (good)
  `update_schema` (rejected by review).
- Every schema PR has at least one matching migration folder. CI fails the
  PR if not.

## Linting + formatting

- `pnpm lint` runs ESLint on each workspace (typecheck-aware rules).
- `pnpm format` runs Prettier across the repo.
- Both are wired into `pre-commit` via lint-staged for staged files only —
  fast (≤ 2s typical) and scoped.

## What to do when CI fails

1. Read the failing job's log. Reproduce locally with the same command.
2. Don't `--no-verify` past it. CI will catch it again on push.
3. If a flake (Testcontainers timeout, Redis race), retry once. If it persists,
   open an issue tagged `ci-flake`; don't merge through it.

## Releases

We don't release yet. When we do:

- Tag pattern: `vMAJOR.MINOR.PATCH` (e.g. `v0.1.0`).
- Mobile: builds via EAS; OTA updates allowed for JS-only changes.
- Server: deploy from `main`, never from a feature branch.
- Database migrations run via `pnpm --filter @swasth/server prisma:deploy` in
  the deploy job, **before** the new code starts.
