# Audit Progress

> Source plan: `~/.claude/plans/flickering-wiggling-sundae.md`
> Last updated: 2026-05-14 (all Immediate items 1–5 done)
> Current session focus: Done with Immediate bucket; pause for review before Short term (items 6–13)

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

- [ ] 6. **[P1]** PostHog server emitter: `critical_bypass_triggered`, `reading_logged`, `voice_attempt`, `notification_sent`, `streak_milestone`, `medicine_taken/missed`, `profile_switched`, `critical_alert_*` (Patch #22 events) — CLAUDE.md Metrics section is explicit Phase 1
- [ ] 7. **[X-cut]** `apps/server/Dockerfile` (multi-stage, non-root, healthcheck) + `.dockerignore` + CI image-build + container smoke against `/health`
- [ ] 8. **[X-cut]** `.github/dependabot.yml` (weekly, grouped) + monthly `pnpm audit --audit-level=moderate` issue-opener job
- [ ] 9. **[X-cut]** `dangerfile.ts` with rules: test-parity for `packages/domain-logic/src/**`, migration-parity for schema changes, large-PR explainer >500 LoC
- [ ] 10. **[X-cut]** `squawk` migration linter in CI on `apps/server/prisma/migrations/**/migration.sql`
- [ ] 11. **[P1]** Mobile: `eas.json`, `@sentry/react-native`, top-level `ErrorBoundary` in `app/_layout.tsx` with Hindi recovery copy
- [ ] 12. **[X-cut]** `requestId` propagation through BullMQ payload + child logger in workers (`logger.child({ requestId, jobId })`)
- [ ] 13. **[X-cut]** Redis-backed flag service (`apps/server/src/shared/flags/`): generic `get/set` + 30s in-process cache. Admin route gated by `JWT_ADMIN_SECRET`. Audit log on every set. Flag _keys_ added on-demand. **Never flagged:** critical-bypass thresholds, chain ordering, parallel execution.

## Long term (1–2 months)

- [ ] 14. **[P1]** Full critical-bypass integration test (real BullMQ + Testcontainers Redis + mocked push provider)
- [ ] 15. **[X-cut]** `docs/runbooks/rollback.md` + quarterly DR restore drill log
- [ ] 16. **[X-cut]** Project references (`composite: true`) on `packages/*` for incremental typecheck
- [ ] 17. **[X-cut]** Extract `@swasth/tsconfig`, `@swasth/eslint-config`, `@swasth/observability`, `@swasth/env`, `@swasth/health` packages
- [ ] 18. **[X-cut]** Reusable GitHub Actions: `reusable-node-quality.yml`, `reusable-migration-parity.yml`, `reusable-domain-purity.yml`, `reusable-cve-gate.yml`
- [ ] 19. **[X-cut]** Plop / shell scaffold: `pnpm new-module`, `pnpm new-detector`, `pnpm new-migration`

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
