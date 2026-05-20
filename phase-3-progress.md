# Phase 3 — Progress Log

> Companion to: [phase3.md](./phase3.md) (the plan), `audit-progress.md` (the per-PR audit log).
>
> Per-session entries in the format Phase 2 used in `audit-progress.md`. **Newest first.** Append on every merged PR (or, for in-flight branches, every meaningful milestone). Each entry cites the relevant phase3.md section refs so the plan and the log can be cross-walked.

---

## 2026-05-20 — CC.12 Feature Rollout & Targeting — full implementation

**Branch:** `phase3/feature-rollout` (off `main` at `6f2ee29`, in flight — PR pending). The CC.12 docs spec already merged to `main` as `6f2ee29` (#65); this branch carries the implementation. (The CC.12 work was briefly staged uncommitted on `main` before being moved onto this correctly-named `phase3/…` branch per CC.7 #5 — nothing committed to `main`.)

**What landed.** The full CC.12 system — resolver, gate helper, chat retrofit, config endpoint, flag-change observability, maintenance-mode middleware, and the mobile flag store:

- **CC.12.2 — pure resolver.** `packages/domain-logic/src/feature-rollout/rollout.ts` — `evaluateRollout(config, user)`. Handles all four CC.12.1 value shapes (global boolean / `cohort` / `percentage` / `cohort_or_percentage`). Fail-closed: anything that isn't a boolean or a recognised rollout object → `false`. Zero-IO, no node builtins. **18 tests, locked at 100%** on every metric in `vitest.config.ts` (`src/feature-rollout/**: { 100: true }`).
- **CC.12.3 — server gate helper.** `apps/server/src/shared/rollout.ts` — `isFeatureEnabled(featureKey, userId)` reads the flag via `getFlag` (fail-safe default `false`), computes a stable 0–99 bucket via `node:crypto` SHA-256 of `featureKey:userId`, delegates to `evaluateRollout`. `computeBucket` exported + unit-tested (determinism, 0–99 range, feature-keyed independence, even spread over 10k users).
- **chat retrofit.** `chat.service.ts` swaps both ad-hoc `getFlag<boolean>` reads (`ai_chat_enabled`, `ai_chat_tier3_enabled`) for `isFeatureEnabled`. `auth.otp.provider` left untouched — it's a string config flag, not a rollout flag (CC.12.0).
- **CC.12.4 — mobile feature-config endpoint.** New `apps/server/src/modules/config/` module (`types`/`service`/`controller`/`routes`). `GET /api/v1/config/features` (authed) → `{ features: { ai_chat: bool } }` resolved for the calling user. Mounted at `/api/v1/config` in `app.ts`.
- **CC.12.6 — flag-change observability.** `setFlag` now emits a PostHog `feature_flag_changed{key, rollout_kind, by}` event (new entry in `posthog.ts` `EventPropsMap`) and a Sentry breadcrumb. `rollout_kind` is derived from the new value via a `classifyRolloutKind` helper (`boolean`/`cohort`/`percentage`/`cohort_or_percentage`/`other`). Telemetry failure is caught + logged — it can never break the flag write. The Redis audit log remains system-of-record.
- **CC.12.7 #1 — maintenance-mode middleware.** `apps/server/src/shared/middleware/maintenance-mode.ts` — global `503 MAINTENANCE_MODE` driven by the `maintenance_mode` boolean flag, mounted in `app.ts` after the health probes and before the feature routers. Exempts `/health*` (orchestrator probes) and `/admin*` (so ops can lift maintenance via the flag API). New `MAINTENANCE_MODE` `ErrorCode` mapped to 503 in `error-handler.ts`. Prerequisite for the Week 12 SOS migration (CC.12.8).
- **CC.12.7 #2 — mobile flag store.** `apps/mobile/src/stores/feature-flags.store.ts` — `useFeatureFlags` Zustand store + `useFeatureEnabled(feature)` reactive selector. `refresh()` fetches `GET /config/features` with the 60s in-memory cache pattern from `auth-config.ts`. Fail-safe: a network failure keeps the last known map; an unresolved feature reads `false` (matches the server default).

**Signature deviation from the spec.** CC.12.2 wrote `evaluateRollout(config, userBucket)`. Implemented as `evaluateRollout(config, user)` where `user = { id, bucket }` — cohort allowlist resolution needs the `userId`, and the resolver owns the whole decision per CC.12.3 ("delegates the decision to evaluateRollout"). Both fields are pure values; the module stays zero-IO. The spec's `userBucket` was shorthand.

**FEATURE_REGISTRY scope.** `config.service.ts` resolves only `ai_chat` today — chat is the only built feature opting into CC.12. `silent_guardian` / `sos` rows are added when Features C/D land (per "no preemptive flag keys"). The CC.12.4 example listed all three illustratively; surfacing an unbuilt feature even as `false` would mislead mobile navigation gating. The mobile `FeatureName` union mirrors this.

**Backward compatibility verified (CC.12.0).** The 10 existing chat integration tests + 6 admin-flags tests pass unchanged — `evaluateRollout(true/false, …)` returns booleans untouched, and the new `setFlag` telemetry is a no-op without `POSTHOG_API_KEY`/Sentry DSN. No existing test, endpoint, or behaviour changed.

**Gates (all green pre-push):**

- typecheck — 5 workspaces clean.
- lint — `max-warnings=0` clean.
- prettier `format:check` — clean (the one pre-existing `apps/mobile/expo-env.d.ts` warning is unrelated to this work).
- domain-logic purity — 46 files scanned, pass.
- domain-logic `test:coverage` — 355 tests pass, per-file ratchets hold, `feature-rollout` at 100%.
- server unit — `rollout.test.ts` 4/4 + `idempotency.test.ts` 6/6.
- integration — `config.test.ts` 7/7, `maintenance-mode.test.ts` 4/4 (off→through, on→503, `/health` + `/admin` exemptions), `admin-flags.test.ts` 6/6 (setFlag telemetry path), `chat.test.ts` 10/10 (retrofit regression check).

**What's NOT done (CC.12 follow-ups):**

- **CC.12.7 #2 — mobile navigation wiring.** The store + selector are built and typecheck/lint clean, but *consuming* them to gate navigation + screen registration lands with the Feature A mobile slice (Section M.1). The store also has no unit test — mobile vitest/RNTL infra is not set up yet; it gets stood up with the Feature A mobile work.
- **CC.12.7 #3** — per-`NODE_ENV` flag-key namespacing.
- **CC.12.7 #4** — read-only flag dashboard / checked-in `scripts/flags.sh`.
- **CC.12.7 #5** — staging environment (infra, out of code scope).

---

## 2026-05-19 — Plan addition: CC.12 Feature Rollout & Targeting System

**Type:** plan-only (no code). New section `CC.12 — Feature Rollout & Targeting System` added to `phase3.md` between `CC.11` and `Section M`.

**Why:** the current flag service is global-boolean only — a feature is on for everyone or no one. CC.12 specifies a backward-compatible **targeting layer** (cohort allowlist + deterministic percentage bucket + global) so a Phase 3 feature can go live for a limited cohort first and roll back per-user without a redeploy. Specifies: the targeting flag-value shapes (CC.12.1), a pure `evaluateRollout` resolver (CC.12.2, 100%-coverage domain module), the `isFeatureEnabled` server helper (CC.12.3), a `GET /api/v1/config/features` mobile endpoint (CC.12.4), the rollback playbook (CC.12.5), flag-change observability (CC.12.6), gap list incl. maintenance-mode middleware (CC.12.7), and sequencing (CC.12.8 — lands when AI Chat hits its 10-user cohort).

**Backward-compat guarantee recorded in CC.12.0:** purely additive. `getFlag`/`setFlag`/`/admin/flags` unchanged; plain boolean flags keep meaning global on/off; the three live flags untouched until each deliberately opts in.

**Implementation:** deferred per the approved plan — superseded the earlier ad-hoc `ai_chat_cohort` flag idea. `Files index` updated with the four future CC.12 file paths.

---

## 2026-05-19 — Week 9 chat module: service + routes + jobs + integration tests

**PRs merged to main:**
- [#59](https://github.com/yogeshmishra667/SwasthParivar/pull/59) — foundation (schema, domain logic, idempotency helper, Claude wrapper) → squashed onto main as `d319c50`. 18/18 CI checks pass.
- [#63](https://github.com/yogeshmishra667/SwasthParivar/pull/63) — chat module (service, routes, BullMQ queue, integration tests) → squashed onto main as `3bdf739`. 18/18 CI checks pass.

**Aborted / superseded along the way:**
- #61 — stacked on the foundation branch; merging it folded chunk 3c into the foundation branch (`2c54c1b`) instead of main because GitHub didn't auto-retarget the base.
- #62 — first attempt to recover chunk 3c onto main from the foundation branch directly; landed in CONFLICTING state because the unsquashed history duplicated content already on main via #59's squash. Closed without merge.

**Resolution that worked:** new branch `phase3/chat/module-to-main` cherry-picks the 4 chunk-3c commits onto a fresh head off main → clean diff → CI green → squash-merge as #63.

**Lesson for the Phase 3 retro (CC.7 follow-up):** when stacking PR B on PR A's branch, immediately after A merges via squash, **either rebase B onto main** or **retarget B's base to main in the GitHub UI** before clicking merge. Otherwise B's merge happens against the obsolete unsquashed history and you end up cherry-picking or rebasing later.

**Gates:** all 11 preflight gates green pre-push on every commit. GitHub Actions CI green on both merged PRs (18 checks each: typecheck, lint, format, prisma format, schema↔migration parity, squawk SQL, domain-logic purity, vitest unit + integration, CodeQL, Trivy, eslint-plugin-security, GitGuardian, Danger, dependency audit, dependency review, image build + smoke, secret scan).

### Commit history on the merged branch (`phase3/chat/module-to-main`, cherry-picked)

```
c6e2aa9 test(chat): integration tests for the /api/v1/chat surface
3d8ea5a feat(chat): add CHAT_SAFETY_REVIEW BullMQ queue + worker
3567231 feat(chat): mount /api/v1/chat routes + HTTP error mapping
a05f4a3 feat(chat): chat service + types + validation + intent classifier
```

Each commit on this branch is a cherry-pick of the equivalent on the original `phase3/chat/module-and-integration` branch (`14eba02`, `bd7615a`, `4310abd`, `94153ab` respectively). Content is identical — only the parent SHAs and author dates differ.

### Commit 1 — `feat(chat): chat service + types + validation + intent classifier` (`a05f4a3`)

Implements **A.4** core orchestration + **A.7** test factories.

- `apps/server/src/modules/chat/chat.service.ts` — the 12-step orchestrator. Idempotency (via `checkIdempotent`) → flag gate (`ai_chat_enabled`) → Redis daily rate counter (free tier, `CHAT_DAILY_FREE_LIMIT=3`) → emergency check (critical_warn feedback within 30 min) → cold-start router → cost-tier router → patient context builder (SHA-256-truncated anonymizedId, coarsened age band, filtered conditions, recent readings; raw User row cannot escape past the type system) → Claude wrapper (`ai_chat_tier3_enabled` gates Sonnet so spend-cap auto-flip degrades to cached without breaking the surface) → Post-Response Safety Filter (replace + flag) → persist via `createMany`. User-turn `clientUuid` is derived via SHA-256(`user:${clientUuid}`) reshaped as a v4 UUID so the unique index never collides with the assistant row.
- `apps/server/src/modules/chat/chat.types.ts` + `chat.validation.ts` — `SendMessageInput`/`Result` shared with mobile; Zod schemas for `POST /message`, `POST /messages/:id/flag`, `GET /sessions` (max 2000 chars per turn bounds Claude prompts).
- `packages/domain-logic/src/chat-intent-classifier/` — pure keyword classifier across English / Hinglish / Devanagari. `medication_question` priority pre-empts everything else to keep dose questions off Tier 3. Default `open_ended` for unclassified input. **21 tests, locked at 100%** in `vitest.config.ts`.
- `packages/test-factories/src/chat-{session,message}.factory.ts` — `makeChatSession`, `makeChatMessage`, `makeFlaggedChatMessage` per **A.7**.

### Commit 2 — `feat(chat): mount /api/v1/chat routes + HTTP error mapping` (`3567231`)

Implements **A.3** + **CC.8** error-handler.

- `apps/server/src/modules/chat/chat.controller.ts` — four thin handlers (`postMessage`, `getSessions`, `getSessionMessages`, `postFlagMessage`). UUID path param narrowing; `req.id` narrowed without `Object.toString` risk.
- `apps/server/src/modules/chat/chat.routes.ts` — `Router` under `/api/v1/chat` with `requireAuth` + `validateBody`/`validateQuery`. `ai_chat_enabled` checked inside the service (not at the route) so `/sessions` reads survive when the send endpoint is killed.
- `apps/server/src/app.ts` — mount `chatRouter` at `/api/v1/chat`.
- `apps/server/src/shared/middleware/error-handler.ts` — map new chat error codes to HTTP: `CHAT_DISABLED` / `CIRCUIT_OPEN` / `SPEND_CAP_REACHED` → 503, `CHAT_UPSTREAM_TIMEOUT` → 504, `CHAT_SAFETY_REJECTED` → 400.

### Commit 3 — `feat(chat): add CHAT_SAFETY_REVIEW BullMQ queue + worker` (`3d8ea5a`)

Implements **A.5**.

- `apps/server/src/shared/queue.ts` — register `QUEUE_NAMES.CHAT_SAFETY_REVIEW`. Inherits the default retry policy (3 attempts, exp 5s, 1h success / 24h failure retention).
- `apps/server/src/workers/chat-safety-review.{processor,worker}.ts` — split per the critical-bypass pattern (**CC.8** audit-reuse table). The processor is idempotent: re-running on the same `messageId` is a no-op. The ChatMessage row is already persisted with `flagged=true` in the request path — the worker exists to keep PostHog + Sentry I/O off the patient response.
- `apps/server/src/modules/chat/chat.jobs.ts` — `enqueueChatSafetyReview` helper. Deterministic `jobId` (`safety-review-${messageId}`) so an in-flight retry doesn't create duplicate audit rows. Failures are logged + swallowed.
- `apps/server/src/shared/analytics/posthog.ts` — new event `ai_chat_safety_filter_rejected`.
- `apps/server/src/workers/index.ts` — register `chatSafetyReviewWorker` in the boot registry.

### Commit 4 — `test(chat): integration tests for the /api/v1/chat surface` (`c6e2aa9`)

Implements **A.8**.

- 10 Testcontainers-backed cases covering: flag gate (503 CHAT_DISABLED), idempotent replay, stale version (409 READING_STALE_VERSION), rate limit (429 CHAT_RATE_LIMITED), emergency skip, Tier 1 medication redirect, **safety filter rejection round-trip** (mocked Claude emits dosage directive → row persisted with `flagged=true` + `safetyViolations[]`), happy path Tier 3, user flag endpoint, session listing.
- `@anthropic-ai/sdk` mocked at module level — wrapper never reaches the real API.
- `beforeEach` ordering lesson: flushdb → `__resetFlagCache` → `setFlag`. Wrong order wipes the per-test flag (caught while iterating — 9/10 tests went red until the order was fixed).
- 10/10 pass in ~7.4s on Postgres + Redis Testcontainers.

### Phase 3 CC.7 traceability — applied

- ✅ **CC.7 #5** branch naming: `phase3/chat/module-and-integration`.
- ✅ **CC.7 #3** scoped Conventional Commits: every commit uses `feat(chat)` or `test(chat)`.
- ✅ **CC.7 #1** folder isolation: all server code under `apps/server/src/modules/chat/` + dedicated workers + `chat.jobs.ts`. Cross-module touches limited to the **documented exceptions** called out in the PR description: `app.ts` (route mount), `shared/queue.ts` (queue name), `shared/middleware/error-handler.ts` (status mapping), `shared/analytics/posthog.ts` (event types), `workers/index.ts` (worker registry).
- ✅ **CC.7 #11** in-code marker header on `apps/server/src/modules/chat/chat.routes.ts`, `chat.service.ts`, `chat-safety-review.processor.ts`, `chat.types.ts`.
- ⏳ **CC.7 #4** PR labels + **#6** CODEOWNERS + **#7** git tag + **#9** issue template + **#10** PR template — deferred until team-name placeholders (`@phase3-chat-team` etc.) are filled. `phase3-chat-v1` tag will be applied after the safety-reviewer agent review lands.

### What's NOT in this branch (Phase 3 Feature A follow-ups)

- Mobile work — Section **M.1** in full (ChatScreen, MessageBubble, AIDisclaimerBanner, EmergencyChatGuard, OfflineChatBanner, ChatFlagDialog, ChatFlagDialog). Server-first sequencing per phase3.md preamble.
- `CHAT_RETENTION_SWEEP` cron — Feature A.10 (90-day archive + 1-year hard delete) deferred to a chat retention follow-up PR.
- `.github/labeler.yml`, `.github/CODEOWNERS`, `.github/ISSUE_TEMPLATE/phase3-bug.md`, PR template extensions, dangerfile.ts — separate `chore(phase3)` PR once team names are fixed.

### Coverage after this session

| Metric | Domain-logic aggregate |
|---|---|
| Statements | 96.10% → unchanged (chat-intent-classifier 100%) |
| Branches | 91.48% → unchanged |
| Functions | 96.89% → 96.94% (4 new functions all covered) |
| Lines | 97.49% → 97.51% |

All five chat-* modules at **100%** on every metric.

### Endpoint surface live on `main`

```
POST /api/v1/chat/message                       (send a turn — flag-gated)
GET  /api/v1/chat/sessions                      (list patient's recent sessions)
GET  /api/v1/chat/sessions/:sessionId/messages  (full thread)
POST /api/v1/chat/messages/:messageId/flag      (🚩 button)
```

The endpoints are deployed but `ai_chat_enabled` remains **false** by default. Internal-cohort rollout per phase3.md M.7 row 1 (week 9): set `ai_chat_enabled=true` for 10 users, ramp doubling every 48h.

---

## 2026-05-19 — Week 9 server foundation: schema + domain logic + Claude wrapper

**Branch:** `phase3/chat/safety-and-routing-foundation` (off `main`, 4 commits, not yet merged — PR pending).

**Gates:** all 11 preflight gates green on every commit — typecheck (5 workspaces), lint (`max-warnings=0`), prettier `format:check`, prisma schema format, schema↔migration parity, squawk SQL lint (**0 issues** on the new migration), domain-logic purity (`scripts/check-domain-purity.mjs`), per-file coverage ratchets.

### Commit 1 — `feat(chat): add ChatSession + ChatMessage schema (Phase 3 step A.1)` (`91a40b9`)

Implements **A.1**. Additive — no existing tables modified.

- Models: `ChatSession`, `ChatMessage`. Enums: `ChatRole`, `ChatCostTier`. Indexes cover the safety-review queue (`flagged, created_at`), per-session ordering, and the per-user feed.
- Migration: `apps/server/prisma/migrations/20260518000000_chat_messages/migration.sql`. Squawk-clean.
- Retention plumbing (`archived_at`, `onDelete: Cascade`) ready for the `CHAT_RETENTION_SWEEP` cron and the user-delete cascade — CC.11 §5.

### Commit 2 — `feat(chat): add safety filter, cost router, cold-start, templates` (`ac1bd5b`)

Implements **A.2 #1–#4** (all four pure-domain chat modules) and the **shared chat type vocabulary**. Every module ships at **100% lines / branches / functions / statements** with per-file ratchets locked in `vitest.config.ts`.

- `packages/domain-logic/src/chat-safety-filter/` — Post-Response Safety Filter. 6 violation banks (`dosage_number`, `start_stop_directive`, `dose_change`, `diagnosis_claim`, `emergency_advice`, `verbatim_pii`) across English, Hinglish, Devanagari. **60 test cases**, including property tests over digit+medicine-unit and Hinglish count+noun adversarial input. Locked at **100% branches** in `vitest.config.ts` alongside `critical-bypass` — see **A.9**.
- `packages/domain-logic/src/chat-cost-router/` — `pickCostTier` priority chain (medication → cached → cold-start/sparse → deterministic-intent → reasoning). Implements **A.2 #2**. Includes a 100-request distribution sanity test that fails loudly if the chain drifts to >80% in any bucket.
- `packages/domain-logic/src/chat-cold-start/` — `coldStartResponse` day 1-14 stage buckets (1-3 / 4-6 / 7 / 8-14) × condition × language. Defers to `lookupTemplate` for data-independent intents so copy stays single-sourced. Implements **A.2 #3**.
- `packages/domain-logic/src/chat-template-responses/` — Tier 1 lookup table keyed `intent:condition:language`. `medication_question` pre-empts the table with `MEDICATION_REDIRECT`, pinned **equal** to `SAFETY_REPLACEMENT` so pre-routing redirect and post-response filter produce identical patient-facing copy. Implements **A.2 #4**.
- `packages/shared-types/src/chat.ts` — `ChatRole`, `ChatCostTier`, `ChatLanguage`, `ChatIntent`, `ChatCondition` unions. Mirrors the Prisma enums — keep in lockstep (migration linter fires on drift).

Coverage delta on `packages/domain-logic` aggregate: 95.91% → **96.10% statements**, 90.98% → **91.48% branches**. No regression on existing modules.

### Commit 3 — `chore(phase3): extract clientUuid idempotency helper` (`929d633`)

Implements **CC.2** (cross-cutting). One of the two acknowledged "Phase 3 cross-module touches" called out in **CC.7 #1**.

- New helper: `apps/server/src/shared/idempotency.ts`. Discriminated outcome `{ kind: "insert" | "replay" | "update" | "stale" }`. P2002 race recovery stays at the call site because each model's composite key shape differs.
- `apps/server/src/modules/readings/readings.service.ts` refactored to use `checkIdempotent`. `buildReplayResult` unchanged.
- 6 unit tests pin every branch + an offline-retry regression case (`version 1` arriving after `version 2`).
- All **65 readings integration tests** still pass (49s) — confirms zero behaviour regression end-to-end.

### Commit 4 — `feat(chat): add Claude API wrapper with circuit + spend cap` (`e9945e4`)

Implements **A.3** + **A.6** + **CC.1** + **CC.11 §4 §6**. The Claude wrapper.

- `apps/server/src/shared/ai/claude.ts` — wraps `@anthropic-ai/sdk`. The SDK handles 429/5xx retry+backoff out of the box (default `max_retries=2`); we do not reimplement.
- **12-second hard timeout** via `AbortController` (env `CHAT_HARD_TIMEOUT_MS`). Aborts → `CHAT_UPSTREAM_TIMEOUT`.
- **Prompt caching**: stable system prompt first, volatile `PatientContext` block second with `cache_control: { type: "ephemeral" }`. Layout follows the prefix-match invariant in the `claude-api` skill's `prompt-caching.md`.
- **Redis-backed circuit breaker**: keys `ai_circuit:fail_count:${NODE_ENV}` + `ai_circuit:open_until:${NODE_ENV}`. 5 consecutive failures in a 60s window open the breaker for 5 min; first success closes it. Throws `CHAT_CIRCUIT_OPEN` while open — caller falls back to Tier 1.
- **Daily spend cap** in Redis (`ai_spend:YYYY-MM-DD`, integer cents to avoid FP drift). Exceeding `CLAUDE_DAILY_SPEND_CAP_USD` auto-flips `ai_chat_tier3_enabled=false` via the flag service and pages Sentry. **CC.11 §6**. Pricing tracked inline for `claude-haiku-4-5` ($1.00 / $5.00 per 1M) and `claude-sonnet-4-6` ($3.00 / $15.00 per 1M) — re-verify against `shared/models.md` before bumping.
- **`PatientContext` PII guard** — the wrapper accepts a `PatientContext` interface only. The type system **forbids** passing a raw `User` row: `anonymizedId`, `ageRange` (coarsened), `conditions`, `recentReadings`, `language`, `condition`. Phone, aadhaar, household_id, guardian names cannot appear. **CC.11 §4**, compile-time enforced.
- New env vars (`apps/server/src/config/env.ts`): `CLAUDE_MODEL_HAIKU`, `CLAUDE_MODEL_SONNET`, `CHAT_DAILY_FREE_LIMIT`, `CHAT_HARD_TIMEOUT_MS`, `CLAUDE_DAILY_SPEND_CAP_USD` — defaults from **A.6**.
- New PostHog events (in `shared/analytics/posthog.ts` `EventPropsMap`): `ai_chat_response_generated`, `ai_chat_circuit_opened`, `ai_chat_spend_cap_reached`. Match the per-feature event list in **A.4 / CC.4**.
- New `ErrorCode` entries (in `packages/shared-types/src/api.ts`): `CHAT_DISABLED`, `CHAT_SAFETY_REJECTED`, `CHAT_CIRCUIT_OPEN`, `CHAT_UPSTREAM_TIMEOUT`, `CHAT_SPEND_CAP_REACHED`. Wired into the envelope per **CC.8** error-handler section.
- 18 unit tests cover: model selection (haiku/sonnet), `cache_control` placement, anonymized metadata, breaker open + auto-close, hard timeout abort, spend-cap flag flip, `DomainError` when `CLAUDE_API_KEY` unset.

### Phase 3 CC.7 traceability — partial application

- ✅ **CC.7 #5** branch naming: `phase3/chat/safety-and-routing-foundation`.
- ✅ **CC.7 #3** scoped Conventional Commits: every commit on the branch uses `feat(chat)` or `chore(phase3)`.
- ✅ **CC.7 #1** folder isolation: all new code in `packages/domain-logic/src/chat-*`, `packages/shared-types/src/chat.ts`, `apps/server/src/shared/ai/`, `apps/server/src/shared/idempotency.ts`. One cross-module touch — `apps/server/src/modules/readings/readings.service.ts` (idempotency helper refactor) — called out in commit message per the rule.
- ⏳ **CC.7 #11** in-code marker header — currently lives on `apps/server/src/shared/ai/claude.ts` as the de-facto entry file. Will move/duplicate onto `modules/chat/chat.routes.ts` when that file lands in chunk 3c.
- ⏳ **CC.7 #4** PR labels + **#6** CODEOWNERS + **#9** issue template + **#10** PR template + **#7** git tag — deferred until the first Phase 3 PR opens (`phase3-chat-v1` tag will be applied at chunk 3c merge).

### Audit-era reuse (CC.8)

Concretely exercised in this session: Pino logger PII redaction, Sentry breadcrumbs, PostHog client, flag service (for spend-cap auto-flip), the readings critical-bypass split pattern (referenced design), validation middleware (not yet touched — chunk 3c), `requestId` middleware (threaded through wrapper input), `vitest.config.ts` per-file coverage ratchets, domain-logic purity tsconfig path block + grep gate, pre-push `preflight.sh`, scaffold scripts (not yet — chunk 3c will use `pnpm new-module chat`), CodeQL/Trivy/eslint-plugin-security/SBOM (CI-side; will fire on the PR).

### What's NOT yet in this branch (next chunk 3c)

- `apps/server/src/modules/chat/` — controller / service / routes / validation / types / jobs / chat-flag.controller.
- BullMQ queue `CHAT_SAFETY_REVIEW` + processor + worker (per **A.5**).
- Flag keys `ai_chat_enabled`, `ai_chat_tier3_enabled` (added at first use per the "no preemptive flag keys" rule).
- Route registration + middleware wiring in `apps/server/src/app.ts`.
- Integration tests: `apps/server/tests/integration/chat.test.ts` (per **A.8**) — Testcontainers Postgres + Redis, MSW-mocked Claude.
- Test factories: `packages/test-factories/src/chat-session.factory.ts`, `chat-message.factory.ts` (per **A.7**).
- Mobile work — Section **M.1** in its entirety. Server-first sequencing.

### Gates passing

```
1/11 wipe build artefacts (dist + tsbuildinfo)
2/11 frozen pnpm install (matches CI exactly)
3/11 workspace typecheck (5 projects)
4/11 workspace lint (max-warnings=0)
5/11 prettier format:check
6/11 prisma schema format
7/11 schema ↔ migration parity (chat_messages migration paired)
8/11 migration lint (squawk) — Found 0 issues in 1 file 🎉
9/11 domain-logic purity (42 files scanned)
10/11 domain-logic test:coverage (per-file ratchets enforced)
11/11 — (with --with-docker / --with-integration when needed)
```

Aggregate domain-logic coverage after this session:

| Metric | Value |
|---|---|
| Statements | 96.10% (864/899) |
| Branches | 91.48% (494/540) |
| Functions | 96.89% (125/129) |
| Lines | 97.49% (740/759) |

Chat-module-specific (all four directories at 100% on every metric — verified via per-file HTML report at `packages/domain-logic/coverage/<module>/index.html`):

| Module | Stmts | Branches | Funcs | Lines |
|---|---|---|---|---|
| `chat-safety-filter` | 35/35 | 8/8 | 9/9 | 31/31 |
| `chat-cost-router` | 100% | 100% | 100% | 100% |
| `chat-template-responses` | 100% | 100% | 100% | 100% |
| `chat-cold-start` | 100% | 100% | 100% | 100% |
