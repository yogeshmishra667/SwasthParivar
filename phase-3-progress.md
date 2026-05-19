# Phase 3 — Progress Log

> Companion to: [phase3.md](./phase3.md) (the plan), `audit-progress.md` (the per-PR audit log).
>
> Per-session entries in the format Phase 2 used in `audit-progress.md`. **Newest first.** Append on every merged PR (or, for in-flight branches, every meaningful milestone). Each entry cites the relevant phase3.md section refs so the plan and the log can be cross-walked.

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
