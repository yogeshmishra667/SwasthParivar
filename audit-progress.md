# Audit Progress

> Source plan: `~/.claude/plans/flickering-wiggling-sundae.md`
> Last updated: 2026-10-25 (phase-audit fix wave: P1, P6, D1 merged; P5 #202 and P10 #203 queued; P4 on branch `feat/bp-critical-bypass`)
> Current session focus: Working through `phase-audit.md` in its §7 order, safety items first. Each fix gets its own PR, a `safety-reviewer` pass and a sabotage-checked test. **Resume at "Phase-audit fix wave" below.**

## Status Legend

- [ ] not started
- [~] in progress (note WIP commit / branch)
- [x] done (note commit hash)
- [!] blocked (note reason)

## Immediate (this week)

- [x] 1. **[X-cut]** Fix `typescript: ^6.0.2` → `~5.9.3` in root `package.json` (note: TS 6.0.2 _does_ exist — real issue was version drift with mobile pinned to 5.9.3; aligned root/server down to match mobile to avoid Expo type drift). Verified: `pnpm typecheck` green across all 5 workspaces.
- [x] 2. **[X-cut]** Wire `Sentry.init()` in `apps/server/src/index.ts` (first import, before any other module). Added `apps/server/src/shared/observability/sentry.ts` (no-op when `SENTRY_DSN` missing, scrubs auth/cookie headers, warns on prod misconfig). Tapped `errorHandler` 500-path + `unhandledRejection` + `uncaughtException` with `captureUnhandled`. Verified: server typecheck + lint pass.
- [x] 3. **[P1]** Per-file coverage thresholds in `packages/domain-logic/vitest.config.ts`. `critical-bypass/**` locked at 100% (already there). Other files set to ratchet floors at their _current_ measured values (preventing regression without forcing test-writing in this PR). Closing the gap to CLAUDE.md targets is queued as `chore/coverage-ratchet`. Verified: `pnpm --filter @swasth/domain-logic test:coverage` passes with zero violations.
- [x] 4. **[P1]** `client_uuid` idempotency. Audit was partly wrong — service had a `findFirst(clientUuid)` lookup but treated `version == stored` as `STALE_VERSION (409)`, breaking network-retry safety. Fix: equal-version is now a replay (200, returns existing row, no side effects); strictly older is still 409. Also added P2002 race-handler around the parallel-create path. Added 2 integration tests (replay + edit). `pnpm --filter @swasth/server test:integration` → 37/37 pass.
- [x] 5. **[X-cut]** Promoted `SENTRY_DSN` + `POSTHOG_API_KEY` to required when `NODE_ENV=production` via post-parse guard in `env.ts` (fatal exit with explicit error message). Dev/test runs unaffected. Verified: full workspace `typecheck` + `lint` + `purity` all green.

## Short term (2–4 weeks)

- [x] 6. **[P1]** PostHog server emitter wired (`apps/server/src/shared/analytics/posthog.ts`). Pinned `posthog-node@~5.20.0` (newer versions require Node 22.22+; local is 22.18). 5 events emitting: `reading_logged`, `streak_milestone`, `voice_attempt` (success + rejected paths), `critical_bypass_triggered` (from worker), `notification_sent` (suppressed + sent). Strongly-typed `EventPropsMap`. No-op when key missing. Shutdown wired into graceful shutdown.
- [x] 7. **[X-cut]** `apps/server/Dockerfile` (3-stage: deps → build → runtime). Node 22.18 base, runs as `node` user, HEALTHCHECK against `/health` baked in. Root `.dockerignore` keeps the build context lean (mobile excluded except its `package.json` so pnpm install resolves). CI `image-smoke` job builds the image (Buildx + GHA cache), boots it with stub env, polls `/health` for 30s. Local docker daemon was down so CI will be the first real exercise.
- [x] 8. **[X-cut]** `.github/dependabot.yml` (weekly, grouped npm + github-actions, ignores major bumps) + `.github/workflows/audit-moderate.yml` (monthly issue-opener on last-day-of-month, refreshes existing tracking issue rather than spamming). Also fixed root `lint-staged` to run prettier on `.ts/.tsx` (was eslint-only, causing format drift after commits).
- [ ] 9. **[X-cut]** `dangerfile.ts` with rules: test-parity for `packages/domain-logic/src/**`, migration-parity for schema changes, large-PR explainer >500 LoC
- [x] 10. **[X-cut]** `squawk` migration linter added to CI as a new `migration-lint` job (only fires on PRs that add a new `migration.sql`). Excludes `prefer-text-field` + `require-concurrent-index-creation` rules. Filenames flow through env + quoted shell access.
- [x] 11. **[P1]** Mobile Sentry + ErrorBoundary + EAS. `@sentry/react-native@^8.11` installed; `src/services/sentry.ts` resolves DSN from `EXPO_PUBLIC_SENTRY_DSN` or `app.json.extra.sentryDsn`; scrubs auth/cookie + query strings. New `src/components/shared/ErrorBoundary.tsx` wraps the root layout — Hindi recovery copy ("Kuch gadbad hui — App phir se kholein"), 48dp button, sends `componentStack` + boundary tag to Sentry. `eas.json` with development / preview / production profiles.
- [x] 12. **[X-cut]** `requestId` propagation through BullMQ. `CriticalAlertJob` gets optional `requestId`; controller passes `req.requestId` → service → queue payload; worker derives `logger.child({ queue, jobId, requestId })`. Cron-only workers (notification-trigger, grace-reset, med-reminder) keep module logger.
- [x] 13. **[X-cut]** Flag service in `apps/server/src/shared/flags/` — `getFlag/getFlagOrNull/setFlag/listFlags/getAudit` + 30s in-process cache + Redis pubsub cross-invalidation + capped audit log (100 entries per key). Admin module under `/admin/flags` (`adminAuth` middleware = constant-time bearer check against `ADMIN_API_TOKEN`; required in production). Integration tests: missing token 403, wrong token 403, PUT→GET→audit roundtrip with `X-Admin-Actor`, boolean/object values, invalid-key 400, default fallback. Critical-bypass thresholds + chain stay hardcoded.

## Long term (1–2 months)

- [x] 14. **[P1]** Critical-bypass full-chain integration test. New file `critical-bypass-chain.test.ts` with 5 cases: push-succeeds-no-SMS, push-fails-SMS-fallback, requestId propagation, normal-range-no-enqueue, 65/64 threshold boundary. To make it work I split the worker into `critical-alert.processor.ts` (pure function, importable for tests) + `critical-alert.worker.ts` (createWorker side effect, for production). Test uses `vi.hoisted` for the spy instances + `vi.mock` for expo-push/msg91-sms. All 8 integration test files / 48 tests pass.
- [x] 15. **[X-cut]** `docs/runbooks/rollback.md`. Five sections (image revert / migration revert / provider kill switch / PITR / full-stack outage) — each with trigger, steps, safety asserts. Quarterly DR drill checklist with a drill log table. RTO 30min / RPO 5min targets called out as aspirational until first rehearsal.
- [x] 16. **[X-cut]** Project references on `packages/*`. Composite + `tsBuildInfoFile` added to `packages/{shared-types,domain-logic,test-factories}/tsconfig.json`. `apps/server/tsconfig{.json,.build.json}` get `references` arrays. Root `tsconfig.json` converted to solution-style (`files: []` + references). `pnpm build` still works; `tsc -b` from root incremental-rebuilds in 0.18s. Mobile stays independent (Expo base is opinionated; composite mode would force changes without ROI).
- [!] 17. **DEFERRED** Extract `@swasth/{tsconfig,eslint-config,observability,env,health}` reusable packages. **Reason**: this audit's own roadmap said "only worth doing once a second repo will consume them"; there is currently only one repo. Premature extraction is on the audit's own overengineering-warnings list. Revisit when a second repo (admin web, doctor dashboard, partner integration) exists.
- [!] 18. **DEFERRED** Reusable GitHub Actions. **Reason**: same as 17 — there's no second repo to call a reusable workflow. The current `.github/workflows/ci.yml` is already well-organised and could become a reusable-workflow caller with minimal churn the moment a second repo lands. Revisit alongside item 17.
- [x] 19. **[X-cut]** Scaffold scripts under `scripts/scaffold/` + root `pnpm` aliases: `new-module`, `new-detector`, `new-migration`. Slug-validated, idempotent (refuses to clobber), prints next-step checklist. Portable for macOS bash 3.2 (no `${X^}` parameter expansion).

## Deferred — added when their phase begins

- **[P2]** Detox mobile E2E smoke (per CLAUDE.md; lasts to P3 SOS timer assertions). Maestro is a fallback only.
- **[P2]** BP endpoint integration tests, detector coverage thresholds for spike/trend (≥90%)
- **[P2]** Dashboard Hindi summary copy review
- **[P3]** AI chat post-response safety filter test suite. SOS escalation chain integration test.
- **Future-web** Playwright — add when first web surface ships (admin panel for flag service, doctor dashboard, guardian web).
- **[P4+]** Per-user (JWT sub) rate limiting + OTP exponential backoff (revisit at DAU > 1k or first abuse)
- **[P4+]** Zod→OpenAPI contract generation (revisit when a second client appears)
- **[P4+]** Prescription OCR confidence-gated approval flow tests

(Flag _keys_ — detector toggles, AI chat kill switch, SOS test mode — are added to the flag service from item 13 whenever the need is real, not on a phase schedule.)

## Phase-audit fix wave (from `phase-audit.md`, started 2026-10-20)

Each item gets its own PR based on `main`, a `safety-reviewer` pass (re-run until PASS), and tests that fail with the fix removed.

- [x] **P1** per-contact SMS — #198 (`9bbf95c`)
- [x] **P6** prescription approval authority frozen — #200
- [x] **D1** SMS success-rate denominator — #201 (`010a96b`)
- [x] Pin third-party GitHub Actions to SHAs — #199. This unblocked #85 and #86; Dependabot should auto-close them.
- [~] **P5** durable critical-alert hand-off — #202. Safety review PASS. In the merge queue.
- [~] **P10** Android notification channels — #203. In the merge queue. Confirm on a device afterwards.
- [~] **P4** BP critical bypass — branch `feat/bp-critical-bypass`, built on #202's branch. **Do not open its PR until #202 is in main**: rebase onto main first. All code and tests are done (local gate + safety review were running at hand-off). That covers shared-types thresholds, the domain-logic classifier, planner copy keys, `bp.service` (checkIdempotent, plan before save, hand-off, replay), processor routing, hi/en copy and the app's fullscreen alert.
- [ ] **P2** the critical alert's Call button dials 112, not the priority-1 contact, and there's no 60-second auto-dial. App side; the decision is in `phase-audit.md` §8.6.1 (recommended: priority-1 contact, with 112 as the second button).
- [ ] **P3** no fullscreen alert for a critical first reading (onboarding), for cardiac/respiratory, or on push receipt. App side.
- [ ] **D3** cohort flags read as booleans: switch per-user features to `isFeatureEnabled(key, userId)`. SOS parts are safety-critical.
- [ ] **D8** exempt SOS routes and signed provider webhooks from maintenance mode, and add warning text to the toggle. Safety-critical.
- [ ] **P11** anti-fatigue counters never update and there is no daily cap. Urgent once P10 ships, because reminders will start arriving.
- [ ] **P22** redact the top-level `phone` in `msg91-sms.ts` logs.
- [ ] Remaining items in the `phase-audit.md` §7 order.
- [ ] Safety-review follow-ups listed in `phase-audit.md` §0.

Open repo housekeeping:

- Dependabot PRs:
  - #194 (prod-patches) and #196 (vite) touch the lockfile. Use `@dependabot rebase`; never `update-branch`.
  - #195 (dev-minors) needs three fixes re-applied right before merge: pin the prisma CLI to `7.8.0`, run `pnpm format` (Prettier 3.9), and add the cardiac-voice coverage test ("thakaan hai, dhadkan 95").
  - #48 (express-rate-limit) is DIRTY.
- Decisions waiting on the owner:
  - Orphaned PR #97 (household tier, 24 files): rescue or drop.
  - DigitalOcean runbook plus `docker-compose.prod.yml` (`a10f2a9`): rescue or drop.
  - Dismiss the accepted Dependabot alerts (node-forge, image-size ×2)?
  - `IF NOT EXISTS` in `20261020000000_reconcile_schema_drift`?
  - Chrome in the server image (PDFs need puppeteer).
- The repo was made **public** on 2026-10-25 after Actions billing blocked CI. The exposure check was clean: only `.env.example` placeholders, no `pull_request_target` workflows, only `GITHUB_TOKEN`, and gitleaks found 0 issues across full history.

## Resume Protocol

1. Read this file first; do not re-explore.
2. Re-read `~/.claude/plans/flickering-wiggling-sundae.md` only if an item is unclear.
3. Pick the first `[ ]` (or resume the `[~]`) in the highest-priority bucket.
4. Update `Last updated` and `Current session focus` before starting.
5. Mark `[~]` on start, `[x]` with commit hash on finish.
6. If blocked, write `[!]` with reason and move on.

## Session Log

- 2026-05-14: session start · created audit-progress.md · beginning item 1 (TS version fix)
- 2026-05-14: item 1 done — TS aligned to ~5.9.3 across workspace (audit claim revised: TS 6.0.2 exists, real issue was drift). `pnpm typecheck` green. Files: `package.json`, `pnpm-lock.yaml`. Next: item 2.
- 2026-05-14: item 2 done — Sentry server-side init wired. Added `@sentry/node@^10.53.1` to `apps/server` deps. New file `apps/server/src/shared/observability/sentry.ts`. Wired in `index.ts` (first import) + error handler + `unhandledRejection`/`uncaughtException`. Server typecheck + lint green. Next: item 3 (coverage thresholds).
- 2026-05-14: item 3 done — per-file coverage thresholds. `critical-bypass/**` locked at 100% (already meets CLAUDE.md target). Other files (detectors, voice-parser, feedback-engine, notification-resolver, streak-engine) ratcheted at current measured values; closing the gap to CLAUDE.md targets is a follow-up. Coverage run passes; no violations. Next: item 4 (client_uuid idempotency).
- 2026-05-14: item 4 done — idempotency fix in `readings.service.ts`. Equal-version POST replay returns existing row + reconstructed response with NO side effects (no streak/feedback re-write, no critical-alert re-enqueue). Strictly older version still 409 STALE. Added P2002 catch around parallel create (race → refetch + replay). 2 new integration tests; all 37 server integration tests pass. Files: `readings.service.ts`, `readings.test.ts`. Next: item 5.
- 2026-05-14: item 5 done — `SENTRY_DSN` + `POSTHOG_API_KEY` now fatally required when `NODE_ENV=production` (post-parse guard prints which keys are missing and exits 1). Dev/test unaffected. Full workspace typecheck + lint + purity green. **Immediate bucket complete (5/5).**
- 2026-05-14: bundled commit `43f84f8` "chore(audit): immediate bucket — Sentry, idempotency, TS pin, coverage, env guard" landed on `chore/quality-gate-hardening`. 12 files, +389/-37. Next: Short term bucket (items 6–13).
- 2026-05-14: bundled commit `497bca4` "chore(audit): short-term batch 1 — PostHog, requestId, dependabot, squawk, danger" — items 6, 8, 9, 10, 12. 15 files, +573/-13. Remaining short-term: 7 (Dockerfile), 11 (mobile Sentry + EAS + ErrorBoundary), 13 (flag service) — each ~2h. Natural pause for review.
- 2026-05-14: short-term batch 2 (items 7, 11, 13). New files: `apps/server/Dockerfile`, `.dockerignore`, `apps/mobile/eas.json`, `apps/mobile/src/services/sentry.ts`, `apps/mobile/src/components/shared/ErrorBoundary.tsx`, `apps/server/src/shared/flags/{flags,index}.ts`, `apps/server/src/shared/middleware/admin-auth.ts`, `apps/server/src/modules/admin/{admin.routes,flags.controller,flags.validation}.ts`, integration test for admin flags. ci.yml gets an `image-smoke` job. Workspace typecheck + lint + format all green. **Short term bucket complete (8/8).**
- 2026-05-14: long-term bucket (items 14, 15, 16, 19). Critical-bypass full-chain integration test with 5 cases (push-OK/SMS-skip, push-fail/SMS-fallback, requestId propagation, normal-range no-enqueue, 65/64 threshold boundary) — required splitting `critical-alert.worker.ts` into a side-effect-free `.processor.ts` + the thin worker binding. Project references on `packages/*` (incremental `tsc -b` no-op rebuild 0.18s; per-package typecheck flow unchanged). `docs/runbooks/rollback.md` with 5 sections + quarterly DR drill checklist. Scaffold scripts (`pnpm new-module / new-detector / new-migration`). **Items 17 + 18 explicitly DEFERRED** — extracting reusable packages and workflows would be premature with only one consumer repo (audit's own overengineering-warning). 8/8 server integration tests, 48/48 cases green.
- 2026-05-14: Docker smoke caught a real bug — packages had `main: "./src/index.ts"`, fine for tsx/Vitest but Node-in-the-image can't load .ts files. Commit `fe251e9` fixes: `main` + `exports.import` now point at `./dist/index.js`, `types` stays at `./src/index.ts` so a fresh checkout still typechecks. Vitest configs get explicit aliases so tests use source. **Verified end-to-end**: image builds, container boots, `/health` returns 200 with stub env; 48/48 integration tests still pass.

- 2026-05-16: Phase 2 step 7 shipped — guardian read-only view. PR #38. `FamilyLink` Prisma model + new enums (`FamilyLinkStatus`, `FamilyAlertSensitivity`). Migration `20260516000000_family_links`. New module `apps/server/src/modules/family/` (5 endpoints: invite, respond, privacy/revoke, list, dashboard). The dashboard endpoint REUSES `buildDashboard` from step 6 with explicit PII stripping (`notes`, med `photoUrl`/`timeSlots`/`quantityRemaining` dropped; patient `phone` never in payload). 15-case integration suite covers happy path + double-invite/self-invite rejection + dashboard 403 before accept + accept/decline + visibility filter + patient-only privacy edits + either-side revoke + re-invite after revoke. **No alerts endpoint yet** — Phase 2 scope is read-only-view only; alerts land in Phase 3 reusing the same row (no migration needed). Merged commit `878667b` → `d037658`.

- 2026-05-16: CI hardening — PR #39. Audit goal: collapse the gap between local hooks and CI so failures land at development time, not on PR. Two themes from recent CI red-runs traced 100% to gates that only existed server-side:
  - **Tier A — dev-loop gaps**: 3 new shared shell scripts (`check-prisma-format.sh`, `check-migration-parity.sh` — _semantic_ via `prisma migrate diff`, `lint-migrations.sh`). Both `preflight.sh` and `ci.yml` shell out to the SAME scripts; squawk exclude list now lives in one place (was duplicated). `.lintstagedrc.cjs` auto-`prisma format`'s schema on commit. `CONTRIBUTING.md` gate map rewritten — the old "pre-push runs typecheck + test:unit" was 6+ weeks stale.
  - **Tier B — new security gates**: `.github/workflows/codeql.yml` (JS/TS SAST, weekly cron), `dependency-review` job (HIGH/CRITICAL CVE + GPL/AGPL/SSPL license block on PR diffs), Trivy image scan inside `image-smoke` (HIGH/CRITICAL, fixable-only), `eslint-plugin-security` with hand-picked high-signal rule subset (eval/ReDoS/timing-attack/weak-RNG/`child_process` injection/bidi).
  - **Drive-by**: the new prisma-format gate immediately caught attribute-order drift on `main`'s `schema.prisma`. Auto-formatted as part of the PR; `prisma migrate diff` confirmed no datamodel change. Mobile/server PostHog host inconsistency fixed (mobile was on legacy `app.posthog.com`, now matches server's `us.i.posthog.com` with EU override via `extra.posthogHost`).
  - Docs updated: `docs/SETUP.md` PostHog walkthrough (6 steps from sign-up to event verification + dashboard tile template), `docs/HOWTO.md` triage recipes for CodeQL / Trivy / `eslint-plugin-security` failures + local-dev PostHog setup, `docs/ARCHITECTURE.md` gate table now reflects all CI jobs and adds a "fourth observability layer" section for code-security tooling. PR commit `aa92fb2`.

- 2026-05-16: Supply-chain transparency tier added to PR #39 — SBOM (`.github/workflows/sbom.yml`, Syft generates CycloneDX + SPDX from BOTH the pnpm lockfile AND the built Docker image, attached to releases on `v*` tag) + OpenSSF Scorecard (`.github/workflows/scorecard.yml`, weekly cron + push to main, SARIF to Security tab, public score badge). Neither workflow fails the build — they're audit, not gate. Stryker / Codecov / commit-signing deliberately deferred (overengineering for one-engineer team; revisit at team ≥3 OR under SOC2 audit). `docs/ARCHITECTURE.md` gate table + new "Supply-chain transparency" section. `CONTRIBUTING.md` gate map row added.

- 2026-10-20 → 2026-10-24: CI redesign plus a dependency sweep.
  - #188: paths-filter gating, weekly full run, migration-drift and mobile checks.
  - #179 / #181: Danger removed, audit OOM fixed.
  - #184 / #189 / #190 / #197: HIGH/CRITICAL advisories cleared and a gitleaks allowlist for CI stub secrets. Dependabot alerts went from 190 to 53.
  - #185: schema/migration drift reconciled.
  - #176 / #177 / #178 / #180: flaky coverage, mobile bundle, phase audit, Expo-pinned packages.
  - Lockfile lesson: GitHub's update-branch text-merges `pnpm-lock.yaml` and can corrupt it. Lockfile PRs must be regenerated, not branch-updated.
- 2026-10-25: phase-audit fix wave.
  - **P1** (#198):
    - A push to the patient's own phone no longer suppresses SMS to emergency contacts.
    - Household-member contacts are always texted. The safety review caught that a sub-profile's seeded contact shares the patient's device.
    - The push stage can't block SMS. Expo/MSG91 requests time out at 10 s, SMS retries 3×, and on-call is paged on any undelivered SMS.
  - **P6** (#200): approval never falls back to the patient after a guardian revoke. All five write routes are gated, and the app shows "no family member linked".
  - **D1** (#201).
  - **#199**: actions pinned to SHAs.
  - **P5** (#202): reviewer verdict FAIL, then PASS, then all warnings fixed. Changes:
    - the hand-off is bounded, with an in-process fallback;
    - replays re-ensure and revive;
    - cardiac/respiratory plan before the save;
    - the escalation schedule can't re-send;
    - Redis calls on the alert path are bounded.
  - **P10** (#203): Android channels.
  - **P4**: BP critical bypass on a branch, stacked on #202.
  - Actions billing blocked CI mid-session; the owner made the repo public to restore free minutes.
  - Local gate: `scratchpad/gate.sh <worktree>`. CI-equivalent stub env: `DATABASE_URL=postgresql://stub:stub@localhost:5432/stub`. A fresh worktree needs `pnpm install` plus `pnpm --filter @swasth/server prisma:generate` (with `DATABASE_URL` set) before the pre-push preflight passes.
