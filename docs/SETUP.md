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

| #   | Item                            | Where               | Notes                                                                                                                                                                                                                                                                |
| --- | ------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6   | Create Sentry project (server)  | sentry.io           | Copy DSN to `SENTRY_DSN` on the deploy host. Without this, server errors land in stdout only.                                                                                                                                                                        |
| 7   | Create Sentry project (mobile)  | sentry.io           | Pass DSN as `EXPO_PUBLIC_SENTRY_DSN` at EAS build time, _or_ put it under `expoConfig.extra.sentryDsn` in `app.json` (re-build needed).                                                                                                                              |
| 8   | Create PostHog project          | posthog.com         | See [PostHog setup](#posthog-setup-walkthrough) below for the full step-by-step. Without `POSTHOG_API_KEY`, all 5 audit-wired events (`reading_logged`, `streak_milestone`, `voice_attempt`, `critical_bypass_triggered`, `notification_sent`) are silently dropped. |
| 9   | Configure WhatsApp Business API | Meta business       | `WHATSAPP_BUSINESS_API_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`. Primary OTP channel.                                                                                                                                                                                      |
| 10  | Configure MSG91                 | msg91.com           | `MSG91_API_KEY`, `MSG91_SENDER_ID`. SMS fallback (critical-bypass step 2).                                                                                                                                                                                           |
| 11  | Configure Expo push             | expo.dev            | `EXPO_ACCESS_TOKEN`. Required for guardian push notifications.                                                                                                                                                                                                       |
| 12  | Configure Cloudflare R2         | dash.cloudflare.com | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY`, `R2_SECRET_KEY`, `R2_BUCKET`. Phase 4 (prescription photos) — defer until then.                                                                                                                                                    |

## P2 — repo + GitHub configuration

| #   | Item                                                | Where                             | Notes                                                                                                                                                                                                       |
| --- | --------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 13  | Enable branch protection on `main`                  | GitHub repo settings              | Require PR + at least 1 approving review (raise to 2 once a second engineer joins), require status checks `Typecheck`, `Lint`, `Build`, `Unit tests`, `Integration tests`, `Image smoke`, `Danger` to pass. |
| 14  | Add a second human to `CODEOWNERS`                  | `.github/CODEOWNERS`              | Currently lists `@yogeshmishra667` only. The "2 reviewers required for safety-critical paths" rule in `PULL_REQUEST_TEMPLATE.md` is aspirational until a second name lands here.                            |
| 15  | Configure deploy host secrets via the platform's UI | Render / Fly / k8s secret manager | Copy each env var from items 1–12. Never commit them; never put them in `app.json` for mobile except for non-secret values like Sentry DSN.                                                                 |
| 16  | Wire CI status checks into branch protection        | GitHub repo settings              | Each CI job is a status check; pick the ones from item 13 above.                                                                                                                                            |
| 17  | Enable Code scanning + Dependency graph             | GitHub repo settings              | See [Enabling code-security features](#enabling-code-security-features-codeql--dependency-review) below. Currently soft-fail; enable to upgrade to hard gates.                                              |

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

## Enabling code-security features (CodeQL + Dependency review)

Two of the new gates (CodeQL SAST and Dependency review on PR diffs)
ship with `continue-on-error: true` so they don't BLOCK PRs on a fresh
repo. They become hard gates once the underlying GitHub features are
enabled. Without enabling them, the gates run but their failures are
informational.

### What needs enabling

| Feature              | Required for          | How to enable                                                           | Cost                            |
| -------------------- | --------------------- | ----------------------------------------------------------------------- | ------------------------------- |
| **Dependency graph** | `dependency-review`   | Settings → Code security → "Dependency graph" toggle                    | Free on public; GHAS on private |
| **Code scanning**    | `CodeQL`, `Scorecard` | Settings → Code security → "Code scanning" → click "Set up" → "Default" | Free on public; GHAS on private |
| **Secret scanning**  | Better than gitleaks  | Settings → Code security → "Secret scanning" toggle                     | Free on public; GHAS on private |

### Two paths to upgrade soft gates to hard gates

**Option A — Make the repo public** (recommended if the code is meant
to be open):

1. Settings → General → Danger Zone → Change visibility → Public
2. All three features above become FREE
3. After the next push: gates pass cleanly with no extra work
4. Drop `continue-on-error: true` from `ci.yml` (dependency-review job)
   and `codeql.yml` (analyze job) in a follow-up PR

**Option B — Enable GitHub Advanced Security** (keep repo private):

1. Settings → Code security → enable each feature one by one
2. GHAS is paid (~$21/user/month for orgs as of 2026). For a single-
   user account, GitHub may offer a free trial — check
   `Settings → Billing`.
3. After enabling, drop `continue-on-error: true` as in Option A.

### What still works without either

These gates run fine on a private repo with no GHAS:

- `pnpm audit` (full-tree CVE scan, runs in the `audit` job)
- Trivy image scan (runs in `image-smoke`)
- gitleaks (runs in `secret-scan`)
- `eslint-plugin-security` (runs in `lint`)
- SBOM generation (workflow artefacts + release attachments)
- OpenSSF Scorecard analysis itself (only the SARIF upload to Security
  tab fails; the score artefact still gets generated)

So the security posture is already strong without GHAS — CodeQL just
adds the SAST flow-analysis layer on top, and dependency-review adds
the PR-diff earlier signal vs `pnpm audit`'s full-tree run.

### What I recommend for SwasthParivar

For a medical-grade project pre-launch: **enable GHAS** when budget
allows, because CodeQL's session-fixation / data-flow rules find a
class of bug `pnpm audit` and Trivy can't see. Until then, the
soft-fail keeps the gates in place so the day GHAS lands, every PR
since this commit gets re-scanned in the historical timeline.

---

## PostHog setup walkthrough

This is the concrete step-by-step for item #8. Two env vars across two
surfaces (server + mobile), both wired with no-op fallbacks so the
absence of keys never breaks a build.

### Step 1 — Create the PostHog project

1. Sign up at [posthog.com](https://posthog.com) (free tier is enough — 1M
   events/month). Pick the **US** region unless your team is in the EU; the
   server emitter currently points at `https://us.i.posthog.com`. If you
   pick EU, update both `posthog.ts` files (see Step 4 below).
2. Skip the install wizard's framework picker — we don't use the snippet
   approach. We use `posthog-node` (server) and `posthog-react-native`
   (mobile), both already in the workspace.
3. Open the new project's **Settings → Project → API keys**.
4. Copy the **Project API key** (starts with `phc_`). This is the
   client-side key — safe to ship inside the mobile app. It can write
   events but cannot read them.
5. (Optional, ops only) Copy the **Personal API key** if you want to
   write Grafana/Looker queries against PostHog data. Not needed by the
   app.

### Step 2 — Server: set `POSTHOG_API_KEY`

Same key as Step 1 (the `phc_…`).

```bash
# Local dev (apps/server/.env):
echo "POSTHOG_API_KEY=phc_…your_key_here…" >> apps/server/.env

# Deploy host: set via the platform's secret manager
# (Render env vars / Fly secrets / k8s Secret).
```

The server emitter in `apps/server/src/shared/analytics/posthog.ts`
reads this key at startup. **No key → `capture()` is a silent no-op**,
so dev/test runs stay quiet. In production the env-schema guard
(`apps/server/src/config/env.ts`) makes the key required and fails
fast on startup.

### Step 3 — Mobile: bake the key into the build

Mobile reads from `expoConfig.extra.posthogKey`, _not_ from a process
env var (process env doesn't exist on a React Native runtime). Two
ways to land the key:

**Option A — `app.json` (simplest, key visible in repo):**

```json
// apps/mobile/app.json
{
  "expo": {
    "extra": {
      "sentryDsn": "...",
      "posthogKey": "phc_…your_key_here…"
    }
  }
}
```

Then rebuild: `eas build` or `npx expo prebuild && npx expo run:android`.

**Option B — EAS environment variable (key not in repo):**

```bash
eas env:create EXPO_PUBLIC_POSTHOG_KEY --value phc_… --environment production
```

Then read it in `app.config.ts` instead of `app.json` and project the
value through `expoConfig.extra.posthogKey`. Required if the key
should differ per build profile.

**Either way the client-side PostHog key is _not_ a secret** — it's
shipped inside the binary. PostHog enforces server-side that
project-keys can only `capture` events, never read them.

### Step 4 — (Only if you picked the EU region)

PostHog has two API hosts. Update both files to match the region you
chose at signup:

```ts
// apps/server/src/shared/analytics/posthog.ts
host: "https://eu.i.posthog.com"; // was: us.i.posthog.com

// apps/mobile/src/services/analytics.ts
new PostHog(apiKey, { host: "https://eu.i.posthog.com" }); // was: app.posthog.com
```

(The mobile file currently points at the legacy `app.posthog.com`
host which still works for both regions, but matching the server URL
is cleaner.)

### Step 5 — Verify events are flowing

```bash
# 1) Start the server with the new key set:
pnpm --filter @swasth/server dev

# 2) Trigger a server-side event. The simplest is logging a glucose
#    reading — it fires `reading_logged` from readings.service.ts:
curl -X POST http://localhost:3000/api/v1/readings/glucose \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"clientUuid":"00000000-0000-0000-0000-000000000001","valueMgDl":120,"readingType":"fasting","source":"manual","measuredAt":"2026-05-16T07:00:00Z","version":1}'

# 3) Open PostHog → Live Events tab. Within ~10 seconds you should
#    see `reading_logged` with the expected properties (type, source,
#    user_stage, etc.). If you don't:
#      - check the server log for "posthog capture failed"
#      - confirm POSTHOG_API_KEY is loaded (`echo $POSTHOG_API_KEY`)
#      - confirm the host matches your region (Step 4)
```

### Step 6 — Dashboards (recommended, takes ~10 min)

PostHog → **Dashboards → New dashboard → SwasthParivar - retention**.
Add these queries — they map 1:1 to the CLAUDE.md "Developer Alerts"
section:

| Tile                        | Query                                                                                                                                                   | Alert threshold                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Voice success rate          | `count(voice_attempt where success=true) / count(voice_attempt)` over last 7 days                                                                       | < 70% → onboarding parser broken   |
| Time-to-first-log p50       | `median(time_to_log_seconds where reading_logged.user_stage=0)`                                                                                         | > 24hr for 30% → too much friction |
| Critical-bypass SMS success | `count(critical_bypass_triggered where sms_targets > 0)` — track per-day. Pair with `critical_alert_sms_per_contact{delivered}` (Phase-1.5 patch event) | < 95% → SMS provider issue         |
| Day-1 / Day-7 retention     | Retention insight, anchor event = `reading_logged`, return event = `reading_logged`                                                                     | day-1→3 < 50% → onboarding fix     |
| Notification → open rate    | `count(app_opened where source='notification') / count(notification_sent where suppressed=false)`                                                       | < 30% → re-tune copy/cadence       |

The team's alerting bar comes from CLAUDE.md "Developer Alerts" —
PostHog → Alerts can fire to email or Slack when any of these breach.

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
