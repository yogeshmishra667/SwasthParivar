# Setup checklist — what's still pending before production

> The audit wired the code; this file lists every thing _outside_ the
> repo that still has to be done (secrets, dashboards, branch rules,
> drills). Work through it in order — earlier items unblock later ones.

Last updated: 2026-05-14 (after the audit landed).

---

## P0 — required to deploy at all

| #   | Item                                                                       | Where           | Notes                                                                                         |
| --- | -------------------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------- |
| 1   | Generate `ADMIN_API_TOKEN` (≥32 chars)                                     | deploy host env | Guards `/admin/*` routes (flag service). Random base64: `openssl rand -base64 48`.            |
| 2   | Generate `JWT_SECRET`, `JWT_REFRESH_SECRET`, `OTP_SECRET` (each ≥32 chars) | deploy host env | All three required by `apps/server/src/config/env.ts`.                                        |
| 3   | Provision managed Postgres + Redis                                         | provider        | Free tiers fine for dev. TimescaleDB required (we use the hypertable for `glucose_readings`). |
| 4   | Set `DATABASE_URL` + `REDIS_URL`                                           | deploy host env | Fail-fast at startup if missing.                                                              |
| 5   | Run `pnpm --filter @swasth/server prisma:deploy` once                      | deploy host     | Applies the 8 committed migrations. Idempotent.                                               |

## P1 — required for the audit's observability to actually work

| #   | Item                            | Where               | Notes                                                                                                                                                                                                                                |
| --- | ------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 6   | Create Sentry project (server)  | sentry.io           | Copy DSN to `SENTRY_DSN` on the deploy host. Without this, server errors land in stdout only.                                                                                                                                        |
| 7   | Create Sentry project (mobile)  | sentry.io           | Pass DSN as `EXPO_PUBLIC_SENTRY_DSN` at EAS build time, _or_ put it under `expoConfig.extra.sentryDsn` in `app.json` (re-build needed).                                                                                              |
| 8   | Create PostHog project          | posthog.com         | Copy project API key to `POSTHOG_API_KEY` on the deploy host. Without this, all 5 audit-wired events (`reading_logged`, `streak_milestone`, `voice_attempt`, `critical_bypass_triggered`, `notification_sent`) are silently dropped. |
| 9   | Configure WhatsApp Business API | Meta business       | `WHATSAPP_BUSINESS_API_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`. Primary OTP channel.                                                                                                                                                      |
| 10  | Configure MSG91                 | msg91.com           | `MSG91_API_KEY`, `MSG91_SENDER_ID`. SMS fallback (critical-bypass step 2).                                                                                                                                                           |
| 11  | Configure Expo push             | expo.dev            | `EXPO_ACCESS_TOKEN`. Required for guardian push notifications.                                                                                                                                                                       |
| 12  | Configure Cloudflare R2         | dash.cloudflare.com | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY`, `R2_SECRET_KEY`, `R2_BUCKET`. Phase 4 (prescription photos) — defer until then.                                                                                                                    |

## P2 — repo + GitHub configuration

| #   | Item                                                | Where                             | Notes                                                                                                                                                                                                       |
| --- | --------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 13  | Enable branch protection on `main`                  | GitHub repo settings              | Require PR + at least 1 approving review (raise to 2 once a second engineer joins), require status checks `Typecheck`, `Lint`, `Build`, `Unit tests`, `Integration tests`, `Image smoke`, `Danger` to pass. |
| 14  | Add a second human to `CODEOWNERS`                  | `.github/CODEOWNERS`              | Currently lists `@yogeshmishra667` only. The "2 reviewers required for safety-critical paths" rule in `PULL_REQUEST_TEMPLATE.md` is aspirational until a second name lands here.                            |
| 15  | Configure deploy host secrets via the platform's UI | Render / Fly / k8s secret manager | Copy each env var from items 1–12. Never commit them; never put them in `app.json` for mobile except for non-secret values like Sentry DSN.                                                                 |
| 16  | Wire CI status checks into branch protection        | GitHub repo settings              | Each CI job is a status check; pick the ones from item 13 above.                                                                                                                                            |

## P3 — operational followups that can land any time

| #   | Item                                                  | Where                                         | Notes                                                                                                                                                                                                                           |
| --- | ----------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 17  | Implement the maintenance-mode middleware             | `apps/server/src/app.ts`                      | `docs/runbooks/rollback.md` Section 2 step 1 references a flag-driven 503 middleware that isn't wired yet. Reads `flag:maintenance_mode` (default `false`); when `true`, returns 503 for any non-`GET /health*` route. ~30 LOC. |
| 18  | Raise per-file coverage ratchets to CLAUDE.md targets | `packages/domain-logic/vitest.config.ts`      | Current ratchets pin at _current_ measured floors (e.g. `streak-engine` 88/83). CLAUDE.md targets 100. Write the missing tests, then bump the thresholds. Branch suggestion: `chore/coverage-ratchet`.                          |
| 19  | Run the first DR drill                                | manual                                        | `docs/runbooks/rollback.md` has a quarterly drill checklist with a drill-log table; first row is due now (or whenever the deploy host is live).                                                                                 |
| 20  | Decide on the mobile WIP that has been uncommitted    | `apps/mobile/{app.json, src/services/api.ts}` | Has been sitting unstaged since before the audit. Either commit, stash, or discard.                                                                                                                                             |

## P4 — nice-to-have, defer until needed

| #   | Item                                                                                  | Reason                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 21  | Extract `@swasth/{tsconfig,eslint-config,observability,env,health}` reusable packages | Audit items 17+18; deliberately deferred — only worth doing once a second consumer repo exists.                                                                                       |
| 22  | Reusable GitHub Actions                                                               | Pair with item 21.                                                                                                                                                                    |
| 23  | TypeScript project references (`composite: true`)                                     | Tried in audit item 16; reverted because it required `dist/` to exist before typecheck — wrong contract for this workspace. Re-evaluate if `pnpm typecheck` ever starts taking > 10s. |
| 24  | Detox / Maestro mobile E2E                                                            | CLAUDE.md defers to Phase 2+ explicitly.                                                                                                                                              |
| 25  | Per-user rate limit + OTP exponential backoff                                         | DAU < 1k for now; revisit at scale.                                                                                                                                                   |
| 26  | Zod → OpenAPI contract generation                                                     | Only worth it once a second client (web admin, doctor dashboard, partner) lands.                                                                                                      |

---

## How to verify the setup is complete

Run this from the deploy host (or your laptop with the prod env vars set):

```bash
# Server is reachable and healthy:
curl https://api.swasthparivar.com/health
# → {"status":"ok","time":"..."}

# Deep health (DB + Redis):
curl https://api.swasthparivar.com/health/deep
# → {"status":"ok", ...} when DB + Redis are reachable; 503 otherwise

# Admin flag service works (requires ADMIN_API_TOKEN):
curl -X PUT https://api.swasthparivar.com/admin/flags/probe_test \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -d '{"value": true}'
# → 200 with {"key":"probe_test", ...}

# Sentry: trigger a deliberate error and watch the Sentry dashboard:
curl https://api.swasthparivar.com/api/v1/admin/__crash 2>/dev/null
# (add a debug route for this in dev, remove before prod)

# PostHog: log a reading from the mobile app, watch the PostHog
# "Live Events" stream for `reading_logged`.
```

Any of the above failing means the corresponding setup item isn't done.
