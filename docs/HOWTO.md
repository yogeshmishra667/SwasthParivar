# How-to recipes

> Concrete tasks against the audit's plumbing. Each section is a
> standalone recipe — read the heading, jump to it. If you need
> _why_ a system exists, see `docs/ARCHITECTURE.md`. If you need the
> deployment checklist, see `docs/SETUP.md`.

---

## Use the flag service

### Toggle a flag at runtime (no redeploy)

```bash
# Set
curl -X PUT https://api.swasthparivar.com/admin/flags/sms_msg91_enabled \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "X-Admin-Actor: $(whoami)" \
  -H "Content-Type: application/json" \
  -d '{"value": false}'

# Read
curl https://api.swasthparivar.com/admin/flags/sms_msg91_enabled \
  -H "Authorization: Bearer $ADMIN_API_TOKEN"
# → { "success": true, "data": { "key": "sms_msg91_enabled", "value": false } }

# Audit
curl https://api.swasthparivar.com/admin/flags/sms_msg91_enabled/audit \
  -H "Authorization: Bearer $ADMIN_API_TOKEN"
# → last 20 changes, newest first
```

Cache propagates across replicas via Redis pub/sub in under 30s.

### Add a new flag key

You don't. Just call `getFlag` / `setFlag` with the new key — no config changes needed.

To USE a flag in application code:

```ts
import { getFlag } from "../shared/flags/index.js";

const smsEnabled = await getFlag("sms_msg91_enabled", true); // default true
if (smsEnabled) {
  await sendSmsBatch(...);
} else {
  logger.info("MSG91 disabled by flag — skipping SMS step");
}
```

The default value is the SAFE one. If Redis is down or the flag is unset, the default applies. Pick defaults so the system stays correct without flags.

### Naming convention for flag keys

- `lower_snake_case`
- start with a letter
- 1–64 chars
- semantic: `<area>_<thing>_<enabled|mode|cap>` is the common shape
- examples: `maintenance_mode`, `otp_provider`, `sms_msg91_enabled`, `notification_caps`

The validator regex enforces the casing — wrong format = 400.

### What you MUST NEVER flag

Medical-safety constants. They are hardcoded by design:

- Critical-bypass thresholds (`<65 / >315`)
- The 4-step bypass chain (push → SMS → fullscreen → call) and its ordering
- The 30-minute critical cooldown
- The 3 AM streak day boundary

If you find yourself wanting to flag one of these, the answer is no — write a code change with two reviewers.

---

## Add a new PostHog event

1. Open `apps/server/src/shared/analytics/posthog.ts`
2. Add a key + typed properties to `EventPropsMap`:

   ```ts
   export interface EventPropsMap {
     // ... existing events
     prescription_uploaded: {
       source: "camera" | "gallery";
       file_size_kb: number;
       ocr_confidence: number;
     };
   }
   ```

3. Call from the relevant service or worker:

   ```ts
   import { capture as captureAnalyticsEvent } from "../../shared/analytics/posthog.js";

   captureAnalyticsEvent("prescription_uploaded", userId, {
     source: "camera",
     file_size_kb: 240,
     ocr_confidence: 0.87,
   });
   ```

4. The `EventPropsMap` is the source of truth — emitting with wrong shape fails typecheck.

Properties to avoid: phone, name, aadhaar, dob, raw OTP. PII has no place in product analytics.

---

## Ship a new server module

```bash
pnpm new-module appointments
```

Creates `apps/server/src/modules/appointments/` with five stub files matching the conventional pattern (controller, service, routes, validation, types).

Then:

1. Mount the router in `apps/server/src/app.ts`:
   ```ts
   import { appointmentsRouter } from "./modules/appointments/appointments.routes.js";
   app.use("/api/v1/appointments", appointmentsRouter);
   ```
