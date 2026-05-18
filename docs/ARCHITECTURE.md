# Architecture blueprint

> What got built, how the pieces fit, and what's portable to the next
> project. Written so you can read it cold in six months and rebuild the
> same shape elsewhere without re-deriving every decision.

## Reading order

1. **Quality gates** — what runs in CI and how to run it locally
2. **Docker** — what the image is for and what it isn't
3. **Observability stack** — logs (Pino) + errors (Sentry) + analytics (PostHog)
4. **Idempotent sync** — how `client_uuid + version` works
5. **Critical-bypass full chain** — the medical-safety hot path
6. **Flag service** — kill switches without redeploy
7. **Domain-logic purity** — the standout pattern, worth lifting whole
8. **What NOT to use these for** — guardrails on the systems above

---

## 1. Quality gates

### What runs in CI (`.github/workflows/ci.yml`)

| Job               | Command                                                                                                                            | Fails on                                                                                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typecheck         | `pnpm typecheck`                                                                                                                   | any TS error in any of the 5 projects                                                                                                                                                     |
| Lint              | `pnpm lint` (includes `eslint-plugin-security`: eval, ReDoS, timing-attack, weak RNG, child_process injection, bidi/Trojan Source) | any ESLint warning or error                                                                                                                                                               |
| Format            | `pnpm format:check`                                                                                                                | any Prettier drift                                                                                                                                                                        |
| Prisma format     | `bash scripts/check-prisma-format.sh`                                                                                              | `schema.prisma` is not `prisma format`-clean (catches attribute-order drift, whitespace)                                                                                                  |
| Domain purity     | `node scripts/check-domain-purity.mjs`                                                                                             | forbidden imports or `Date.now`/`Math.random`/`new Date()` in `packages/domain-logic/src/`                                                                                                |
| Build             | `pnpm build`                                                                                                                       | any package or app build failure                                                                                                                                                          |
| Audit             | `pnpm audit --prod --audit-level=high`                                                                                             | a HIGH or CRITICAL CVE in the prod dep graph                                                                                                                                              |
| Dependency review | `actions/dependency-review-action`                                                                                                 | a HIGH/CRITICAL CVE OR GPL/AGPL/SSPL license entering the lockfile via the PR diff (earlier signal than `pnpm audit`)                                                                     |
| Secret scan       | gitleaks                                                                                                                           | secret pattern in git history                                                                                                                                                             |
| SAST              | CodeQL `security-and-quality` query pack                                                                                           | injection, weak crypto, hardcoded secrets, prototype pollution, ReDoS — JS/TS only. Findings in Security → Code scanning.                                                                 |
| Unit tests        | `pnpm --filter @swasth/domain-logic test:coverage`                                                                                 | per-file or aggregate coverage thresholds (see `packages/domain-logic/vitest.config.ts`)                                                                                                  |
| Integration       | `pnpm test:integration`                                                                                                            | any of the server integration tests; uses Testcontainers Postgres + Redis                                                                                                                 |
| Migration parity  | `bash scripts/check-migration-parity.sh` (semantic via `prisma migrate diff`)                                                      | datamodel changed without a new migration file (pure-format / comment / reorder edits do NOT trigger)                                                                                     |
| Migration lint    | `bash scripts/lint-migrations.sh` (squawk)                                                                                         | unsafe SQL in a NEW migration (NOT NULL without default, renames, type changes)                                                                                                           |
| Image smoke       | `docker build` + curl `/health`                                                                                                    | Dockerfile doesn't produce a bootable image                                                                                                                                               |
| Image CVE scan    | Trivy (HIGH+CRITICAL, fixable only, OS + library)                                                                                  | vulnerable Node base or system package — `ignore-unfixed: true` so unfixed CVEs surface as tracked issues, not PR blockers                                                                |
| Danger            | `pnpm dlx danger ci`                                                                                                               | (1) domain-logic source changed without a test, (2) schema.prisma changed without migration, (3) PR > 500 LoC without "## Why this is large"                                              |
| SBOM              | Syft (CycloneDX + SPDX) — source-tree + Docker image                                                                               | (informational — attached to GitHub releases on `v*` tag. Removed from PR + main-push triggers to stay inside the Actions Pro quota; CVE catching is `pnpm audit` + Trivy, not the SBOM.) |
| OpenSSF Scorecard | weekly cron + push to main                                                                                                         | (informational — uploads SARIF to Security tab; scores branch protection, pinned actions, signed releases, SAST presence, token perms, etc.)                                              |
| Dependabot        | weekly cron                                                                                                                        | (informational PRs only — doesn't fail builds)                                                                                                                                            |
| Audit moderate    | monthly cron                                                                                                                       | files a GitHub Issue when moderate CVEs accumulate                                                                                                                                        |

### How to run this locally

`bash scripts/preflight.sh` — wipes `dist/` and `.tsbuildinfo`, runs every static gate + unit tests. ~30s on a warm laptop.

Add `--full` to also run integration tests + Docker image build + `/health` probe. ~5 min, needs Docker daemon.

The pre-push git hook runs preflight automatically. **Override is `git push --no-verify`** — only in emergencies.

### Why this exists

A test that passes on a developer laptop but fails in CI is a wasted CI cycle. The preflight script eliminates the difference: same artefact wipe as a fresh clone, same `pnpm install --frozen-lockfile`, same gate sequence as CI runs.

### Local ↔ CI: shared scripts as the single source of truth

The format-check, schema↔migration parity, and squawk migration lint
gates all live in `scripts/check-prisma-format.sh`,
`scripts/check-migration-parity.sh`, and `scripts/lint-migrations.sh`.
**Both preflight and `.github/workflows/ci.yml` shell out to the same
scripts** — there is no way for the local check to drift from the CI
check, because they are literally the same code. The rule-exclusion
list for squawk (which previously lived inline in CI's run-block) is
now a constant inside the shared script.

### Portable principle

Every project should have **one command that simulates CI locally**. Without it, "passes locally" means nothing. The simulation MUST: wipe build outputs, install with the frozen lockfile, run every gate. If it skips even one of those steps it can miss real bugs.

The corollary: **every gate that runs both places should be a single
script that both callers invoke**, not duplicated logic. Drift is the
default when checks are written twice.

---

## 2. Docker

### Role of the image

- **Production deploy artefact.** Whatever ships to Render/Fly/k8s is this image.
- **Reproducible.** Built from the lockfile, not from npm.
- **Non-root.** Runs as the `node` user (uid 1000).
- **Healthcheckable.** `HEALTHCHECK` baked in; orchestrators see liveness without bespoke config.

### What the image is NOT for

- **Local dev.** Use `pnpm --filter @swasth/server dev` (tsx watch) for dev. The image is build-once-deploy-many; rebuilds for code changes are slow.
- **Running integration tests.** Those use Testcontainers — Postgres + Redis spun up fresh per test run. The image is just the server.
- **Migrations.** `prisma migrate deploy` should run as a one-shot from a separate init container or from CI, not from the long-running server container.

### Lifecycle

```
git push
  → CI builds image: apps/server/Dockerfile (multi-stage)
       stage 1 deps:    pnpm install --frozen-lockfile + prisma generate
       stage 2 build:   tsc emits packages/*/dist + apps/server/dist
       stage 3 runtime: copy only dist + node_modules + prisma schema
                        + package.json. Run as user `node`. HEALTHCHECK.
  → CI tags as commit-SHA, pushes to registry (when registry is wired)
  → Deploy host pulls and runs:
       docker run \
         -e DATABASE_URL=... -e REDIS_URL=... \
         -e JWT_SECRET=... -e POSTHOG_API_KEY=... -e SENTRY_DSN=... \
         -p 4000:4000 swasth-server:<sha>
  → HEALTHCHECK probes /health every 30s; orchestrator restarts on failure
```

### Why three stages

- `deps` cacheable across source changes (only invalidates on lockfile change). ~80s on cold cache, <5s on warm.
- `build` exists only to produce `dist/` — its layers never end up in the final image.
- `runtime` is the minimal artefact (no source, no devDeps, no `.git`, no tests). Smaller image = faster pull = faster deploy.

### Portable principle

A production Docker image should answer one question: "what files MUST be in the runtime layer to make the binary work?" If you're copying source files into the runtime stage, the build is wrong. If you're copying the whole node_modules, you've left devDeps in.

---

## 3. Observability stack

Three layers, three audiences.

### Pino (structured logs) — for grep + your eyes

- Module: `apps/server/src/shared/logger.ts`
- Output: JSON in prod, pretty in dev
- PII redaction at the schema level — never logs `phone`, `aadhaar`, `dob`, `authorization`, `cookie`
- `requestId` middleware (`apps/server/src/shared/middleware/request-id.ts`) attaches a UUID per request; pino-http logs it on every line
- BullMQ workers create a child logger with `{ queue, jobId, requestId }` so request → job → push is one searchable trace
- **Use when:** you want a permanent line in the log stream that future you / future on-call will grep

### Sentry (error tracking) — for "something broke"

- Server: `apps/server/src/shared/observability/sentry.ts`
- Mobile: `apps/mobile/src/services/sentry.ts`
- Captures: unhandled 5xx errors, `unhandledRejection`, `uncaughtException`, mobile React render crashes via `<ErrorBoundary>`
- **No-op when DSN missing.** Dev/test runs are silent.
- PII scrubbing: drops `authorization` / `cookie` headers, drops URL query strings on mobile
- **Use when:** you want a human-grade alert. Sentry will group by stack trace, attach breadcrumbs, page someone.

### PostHog (product analytics) — for "is the product working"

- Module: `apps/server/src/shared/analytics/posthog.ts`
- Strongly-typed `EventPropsMap` — adding a new event without extending the map fails typecheck
- Events emitted today (all in service or worker code, not controllers):
  - `reading_logged` — per glucose reading saved
  - `streak_milestone` — when a 3/7/14/30/etc. milestone is hit
  - `voice_attempt` — both success and rejected paths
  - `critical_bypass_triggered` — from the worker, after the actual dispatch
  - `notification_sent` — both sent and suppressed paths
- **No-op when API key missing.** Dev/test runs are silent.
- **Use when:** you want to answer a retention/usage question. The Phase-1 success metric ("Papa logs 2+/day for 14 days") is calculable from `reading_logged` alone.

### How they relate

| Layer   | Sample question it answers                                  |
| ------- | ----------------------------------------------------------- |
| Pino    | "what was happening at 03:14 last Tuesday for user X?"      |
| Sentry  | "are we silently swallowing 500s in production?"            |
| PostHog | "what fraction of voice attempts succeed on the first try?" |

Don't use Sentry for product metrics (slow + wrong tool). Don't use PostHog for errors (no stack trace UI). Don't use Pino to answer a metric question (you'll write 20 lines of grep).

### Code-security tooling — a fourth layer for "is the code itself safe"

These are NOT runtime observability — they run pre-merge in CI and
report into the GitHub Security tab. Treat their findings the same way
you'd treat a failing test: triage at PR time, not after deploy.

| Tool                     | Source                                  | What it catches                                                                                              | Where findings appear     |
| ------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------- |
| CodeQL                   | `.github/workflows/codeql.yml`          | SAST: injection, weak crypto, prototype pollution, ReDoS, hardcoded secrets, unsafe data flows               | Security → Code scanning  |
| Dependency review        | `ci.yml` job                            | New HIGH/CRITICAL CVEs + GPL/AGPL/SSPL licenses in the PR diff                                               | PR comment + check status |
| Trivy                    | `image-smoke` job (post-build)          | OS + library CVEs in the produced server Docker image (HIGH+CRITICAL, fixable-only)                          | CI log                    |
| `eslint-plugin-security` | `eslint.config.mjs` (hand-picked rules) | dynamic-code eval, ReDoS, timing-attacks on `===`-compared tokens, weak RNG, `child_process` injection, bidi | Local lint + CI lint step |
| gitleaks                 | `ci.yml` `secret-scan` job              | Secret patterns in git history                                                                               | CI log                    |

Triage recipes for each are in `docs/HOWTO.md` (sections starting
"Triage a …").

### Portable principle

Three things, three tools — for runtime observability. Conflating them
is the most common observability mistake. Wire the three from day one
(even if all three are no-ops without keys) so production-day setup is
just dropping in DSNs.

A fourth set of tools belongs in CI to keep the code itself
trustworthy (CodeQL, dependency review, Trivy, eslint-plugin-security,
gitleaks). None of these need keys; all of them ship findings to the
GitHub Security tab where they survive across PRs and aren't drowned
out by ephemeral run-logs.

### Supply-chain transparency — SBOM + Scorecard

Two informational (non-blocking) workflows audit what's actually being
shipped:

- **`.github/workflows/sbom.yml`** — Syft generates CycloneDX + SPDX
  inventories from (a) the pnpm lockfile (source intent) and (b) the
  built Docker image (actual deploy artefact, includes OS packages
  the lockfile can't see). Triggered on `v*` tag push (attached to
  GitHub releases) and `workflow_dispatch` (ad-hoc, e.g. CVE inquiry).
  PR + main-push triggers were removed — SBOM is inventory, not a
  quality gate, and per-PR generation was the largest single consumer
  of Actions minutes. Auditors and procurement consume the SBOM, not
  the lockfile.
- **`.github/workflows/scorecard.yml`** — OpenSSF Scorecard runs
  weekly + on push to main. Audits 19 supply-chain hygiene rules
  (branch protection, pinned actions, signed releases, token
  permissions, SAST presence, etc.). Results land in the Security
  tab as SARIF and a numeric score is published at
  `https://api.securityscorecards.dev/projects/github.com/<org>/<repo>`.
  Failing rules become a punch list for incremental hardening, not a
  blocker on the current PR.

Neither workflow fails the build. They're audit, not gate. The gates
that DO fail PRs are the ones in the table above.

---

## 4. Idempotent sync — `client_uuid + version`

### Why

Mobile is offline-first. A reading saved offline gets uploaded once connectivity returns. Network retries are common — same POST may arrive 2, 3, 5 times. Without idempotency: HTTP 500s, duplicate rows, support tickets.

### Rules

Every reading has `clientUuid` (UUID generated on the device) + `version` (int, starts at 1, increments on edit).

| Scenario                                                        | Server response                                                                                                                                  |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `clientUuid` unseen                                             | INSERT, return 201 with new row                                                                                                                  |
| `clientUuid` seen, `incoming.version > stored.version`          | UPDATE, return 201 with updated row                                                                                                              |
| `clientUuid` seen, `incoming.version == stored.version`         | **REPLAY** — return 201 with existing row, NO side effects (no streak update, no feedback event, no queue job). This is what makes retries safe. |
| `clientUuid` seen, `incoming.version < stored.version`          | 409 `READING_STALE_VERSION` — client must refetch                                                                                                |
| Two parallel POSTs with same `clientUuid` race past `findFirst` | Prisma `P2002` on the unique constraint; service catches it, refetches, treats as replay                                                         |

### Where it lives

`apps/server/src/modules/readings/readings.service.ts` — the `createGlucoseReading` function. Replay path is the `buildReplayResult` helper.

Schema constraint: `@@unique([clientUuid, measuredAt])` in `apps/server/prisma/schema.prisma`. The constraint is what makes the race-safe path work — without it the parallel path could double-insert.

### Tests pinning the contract

`apps/server/tests/integration/readings.test.ts`:

- "rejects strictly-older version with READING_STALE_VERSION"
- "treats same {clientUuid, version} replay as idempotent (200, single row, no duplicate side effects)"
- "accepts version bump on same clientUuid as an edit"

### Portable principle

Any time the client is offline-capable, idempotency is non-negotiable. The pattern is: client-generated UUID + monotonic version + server-side unique constraint. Without all three, you'll have duplicate-write bugs at scale.

---

## 5. Critical-bypass full chain

### What it does (medical safety)

If glucose < 65 or > 315, four things happen in parallel:

1. **Push notification** to every guardian's Expo push token
2. **SMS fallback** to every emergency contact (only if push fails)
3. **Fullscreen blocking alert** on the patient's phone (cannot dismiss for 30s)
4. **Call-now button** to the priority-1 contact

Per CLAUDE.md, the thresholds and the chain itself are **hardcoded and never flagged** — they're a medical-safety primitive.

### Path through the code

```
POST /api/v1/readings/glucose                   (apps/server/src/modules/readings/readings.controller.ts)
  → readings.service.createGlucoseReading       (.service.ts)
    → @swasth/domain-logic decideCriticalBypass (pure function; thresholds live here)
    → if isCritical && !withinCooldown:
       queue.add("critical-alert", { readingId, userId, decision, requestId })
                                                 ↓
                                            BullMQ
                                                 ↓
  workers/critical-alert.worker.ts              (createWorker side effect)
    → workers/critical-alert.processor.ts       (pure async function, importable for tests)
      → sendExpoPush(...)                       (shared/notifications/expo-push.ts)
      → sendSmsBatch(...)  IFF push failed      (shared/notifications/msg91-sms.ts)
      → captureAnalyticsEvent("critical_bypass_triggered", ...)
```

The split into `.worker.ts` (createWorker call) + `.processor.ts` (pure function) is the design that makes the integration test work without a real BullMQ listener — the test imports the processor directly and invokes it on a fake job.

### Tests pinning the contract

`apps/server/tests/integration/critical-bypass-chain.test.ts`:

- "low-glucose POST: push succeeds → SMS NOT triggered"
- "high-glucose POST: push fails → SMS fallback triggered"
- "preserves requestId from HTTP request through queue payload"
- "normal-range reading: NO queue job is enqueued and NO notifications fire"
- "threshold boundary: 65 mg/dL is NOT critical, 64 mg/dL IS critical"

The last one specifically exists so changing the threshold constants breaks the test loudly rather than slipping through review.

### Portable principle

Anything in a safety-critical hot path should be: (a) pure-function logic, (b) tested with both branch-coverage AND threshold-boundary tests, (c) the side-effect-causing wrapper split from the logic so the wrapper itself can be left untested without losing coverage of the logic.

---

## 6. Flag service

### Why

Ops needs kill switches for misbehaving features without a redeploy.

Concrete scenarios this exists for:

- WhatsApp Business API outage → flip OTP routing to SMS
- MSG91 rate-limited → push-only fallback
- Voice recognition bug → force numpad UX
- AI chat misbehaves (Phase 3) → kill switch
- SOS staging env (Phase 3) → test mode that doesn't dial real numbers
- Detector false-positive spike (Phase 2) → disable that detector

### How it works

- Storage: Redis. Keys are `flag:<name>`. JSON values (`string | number | boolean | object | array`).
- Cache: 30-second in-process per-replica. Invalidated by Redis pub/sub on every `setFlag` — every replica clears its cache for that key within milliseconds.
- Audit: every set appends to a capped (100-entry) list at `flag-audit:<name>` with `{ts, prevValue, newValue, by}`.
- Admin route: `/admin/flags` (under `apps/server/src/modules/admin/`) gated by `Authorization: Bearer $ADMIN_API_TOKEN` (constant-time compare).
- Application code calls `getFlag(key, default)` — never crashes if Redis is down (returns the default).

### Endpoints

| Method | Path                      | What                           |
| ------ | ------------------------- | ------------------------------ |
| GET    | `/admin/flags`            | List all set flags             |
| GET    | `/admin/flags/:key`       | Read one flag                  |
| PUT    | `/admin/flags/:key`       | Set (body: `{ "value": ... }`) |
| GET    | `/admin/flags/:key/audit` | Last 20 changes                |

### What is NEVER flagged

Medical-safety constants. Per CLAUDE.md and per the integration test:

- `<65 / >315` glucose thresholds
- The bypass chain (push → SMS → fullscreen → call) and its ordering
- The 30-minute critical cooldown
- The 3 AM streak day boundary

Touching these requires a code change + commit on a branch + 2-reviewer approval. The flag service deliberately cannot toggle them.

### Portable principle

A flag service is generic. Flag _keys_ are added on-demand whenever a real ops need appears — never pre-emptively on a "we might need this" basis. The system is built once; the keys grow as the system meets reality.

---

## 7. Domain-logic purity

### Pattern

`packages/domain-logic/` is pure-function only:

- No DB, no Redis, no HTTP, no `Date.now()`, no `Math.random()`, no `new Date()` without an argument
- Every function takes its inputs explicitly and returns a deterministic result
- Enforced by **three independent mechanisms**:
  1. `tsconfig.json` path mappings that redirect forbidden imports (`@prisma/client`, `ioredis`, `bullmq`, `express`, `axios`, `node:fs/net/http/https/child_process`) to a stub `_blocked.d.ts`
  2. `scripts/check-domain-purity.mjs` — regex scan for `Date.now`, `Math.random`, `new Date()` in `.ts` files
  3. CI job `Domain-logic purity` that runs the script on every push
  4. CODEOWNERS rule requiring 2 reviewers for any change under `packages/domain-logic/src/`

### Why it's worth lifting whole

Pure functions are:

- Trivial to test (no setup, no mocks, no containers)
- Easy to reason about
- Cheap to call from anywhere
- The foundation that makes the safety-critical tests fast and reliable

The triple-enforcement is paranoid by design — any one of the three would catch most violations, but together they prevent the slow drift toward "just this one DB call" that ruins purity over time.

### Portable principle

Find the logic that's truly stateless and isolate it ruthlessly. The investment in a pure-function package pays for itself within the first major refactor. Don't extract "shared types" only — extract the pure decisions too.

---

## 8. Coverage thresholds

### Per-file ratchets

`packages/domain-logic/vitest.config.ts` declares thresholds:

- Aggregate: 95 lines, 90 functions, 85 branches, 90 statements (across the whole package)
- Per-glob overrides:
  - `src/critical-bypass/**`: `{ 100: true }` — locked at 100% on all four metrics
  - Other files: ratcheted at CURRENT measured floors (e.g. streak-engine is at 88/83/90/84 — moves UP only)

### The rule

**Never lower a floor.** If a test removal genuinely drops coverage, raise the question in PR review and adjust both the test and CLAUDE.md.

### Why ratchets instead of targets

Setting CLAUDE.md targets (100 for critical-bypass+streak, 95 for voice+feedback, 90 for notification) on day one would break CI for files that don't meet them yet. The ratchet pattern: lock current floors, let coverage move only up, write tests over time to close the gap. The `chore/coverage-ratchet` follow-up is where that catch-up happens.

### Portable principle

Coverage thresholds work as a **ratchet against regression**, not a **goal**. Pin at current, raise as you write tests. Never let them slide down.

---

## Blueprint summary — what to copy to the next project

If you're starting fresh, these are the patterns worth lifting verbatim:

1. **Preflight script + pre-push hook** — `scripts/preflight.sh` + `.husky/pre-push`. Day-one fix for the "passes locally / fails on CI" failure mode.
2. **Three-stage Dockerfile** — deps → build → runtime, copying only the runtime layer's needs.
3. **Three-tool observability** — Pino + Sentry + PostHog, all no-op without DSN/keys. Wire from day one.
4. **Idempotent sync pattern** — `clientUuid + version + unique constraint + replay path`. Mandatory for any offline-capable client.
5. **Side-effect/processor split for workers** — `.worker.ts` (createWorker call) + `.processor.ts` (pure async function). Makes integration testing possible without a real listener.
6. **Pure-function domain layer with triple enforcement** — tsconfig path blocks + runtime script + CI job + CODEOWNERS rule.
7. **Ratchet-not-target coverage** — pin at current floors, never lower.
8. **Flag service generic; keys on-demand** — build the service once, add keys when reality demands them.
9. **Audit-progress tracking file at repo root** — `audit-progress.md` with a resume protocol. Lets work survive across sessions / contributors / token limits.
10. **Module pattern** — `*.controller.ts` / `*.service.ts` / `*.routes.ts` / `*.validation.ts` / `*.types.ts` / optional `*.jobs.ts`. Codify in CLAUDE.md, scaffold with `pnpm new-module`.