2. Replace the placeholder validation schema with real fields.
3. Add an integration test under `apps/server/tests/integration/appointments.test.ts`.
4. Confirm the feature matches the current CLAUDE.md phase (CLAUDE.md Phase 2 for appointments — don't ship in Phase 1).

---

## Add a new pure-function detector

```bash
pnpm new-detector morning-rise
```

Creates `packages/domain-logic/src/detectors/morning-rise.ts` + `.test.ts`.

Then:

1. Re-export from `packages/domain-logic/src/detectors/index.ts`
2. Implement the function — input ⇒ `DetectorResult | null`
3. Write tests (CLAUDE.md minimum-data rule applies: most detectors should return `null` until 7+ readings exist)
4. Set a ratchet floor in `packages/domain-logic/vitest.config.ts`

Detectors are pure: no DB, no time-of-day side effects, no random. The purity check (`scripts/check-domain-purity.mjs`) will reject violations.

---

## Create a migration

```bash
pnpm new-migration add_appointment_status_column
```

Reads the migration safety checklist, then forwards to `prisma migrate dev --name add_appointment_status_column`.

CI will:

- Lint the generated SQL with `squawk` (rejects unsafe patterns: NOT NULL without default, renames, type changes)
- Verify the schema.prisma change pairs with a new migration folder (via the `migration-check` job)

For destructive migrations: see `docs/runbooks/rollback.md` Section 2 — write a reverse-SQL plan in the PR body, get a second reviewer, deploy in two steps (add new + backfill + drop old).

---

## Kill a misbehaving provider in production

`docs/runbooks/rollback.md` Section 3 is the source of truth. Quick version:

```bash
# MSG91 is rate-limited — force push-only:
curl -X PUT https://api.swasthparivar.com/admin/flags/sms_msg91_enabled \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -d '{"value": false}'

# Read it back to confirm:
curl https://api.swasthparivar.com/admin/flags/sms_msg91_enabled \
  -H "Authorization: Bearer $ADMIN_API_TOKEN"

# When provider recovers:
curl -X PUT https://api.swasthparivar.com/admin/flags/sms_msg91_enabled \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -d '{"value": true}'

# Audit log:
curl https://api.swasthparivar.com/admin/flags/sms_msg91_enabled/audit \
  -H "Authorization: Bearer $ADMIN_API_TOKEN"
```

For prod incidents that aren't a third-party outage, see `docs/runbooks/rollback.md` Sections 1 (image revert), 2 (migration revert), 4 (PITR), 5 (full outage).

---

## Rollback a bad deploy

See `docs/runbooks/rollback.md`. The TL;DR:

| What broke                                         | Section to follow                |
| -------------------------------------------------- | -------------------------------- |
| New image misbehaving, schema unchanged            | 1                                |
| Migration ran and code is broken on the new schema | 2                                |
| Third-party provider down                          | 3                                |
| Data corruption, need to time-travel Postgres      | 4                                |
| Everything red, can't diagnose                     | 5 (revert first, diagnose after) |

Each section has explicit `curl` / `gh` / `prisma` commands. The drill checklist at the bottom of the file rehearses each path quarterly.

---

## Run the full CI sweep locally before pushing

```bash
bash scripts/preflight.sh           # static gates + unit tests, ~30s
bash scripts/preflight.sh --full    # also integration + Docker, ~5min
```

The pre-push git hook runs the fast version automatically. Override with `git push --no-verify` only in genuine emergencies.

Preflight runs 11 gates in order (mirrors CI):

1. Wipe build artefacts (`dist/`, `*.tsbuildinfo`)
2. Frozen `pnpm install` (matches CI lockfile lock)
3. Workspace typecheck
4. Workspace lint (`max-warnings=0`, includes `eslint-plugin-security`)
5. Prettier `format:check`
6. `prisma format` check on `schema.prisma`
7. Schema ↔ migration parity (semantic — uses `prisma migrate diff`,
   so pure-format edits do NOT trigger "missing migration")
8. Squawk migration SQL safety on newly-added migrations
9. Domain-logic purity (no DB/network imports, no `Date.now()` etc.)
10. Domain-logic `test:coverage` with per-file ratchets
11. (Optional with `--full`) integration tests + Docker `/health` smoke

If preflight passes locally and CI fails, the gap is a CI-specific thing (env, secrets, third-party services like Trivy DB or CodeQL servers). Open the failing job's log on GitHub.

CI-only gates (don't run locally — see CONTRIBUTING.md gate map for why):

- **CodeQL SAST** (JS/TS) — Security → Code scanning
- **Dependency review** on PR diffs (HIGH/CRITICAL CVE + license check)
- **Trivy image scan** (HIGH/CRITICAL, fixable only)
- **Gitleaks** secret scan
- **Danger** PR-rules bot
- **`pnpm audit`** full production-dep tree

---

## Triage a CodeQL alert

CodeQL findings appear under **Security → Code scanning** on GitHub. PR
checks fail only on `ERROR`-severity rules; `WARNING` and `NOTE` show
in the dashboard but don't block.

1. Click the alert. Read **"Why this matters"** — it explains the data
   flow CodeQL traced (e.g. `req.body.token → service → bcrypt.compare`).
2. If the flow is genuinely exploitable:
   - Add the input validation or sanitization at the boundary, not the
     sink. Pattern: parse-don't-validate using Zod at the controller.
   - Push a fix; CodeQL re-scans on the next commit.
3. If it's a false positive (CodeQL traced data that's actually
   already constrained):
   - Click **Dismiss** → pick the reason (`False positive`,
     `Used in tests`, `Won't fix`). The audit log captures who
     dismissed and why.
   - **Don't** suppress with a code comment — CodeQL reads SARIF
     suppressions, not source comments. Use the GitHub UI.
4. If it's a known limitation of the rule pack:
   - Open an issue tagged `security:codeql-tuning` with the rule ID.
     Periodically (~quarterly) we review the suppression list and
     consider downgrading rules to `warning` severity in the workflow.

The workflow lives at `.github/workflows/codeql.yml`; it pulls the
`security-and-quality` query pack. Bumping to `security-extended` is on
the table once the team is ≥5 engineers.

---

## Triage a Trivy image-scan alert

Trivy runs after the server Docker image is built (`image-smoke` job).
It fails on `HIGH` or `CRITICAL` CVEs that have a fix available
(`ignore-unfixed: true`).

1. The CI step prints the CVE table — package, installed version,
   fixed version, link to advisory.
2. **Most common cause**: the Node base image (`node:22-bookworm-slim`)
   has a vulnerable `libxml2` / `openssl`. Rebuild after a base bump:
   ```bash
   # Locally bump the base in apps/server/Dockerfile and re-run:
   bash scripts/preflight.sh --with-docker
   ```
3. If the CVE is in a workspace dep, regenerate the lockfile:
   ```bash
   pnpm --filter @swasth/server update <pkg>
   pnpm install
   ```
4. If no fix exists yet (Trivy still shows it because the package
   patched in a later major), pin to a minor that has the patch OR add
   to `.trivyignore` with a tracking issue.
5. **Never** disable the gate. Reach for `--ignore-unfixed: false`
   only if you want MORE strictness, not less.

---

## Triage an `eslint-plugin-security` failure

The plugin fires on lint at commit + preflight + CI. High-signal rules
only (CONTRIBUTING.md lists the picked subset).

| Rule fired                                | What to do                                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `security/detect-eval-with-expression`    | Don't use `eval`. If you must (e.g. expression sandbox), use `vm2` and add the rule disable comment justifying it.  |
| `security/detect-non-literal-regexp`      | Compute the regex once at module load with a literal, OR escape user input via `lodash.escapeRegExp` then build it. |
| `security/detect-unsafe-regex`            | Catastrophic backtracking risk (ReDoS). Replace with a non-greedy pattern or a finite-state matcher.                |
| `security/detect-possible-timing-attacks` | Use `crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))` — never `===` on auth tokens / OTPs / JWTs.            |
| `security/detect-pseudoRandomBytes`       | `crypto.pseudoRandomBytes` is removed in modern Node — use `crypto.randomBytes` (cryptographically secure).         |
| `security/detect-child-process`           | Avoid `exec` with user input. Use `spawn` with an arg array (no shell), or refactor to remove `child_process`.      |
| `security/detect-bidi-characters`         | Trojan Source attack vector. Open the file in an editor that shows zero-width chars, find and delete.               |

If a rule is firing on safe code you can't restructure away, suppress
inline with a one-liner justification:

```ts
// eslint-disable-next-line security/detect-non-literal-regexp -- pattern is from a
// trusted source list, no user input ever reaches the constructor
const re = new RegExp(trustedPattern);
```

Suppress at file level only with reviewer sign-off; we audit
`eslint-disable` density quarterly to catch slow drift.

---

## Local-dev PostHog setup (without prod keys)

You can wire a local PostHog instance against a personal free-tier
account for development. CLAUDE.md's "Developer Alerts" all run against
PostHog, so getting events flowing locally is the fastest way to
confirm a new event you're adding actually emits.

```bash
# 1) Get a free PostHog project key (docs/SETUP.md "PostHog setup
#    walkthrough" Step 1 — same flow).
# 2) Drop the key into apps/server/.env:
echo "POSTHOG_API_KEY=phc_…" >> apps/server/.env

# 3) Start the server. The init log prints whether PostHog wired up:
pnpm --filter @swasth/server dev | grep -i posthog
# → either "PostHog initialised" or no line (no-op, key missing)

# 4) Trigger any event-emitting endpoint. The CLAUDE.md Metrics list
#    is exhaustive — pick one and curl it.
# 5) PostHog → Live Events tab → confirm arrival within ~10s.
```

The mobile-side key (Step 3 of the walkthrough) is bundle-time, not
process-env, so to test mobile events you need an EAS preview build
with `extra.posthogKey` set in `app.json` or via `eas env`.

---

## Smoke the Docker image locally

```bash
docker build -f apps/server/Dockerfile -t swasth-server:local .

docker run --rm -d --name swasth-smoke -p 14000:4000 \
  -e NODE_ENV=test -e PORT=4000 \
  -e DATABASE_URL="postgresql://stub:stub@127.0.0.1:65432/stub" \
  -e REDIS_URL="redis://127.0.0.1:65433" \
  -e JWT_SECRET="local-jwt-secret-local-jwt-secret-32c-12" \
  -e JWT_REFRESH_SECRET="local-refresh-local-refresh-32c-12345" \
  -e OTP_SECRET="local-otp-secret-local-otp-secret-32c-12" \
  swasth-server:local

curl http://127.0.0.1:14000/health
# → {"status":"ok","time":"..."}

docker rm -f swasth-smoke
```

`DATABASE_URL` and `REDIS_URL` can point at nothing (stub) for the simple `/health` probe — it doesn't touch DB/Redis. `/health/deep` needs real targets.

---

## Add a new safety-critical test (threshold boundary etc.)

Pattern: write a test that breaks LOUDLY if someone changes a constant. Example from the codebase:

```ts
// apps/server/tests/integration/critical-bypass-chain.test.ts
it("threshold boundary: 65 mg/dL is NOT critical, 64 mg/dL IS critical", async () => {
  // CLAUDE.md: "Thresholds HARDCODED. Not configurable. Medical safety."
  // This test exists so a future change to the threshold constants
  // breaks the test loudly rather than slipping through review.
  // ...
});
```

If you find yourself writing "this works in production today but could break silently if X changes," that's the test to write.

---

## Generate an admin API token

```bash
openssl rand -base64 48
# → ~64 chars of random base64
```

Drop into the deploy host's env as `ADMIN_API_TOKEN`. The env schema requires ≥32 chars; the constant-time check in the middleware is length-agnostic but won't run unless the token is set.

Rotate by setting a new value + redeploying. There's no in-flight rotation — all admin clients need to update simultaneously.

---

## Find what setup is still missing

`docs/SETUP.md` is the live checklist. Run the verification commands at the bottom of that file against the deploy host — anything that fails maps to one of the P0/P1/P2 items.

---

## "I made a change to safety-critical code, what reviews do I need?"

`.github/CODEOWNERS` enforces it. Paths that require 2 reviewers:

- `apps/server/src/modules/readings/**`, `apps/server/src/modules/sync/**`
- `apps/server/src/workers/critical-alert.{worker,processor}.ts`
- `apps/server/src/workers/grace-reset.worker.ts`
- `apps/server/src/shared/notifications/**`
- `apps/server/prisma/schema.prisma`, `apps/server/prisma/migrations/**`
- All `packages/domain-logic/src/{critical-bypass,streak-engine,voice-parser,feedback-engine,notification-resolver}/**`
- `apps/mobile/src/components/logging/{CriticalAlert,VoiceInputNative}.tsx`
- `apps/mobile/src/utils/phone.ts`

GitHub branch protection enforces this once setup item P2-13 lands. Until then, the CODEOWNERS file is a documented intent.
