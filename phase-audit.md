# Phase Audit — Admin Dashboard, App Features + Documentation (2026-09-29)

> **Type:** audit + fix plan. **No code was changed** while producing this document.
> **Baseline:** `main` @ `82a08fe` (unchanged between both passes). All 38 Markdown files on `main` were read in full for each pass, and every finding below was checked against the code on `main`. Items that could not be verified are marked **Unverified**.
> **Pass 1 — admin dashboard + docs:** sections 2–3 (D1–D18, X1–X8).
> **Pass 2 — app features (patient + guardian app and the server paths behind them):** section 4 (P1–P34). Scope: glucose/BP/cardiac/respiratory logging, voice, critical-bypass, SOS, offline sync, shared-phone profiles, medicines + reminders, medicine/prescription scan, AI chat + chat signals, guardian/family flow, settings, auth, privacy and security. Pass 2 is based on reading code, one local `pino` redaction check, and the Expo push docs. **No tests were run in pass 2.**
> **Rule for the fix phase:** do not break existing behaviour. See "Safety rules for the fix work" before starting anything.

## 0. Fix status — updated 2026-10-29

Every fix below shipped as its own PR, with a `safety-reviewer` pass (re-run until PASS) and a sabotage check: each new test fails with its fix removed. Details are in `audit-progress.md` → "Phase-audit fix wave".

| Item | What | Status |
|---|---|---|
| **P1** | Per-contact SMS: a push to the patient's own phone no longer suppresses SMS to contacts. Household-member contacts are always texted. The push stage can't block SMS. SMS retries 3×. On-call is paged on any undelivered SMS. | ✅ #198 |
| **P5** | Durable critical-alert hand-off: bounded enqueue with in-process fallback, replay re-ensures and revives, plan before save, escalation can't re-send, Redis calls bounded. | ✅ #202 |
| **P6** | Prescription approval authority frozen: once a guardian is required, it never falls back to the patient. | ✅ #200 |
| **P4** | BP critical bypass (sys < 90 / dia < 60, sys > 180 / dia > 110) through the shared chain with a per-category cooldown, plus the app's fullscreen alert. A critical BP that didn't land is persisted and re-sent; SOS escalation is category-aware. | ✅ #207 |
| **P2** | The critical alert calls the priority-1 contact (cached per profile for offline), keeps 112 as a second button, and auto-dials the contact at 60s unless touched. | ✅ #208 |
| **P3** | One app-wide fullscreen alert: onboarding's first reading, cardiac/respiratory, and `critical_alert` pushes (patient alert on the household's device, guardian variant elsewhere). | ✅ #210 |
| **D3** | Cohort/percentage flags resolved per household account at the API (logging, doctor portal, SOS). Real SOS mode for a cohort is the new `sos_real_mode_enabled`. | ✅ #209 |
| **D8** | SOS routes and signed payment webhooks stay up during maintenance; the Ops toggle says what stays up and what waits. | ✅ #211 |
| **P11** | Anti-fatigue works: unopened pushes count as ignored, app-reported opens reset fatigue, CLAUDE.md caps, streak-day recovery. Best-time average, variant pool and tap routing still open. | ✅ #212 |
| **P22** | Phone numbers (and other PII keys) redacted at any depth in logs. | ✅ #213 |
| **P10** | Android channels: the app creates every channel the server pushes to. `channelId` is typed against one shared list. | ✅ #203 |
| **D1** | SMS success rate divides only by alerts that attempted an SMS. | ✅ #201 |
| CI / supply chain | Third-party actions pinned to SHAs. This unblocked #85 and #86, which CodeQL review threads had blocked. | ✅ #199 |
| **X1** | Ops docs sign in through the admin login (email + password + 2FA) instead of the removed `ADMIN_API_TOKEN`. `scripts/admin-token.mjs` prints a 15-minute token for curl and is tested against the real app. | ✅ #225 |
| **P9** | The glucose offline queue deletes a reading only when the server refuses it for good, never a critical one, and the daily cap counts by the reading's day. The review found that every offline reading drained with `"notes": null`, got a 400 and was deleted. The server now accepts it, so installed builds stop losing readings. | ✅ #226 |
| **P8** (BP, cardiac, respiratory, meals) | A real offline queue (WatermelonDB v3 `pending_writes`) with P9's rules: critical first, newest first, held rather than deleted. "Not saved" when nothing could be stored. Failed-save messages now show on the confirm screens (they never did). One-tap call for a critical log stored offline. | ✅ #227. Medicine taken/skipped is still online-only (next) |
| **P33** | A critical reading over 2h old when sent gets a late notice (push + SMS with when it was taken), not an emergency page: no patient re-alert, no cooldown, no SOS escalation. The age is measured on the phone's clock (`sentAt`); without it, the live chain always runs. Also: glucose, cardiac and respiratory replays are scoped to the reading's owner. | ⏳ #228 — deploy before an app build with #227 ships |
| Next | P8's medicine half, then P7, D2, X2 (§7), plus the follow-ups below | ⏳ |

Follow-ups raised by the safety reviews (not yet filed as items):

- **P5:**
  - Postgres-durable dedup/outbox; the in-process dedup is per instance, so a late-landing add duplicates.
  - The 5-minute escalation can't be scheduled during a Redis outage.
  - ~~The escalate processor only handles glucose.~~ Fixed in #207 (category-aware lookup).
  - Cardiac/respiratory kill-switch flags fail closed in a Redis outage.
- **P6:**
  - The approver's identity isn't frozen, only the boolean: a new "son" link outranks a spouse. Notify existing guardians on new links.
  - No push to the guardian on upload or revoke.
  - The clarification worker can flip an approved item back. Approve reads items outside its transaction, which allows duplicate schedules.
- **P1:**
  - ~~`msg91-sms.ts` logs top-level `phone` unredacted (P22).~~ Fixed in #213.
  - The metric now relies on `sms_triggered`; check against real PostHog data.
- **P4 (BP):**
  - Clinician sign-off on the BP copy (questions listed in #207).
  - ~~Server-side handling of late critical readings: a reading that lands hours late (offline drain, any category) still pages the family as current and schedules SOS.~~ Handled in #228 (open).
  - A Devanagari patient name makes any alert SMS UCS-2 / multi-part; cardiac/respiratory SMS still reuse the push copy (emoji).
  - RED 3-second confirm for a critical BP; chat and guardian dedup ignore BP critical.
- **P2 / P3 (app alert):**
  - "Any touch cancels" the auto-dial is literal; consider a 2–3 s grace period (product call).
  - Offline peak-flow red zone raises no alert until sync (no cached baseline) — product sign-off.
  - Guardian variant has no "Call Papa": patient phones never reach the guardian's device (privacy decision).
  - Device check: iOS with the profile selector due at the same time as a cold-start critical tap.
- **D3 / D8 (flags, maintenance):**
  - A DB error on a cohort-flag SOS lookup is a 500, not `SOS_DISABLED`; confirm the app shows "call emergency services" for any trigger failure.
  - A Redis outage mid-chain reads `sos_enabled` as off and stops the escalation tick.
  - Exotel / Twilio call-status callbacks accept unsigned requests when their secret is unset (env marks them optional); the Exotel HMAC signs `JSON.stringify` of a form body. Fail closed in production.
- **P11:** best-time from a rolling 5-day average; 5-variant pool; tap routing; medicine / critical sends still feed the 30-min throttle.
- **P9 (glucose queue):**
  - The glucose fullscreen alert waits for the save's network call (up to 10s). BP, cardiac and respiratory raise it first.
  - A reading synced more than 2h late bumps the device-clock anomaly counter; two flag the user for time manipulation (CLAUDE.md #18).
  - `api.ts`: the token refresh has no timeout, and any refresh failure (a network blip included) logs the user out, which stops every queue drain until they sign in again.
  - Logout doesn't clear the local database (see P21).
  - Check PostHog `sync_drop_400` for readings lost before #226.
- **P8 (offline queue):**
  - Medicine taken/skipped is still online-only: the medicine log needs server idempotency first.
  - The log screen has no test harness: the per-entry id and time, its renewal on a profile switch and the haptic placement are untested.
  - Device check: in airplane mode, log a critical BP and a meal, kill the app, reconnect, confirm both arrive.
  - The glucose queue holds a critical reading answered with `READING_STALE_VERSION` forever; the new queue treats that answer as delivered.
  - The glucose queue has no quick retries after a critical reading, and doesn't go round again for one queued mid-drain (the new queue does both).
  - Rows for a profile no longer in the household are held and retried every 60s forever (badge noise).
  - Older UX items: sub-14px fonts on the log screen; an offline respiratory red zone isn't critical (no cached baseline).
- **P33 (late critical readings):**
  - Before ship: check that Sentry's paging rule filters on `level:error`, or late-notice warnings will page too.
  - Clinician sign-off on the late copy. Product calls: the 2h cutoff, SMS for late notices (CLAUDE.md #14 says push only for non-critical), and the `critical` channel (bypasses Do Not Disturb at 3 AM).
  - A clock corrected between taking and sending (phone booted offline with a wrong clock) can still make a current reading look late; needs a monotonic age from the app.
  - Bluetooth meter readings (when they land) must be aged by the phone's receive time, not the meter's clock.
  - Tapping a late notice opens nothing specific. The time in it is IST with no label.

---

## 1. Baseline — is `main` healthy?

| Check | Result on `main` @ `82a08fe` |
|---|---|
| CI (push) — last 3 commits | Only **Dependency audit** fails (the known ~82-advisory issue, out of scope). All other jobs pass, including integration tests. |
| Local: format, typecheck, lint, domain-logic purity, workspace build | ✅ Pass (after restoring local deps — see X8) |
| Local: domain-logic tests | ✅ 898 pass. Coverage gate is **flaky** — see X3 |
| Admin SPA tests | ✅ 16/16 (3 files) |
| Server admin integration test files | 11 (`admin-*.test.ts`, `bull-board.test.ts`, `maintenance-mode.test.ts`) — green in CI |
| Open PRs affecting this audit | #174 (reconciliation cron + E.2 modules) — not merged; `phase4-progress.md` on `main` stays stale until it merges |

**Severity key:** **High** = wrong numbers, broken control, or a real security/ops gap. **Medium** = policy breach or missing capability. **Low** = hygiene. **Info** = note only.

---

## 2. Dashboard findings (admin console — `apps/admin` + `apps/server/src/modules/admin`)

### D1 — High — The URGENT "Critical-bypass SMS success rate" metric is miscalculated

> **✅ Fixed in #201 (2026-10-25).**

- **Evidence:** `admin-analytics.registry.ts:246-262` computes `countIf(properties.sms_success = 'true') / count()` over **every** `critical_bypass_triggered` event. `critical-alert.processor.ts:291-300` and `:476-485` emit `sms_success: false` whenever SMS was **not needed**: push succeeded, or the alert fell inside the cooldown window (`sms_triggered: false`).
- **Impact:** a healthy system shows a low "SMS success rate" and trips CLAUDE.md's "< 95% → URGENT" alert falsely, while real SMS failures are diluted and harder to see.
- **Fix:** divide only over events with `sms_triggered = true`. Keep the current value as a separate "remote delivery" metric if useful.
- **Unverified:** whether PostHog stores these booleans so that `= 'true'` matches. Check against a real event; `voice_success_rate` uses the same pattern.

### D2 — High — The billing console (§K.6) has no UI

- **Evidence:** `apps/admin/src/pages/BillingPage.tsx:137,150` still show the M3-T9 scaffold ("Phase 4 placeholders"). The page only reads `tier_distribution` and the tier-change audit log. No code in `apps/admin/src` calls `/admin/billing/subscriptions`, `/admin/billing/metrics` or the refund route.
- **Impact:** the subscription table, MRR/churn tiles and refund trigger exist only as server endpoints. Ops cannot manage billing from the dashboard. `phase4-progress.md` describes K.6 as merged, but that is server-side only.
- **Fix:** build the table (filters: status, provider), the MRR/churn tiles and a refund button gated to super_admin, using the existing endpoints and `ConfirmDialog`.

### D3 — High — Cohort and percentage rollouts on kill-switch flags turn the feature on for **everyone** at the API

- **Evidence:** these services read their flag as a plain boolean with `getFlag<boolean>(...)`. A rollout object (`{"rollout":"cohort",...}`) is truthy, so the server treats it as ON for all users:
  - `cardiac.service.ts:77`, `respiratory.service.ts:71`
  - `activity.service.ts:30`, `sleep.service.ts:26`
  - `doctors.service.ts:26`
  - `sos.service.ts:80, 95, 103, 127, 322, 324`, `sos-escalation.processor.ts:314`
- **Where it conflicts:**
  - `phase4.md:183` requires "All read through `isFeatureEnabled(userId)` (CC.12.3)".
  - The dashboard's Flags page offers cohort/percentage editors for these flags.
  - `docs/runbooks/feature-e-cohort-ramp.md:65-71,166` tells ops to set a cohort and claims the server returns 503 for users outside it. The server does **not**.
  - `docs/runbooks/sos-drill.md` §1 ("`sos_enabled=true` for the drill account only (cohort flag)") and §2 ("cohort-scoped `sos_test_mode=false`") cannot work. The `sos_enabled` cohort enables SOS for everyone. The `sos_test_mode` cohort is truthy, so test mode stays ON for everyone. That is the safe direction, but a real-mode drill is impossible as written.
- **Impact:** the mobile UI respects the cohort (it uses `isFeatureEnabled` via `/config/features`), but the API accepts writes from every user. Ops get a false sense of control during ramps.
- **Fix:**
  - Per-user features: switch to `isFeatureEnabled(key, userId)`.
  - Global crons and system switches (e.g. `maintenance_mode`, retention sweeps): keep a plain boolean, which is the documented CC.12 design.
  - `sos_test_mode` is an inverse flag. Replace the "cohort = off" idea with a positive flag such as `sos_real_mode_enabled`, rolled out by cohort.
  - Boolean `true`/`false` must behave exactly as today (CC.12.0 backward compatibility).
  - **SOS parts are safety-critical:** two reviewers plus `safety-reviewer`.

### D4 — Medium — Patient name and phone are visible to the `analyst` role, and the billing read is not audited

- **Evidence:**
  - `/admin/users` list and detail have no role gate (`admin-users.routes.ts:22,24`), and the DTO includes `phone` (`admin-users.service.ts:31-32`).
  - `/admin/billing/subscriptions` is open to all roles (`admin-billing.routes.ts:16-22`) and returns `patientName` + `patientPhone` (`admin-billing.service.ts:61`). It writes no `patient_data_viewed` audit row.
- **Conflicts with:** the plan's permission matrix (`docs/admin-dashboard-plan.md:95-103`: analyst excluded from detailed user data), and the Session 5 precedent that made `doctor_profiles` sensitive to hide phone numbers from analysts.
- **Fix:** mask phone numbers for analysts (e.g. last 4 digits only), or gate these reads to support and above. Audit billing list reads.

### D5 — Medium — Admin sessions cannot be revoked (logout, password reset, suspected compromise)

- **Evidence:**
  - Refresh token is a stateless JWT valid for 7 days (`admin-auth.service.ts:23,86`), re-issued on every refresh (`:195-215`).
  - Logout only clears the cookie (`admin-auth.controller.ts:58`).
  - A password reset does not invalidate existing tokens.
  - What **is** handled: deactivation is enforced on every request (`admin-rbac.ts`) and on refresh (`admin-auth.service.ts:210`).
- **Fix:** add a `sessionVersion` column to `AdminUser`, put it in both tokens, check it on every request and refresh, and bump it on logout-all, password reset and role change.

### D6 — Medium — No flag catalog, and any key can be created

- **Evidence:**
  - The Flags page lists raw keys with no descriptions; descriptions exist only as comments in `prisma/seed-flags.ts`.
  - "New flag" accepts any key matching `^[a-z][a-z0-9_.]*$` (`admin-flags.validation.ts`), so a typo (e.g. `cardiac_loging_enabled`) silently does nothing.
  - One documented kill switch is already dead (X2).
- **Fix:** a typed `FLAG_CATALOG` in `@swasth/shared-types` with fields `key`, `description`, `kind` (`global_boolean | rollout | config | number`), `default`, `safetyCritical`, `owner`.
  - Server: warn on unknown keys and refuse a rollout object on a `global_boolean` flag.
  - SPA: show descriptions and badges.
  - This is also the natural home for Phase 6's flags.

### D7 — Medium — 9 patient data tables have no admin panel, including SOS

- **Evidence:** models with `userId`/`patientId` that are missing from `admin-resource.registry.ts`: **`SOSEvent`**, `ActivityDaily`, `SleepLog`, `HealthCheckSchedule`, `HealthCheckCompliance`, `Subscription`, `PaymentEvent`, `FeedbackEvent`, `UserPreferences`. (`UserStreak` and `NotificationState` are shown in the detail header.)
- **Doc drift:** `docs/admin-dashboard.md` says Activity/Sleep are "pending Feature I", but Feature I shipped in #160.
- **Fix:** add read-only registry entries: SOS, payments and health data marked `sensitive: true`; preferences not sensitive.

### D8 — Medium — The maintenance toggle also blocks SOS and payment webhooks, with no warning

- **Evidence:** `maintenance-mode.ts:25` exempts only `/health*` and `/admin*`. So during maintenance these get a 503:
  - `POST /api/v1/sos/trigger`
  - the SOS vendor status webhooks under `/api/v1/sos/webhooks/*`
  - `/api/v1/webhooks/*` (Razorpay / Apple)
- The dashboard's confirm dialog doesn't mention this.
- **Fix (decision needed, safety-critical):** recommended — exempt SOS routes and signature-verified provider webhooks, and add explicit warning text to the Ops toggle. Needs `safety-reviewer`.

### D9 — Medium — Tier override from the dashboard doesn't match the §K billing model

- **Evidence:** `PATCH /admin/users/:id/tier` updates only `User.tier` (`admin-users.service.ts`, `changeUserTier`). It does not:
  - create or update a `Subscription` row (`provider: manual`);
  - emit `tier_changed{reason: admin_override, by_admin_id}` (`phase4.md:1344`).
- **Result:** comped users are invisible to Billing and MRR, and the refund trigger returns `SUBSCRIPTION_NOT_FOUND` for them.
- **Role conflict in the docs:** `phase4.md:994` says super_admin only; `docs/admin-dashboard-plan.md:101` says super_admin + ops (the code follows the plan).
- **Fix:** write a `manual` Subscription row in the same transaction, emit the event, and pick one role rule.
- **Note for #174:** its lapsed-cancellation sweep only touches `cancelled` rows past their period end, so a `manual` row would also need a defined end date or an exemption.

### D10 — Medium — The queue viewer writes the admin access token into server logs

- **Evidence:**
  - `bull-board-auth.ts:69` accepts `?token=<admin JWT>` on the first visit.
  - pino-http logs the request's `url` and `query` (visible in the server's own log lines).
  - `logger.ts:12` redact paths don't include `req.query.token` or the URL.
  - The redirect strips the token from browser history, but the log line has already been written.
- **Impact:** an ops/super_admin token, valid 15 minutes, lands in shipped logs.
- **Fix:** add `req.query.token` to the redact list and strip `token=` from the logged URL in a custom serializer. Better: exchange the token for a one-time, short-lived ticket.

### D11 — Low — Duplicate legacy `/queues` handler

- **Evidence:** `admin.routes.ts:27-50` still has an older `/queues` interceptor. It sets a `bb_token` cookie **without `Secure` or `SameSite`**, converts that cookie into a Bearer header, and mounts the queue viewer a second time (super_admin only).
- `app.ts:167` mounts the real guarded handler first, so the legacy block only runs for unmatched sub-paths, where it fails authorization.
- **Fix:** delete lines 27-50 of `admin.routes.ts`. `bull-board.test.ts` must stay green.

### D12 — Low — 2FA hardening

- TOTP secrets are stored unencrypted (`admin-auth.service.ts:143`).
- No replay protection within the tolerance window.
- `confirmTotpEnrollment` does not re-check `active`. Low impact: every later request is still blocked by `requireAdminAuth`.
- No recovery codes; `phase4.md:132` defers these to "Phase 5".
- **Fix:** encrypt the secret with an env/KMS key, store the last used time-step, and add the `active` check.

### D13 — Low — Admin logins are not audited

- Only `lastLoginAt` is updated (`admin-auth.service.ts:104-107`).
- **Fix:** audit `admin.login_succeeded` and `admin.login_failed` (email only, never the password), plus 2FA failures.

### D14 — Low — Admin SPA quality gaps

- **Error boundary:** not forwarded to Sentry (`ErrorBoundary.tsx:33` TODO).
- **Tests:** the 16 tests cover only 3 UI primitives. There are no tests for login, `RoleGate`/`AccessDenied`, or any page.
- **Bundle:** still not code-split (per `admin-dashboard-progress.md`).
- **Fix:** add an admin Sentry DSN, and page tests for the RBAC-gated views and the login/2FA flow.

### D15 — Low — Phase 4 developer alerts are missing from the analytics registry

- **Evidence:** `phase4.md:1355-1373` defines `sos_delivery_rate` (PAGE), `sos_ivr_vendor_failover` (PAGE), `payment_webhook_invalid_signature` (PAGE), OCR failure rate, `tier_changed{refund}` rate, report latency, `food_search` p95 and others. The registry has 11 metrics, all from Phases 1–3.
- **Fix:** add registry entries (database or PostHog). The PAGE-level ones come first.

### D16 — Low — Domain and CORS inconsistency

- **Code:** `app.ts:60-65` allows `*.swasthparivar.com` only.
- **Docs:**
  - `phase4.md:1455` puts the admin SPA at `admin.swasthparivar.in`.
  - The runbooks use `api.swasth-parivar.in` (4 places) while other docs use `api.swasthparivar.com` (17 places).
  - `phase4.md:1456` describes a `CORS_ALLOWED_ORIGINS` env var that **does not exist**.
- **Impact:** if the admin SPA is deployed on `.in`, credentialed requests from it fail CORS.
- **Fix:** choose the canonical domains and make the allowlist env-driven.

### D17 — Info — Wrong comment on cookie lifetime

- `bull-board-auth.ts:36` says the 1-hour cookie "matches admin access token TTL", but `ACCESS_TTL` is 15 minutes (`admin-auth.service.ts:22`). Harmless: the expired token inside is simply rejected.

### D18 — Info — MRR is an estimate from hard-coded prices

- `admin-billing.service.ts` uses ₹199 (premium) / ₹399 (family). Confirm these match the Razorpay plans.

---

## 3. Findings outside the dashboard (found while reading every doc)

### X1 — High — Ops docs still use the removed `ADMIN_API_TOKEN`

> **✅ Fixed in #225 (2026-10-28).** The docs use `$ADMIN_JWT` from `scripts/admin-token.mjs` (admin login with 2FA).

`ADMIN_API_TOKEN` was removed in admin M0-T5, when admin auth became email + password + 2FA. These still tell ops to use `Authorization: Bearer $ADMIN_API_TOKEN`, which fails with 401 during an incident:

- `docs/ARCHITECTURE.md:338`
- `docs/HOWTO.md` (flag recipes, "Kill a misbehaving provider", "Switch OTP provider", "Generate an admin API token")
- `docs/SETUP.md:15` and its verification block
- `docs/runbooks/rollback.md` §2, §3
- `phase3.md` CC.8 (references `admin-auth.ts`)

**Fix:** rewrite them around the admin login flow, and add a small checked-in script that performs login + 2FA and prints an access token for curl use.

### X2 — High — The documented SMS kill switch does nothing

- `sms_msg91_enabled` (in `rollback.md` §3, `HOWTO.md` and the DR drill) is **read nowhere** in `apps/server/src`.
- **Fix (safety-critical):** either implement it in the SMS client with a safety review (critical-bypass SMS fallback semantics), or change the docs to a mechanism that exists.

### X3 — Medium — Flaky coverage gate: `apple-jws.test.ts`

- **Evidence:** `now` is captured when the test file loads (`apple-jws.test.ts:98`), but the 2-day certificates are created later in `beforeAll` (`:91-95`). When a second ticks over in between, the certificates count as "not yet valid". The broken-chain case is then rejected one step early, line 86 of `apple-jws.ts` goes unrun, and the 100% `subscription-state` threshold fails.
- **Observed:** 2 cold local runs failed; 8 of 8 warm runs passed. CI can hit this randomly.
- **Fix (test-only):** set `now` inside `beforeAll` after the certificates are created.

### X4 — Medium — The SOS drill runbook doesn't match the code

See D3. Rewrite §1 and §2 once D3 lands.

### X5 — Low — Stale docs

- `rollback.md` §2: maintenance guard "not yet implemented" (it exists).
- `SETUP.md` P3 #17: same claim.
- `admin-dashboard-progress.md`: last session 2026-06-13; still lists runtime rate limits as deferred (shipped in #102); no K.6 entry.
- `docs/admin-dashboard.md`: Activity/Sleep "pending".
- `audit-progress.md`: item 9 unchecked, though its own log shows it done.
- `CONTRIBUTING.md`: "Phase 1 (now)", "5 projects".
- `.claude/PROGRESS.md`: last updated May.
- `HOWTO.md`: flag-key rules (dots are allowed).
- `rollback.md` §4: references a missing `docs/runbooks/dr.md`.
- `phase4-progress.md` on `main`: stale until #174 merges.

### X6 — Low — Contradictions in the `.claude` tooling docs

- `/ship` says "Always end with the Co-Authored-By trailer", but `CONTRIBUTING.md` and the project convention forbid it.
- `new-module.md` and `api-patterns.md` rely on `express-async-errors` (CLAUDE.md forbids it) and cite paths that don't exist (`shared/errors.ts`, `req.id`).
- `git-workflow.md`, `figma-*.md` and `visual-assets.md` were copied from another project ("Jewelry" scopes, `git add -A`).
- `prisma-patterns.md` lists ActivityDaily/SleepLog as hypertables (`phase4.md` says they are not).
- `domain-logic-patterns.md`: test location is wrong (tests are colocated).

### X7 — Info — Flags are not namespaced per environment

`phase3.md` CC.12.7 #3 is not done. If staging and prod ever share a Redis, their flags collide.

### X8 — Info — Local environment note (2026-09-28)

The root `node_modules` was missing (cause external to the session). `pnpm install --frozen-lockfile` + `prisma generate` restored it, with no tracked-file changes.

---

## 4. App feature findings (pass 2 — patient + guardian app)

IDs use the `P` prefix so they don't clash with `phase6.md`'s own A1–A10.

### 4.0 Summary

| ID | Severity | Area | Finding (one line) |
|---|---|---|---|
| P1 | High | Critical bypass | A push to the patient's own phone counts as "delivered", so SMS to emergency contacts is skipped |
| P2 | High | Critical bypass | The fullscreen alert's "Call" button dials 112 ("Emergency"), not the priority-1 contact; no 60s auto-dial |
| P3 | High | Critical bypass | No fullscreen alert for a critical first reading (onboarding shows a trophy), cardiac/respiratory, or on push receipt |
| P4 | High | Critical bypass | BP critical-bypass (sys < 90 / dia < 60, sys > 180 / dia > 110) is not implemented |
| P5 | High | Critical bypass | If the alert enqueue fails after the reading is saved, the alert is lost for good (retry = replay) |
| P6 | High | Prescription scan | Approval authority is re-resolved live, so a patient who revokes the guardian can self-approve |
| P7 | High | Shared phone | Medicines, SOS, AI chat, dashboard chart/cache ignore the active profile |
| P8 | High | Offline | BP / cardiac / respiratory / meal "Saved locally" stores nothing; medicine taken/skipped is online-only |
| P9 | High | Offline | Glucose offline queue deletes readings on any 4xx, including the daily-cap 429 |
| P10 | High | Notifications | Server pushes use Android channels the app never creates → not displayed (reminders, medicines, guardian) |
| P11 | Medium | Notifications | Anti-fatigue, best-time, variants never update; no 2/day cap; notification taps not routed |
| P12 | Medium | Voice | Uncertainty / low-confidence / multi-number / past-tense results are ignored by the UI |
| P13 | Medium | Logging | Numpad always pre-selects Fasting; an uncertain type can be saved without a tap |
| P14 | Medium | Feedback | Critical-LOW reading shows "Thoda zyada hai. Paani peeyein."; festive shows "Shaabash" |
| P15 | Medium | AI chat | Typed emergencies (chest pain, breathlessness) are not detected; skip is glucose-only |
| P16 | Medium | AI chat → guardian | The chat-distress ("chat_sentiment") signal can never fire |
| P17 | Medium | Medicine scan | Bottle-scan has no app entry point; a mismatch is never shown to anyone |
| P18 | Medium | Medicines | Missed critical medicine never reaches the guardian |
| P19 | Medium | Guardian | Critical pushes follow emergency-contact rows, not family links (2nd guardian gets nothing; revoked one keeps getting them) |
| P20 | Medium | Guardian privacy | "Visible conditions" is cosmetic and hard-coded; accept silently deletes a contact; invite reveals names |
| P21 | Medium | Security | Logout is client-only: push token stays bound, refresh token can't be revoked, local data kept |
| P22 | Medium | Privacy | Phone numbers are logged unredacted (OTP + SMS paths) |
| P23 | Medium | Compliance | No account deletion or data export (DPDP; Play Store / App Store rules) |
| P24 | Medium | Security | Unused `/sync/push` bypasses glucose range validation |
| P25 | Medium | Analytics | 22 CLAUDE.md-required events are never emitted |
| P26–P33 | Low | Various | See 4.10 |
| P34 | Info | Ops | `seed-flags.ts` turns `sos_enabled` on — dev-only |

### 4.1 Critical bypass and emergency (safety-critical)

#### P1 — High — A push to the patient's own phone suppresses SMS to all emergency contacts

> **✅ Fixed in #198 (2026-10-25).** Also covers the shared-device case the safety review found: a sub-profile's auto-seeded primary contact is on the patient's own phone.

- **Evidence:**
  - `critical-alert.processor.ts:101,121-126` merges the patient's household tokens with guardian tokens.
  - `:245-246` sends SMS only if `pushSuccessCount === 0 || pushFailures.length > 0`. Same logic in the cardiac/respiratory branch (`:434-435`).
- **Failure case:** patient has a registered phone; emergency contacts don't have the app (their phones match no `User`). The only push goes to the patient's own device, it succeeds, so no SMS is sent. **Nobody outside the household is told.**
- **Also:** when SMS does fire, it goes to *all* contacts (`resolveSmsTargets(decision.smsTargets)`), not "only contacts where push failed" (CLAUDE.md Edge Case #3). There is no per-contact tracking.
- **Test gap:** `critical-bypass-chain.test.ts` has no "contacts without the app + patient device succeeds" case.
- **Fix:** decide SMS per contact: a contact is covered only if *their own* push succeeded. Patient/household devices never count as guardian delivery. Needs `safety-reviewer`.

#### P2 — High — The fullscreen alert's call button dials 112, not the priority-1 contact; no 60s auto-dial

- **Evidence:** `log.tsx:498-499` and `:655-656` pass `contactName="Emergency" contactPhone="112"`. `CriticalAlert.tsx` has no auto-dial timer (only the 30s lock and haptic pulse).
- **Spec:** CLAUDE.md step 4 + Edge Case #1: "60s: if patient hasn't tapped screen → auto-open dialer to priority_1 contact". The low-sugar copy says "[contact] ko call karein".
- **Impact:** the priority-1 contact, which the patient configured and the SOS chain uses, is never offered in the moment it matters most.
- **Fix:** load the priority-1 contact for the active profile (`GET /emergency-contacts?targetUserId=`, cached for offline); keep 112 as a second button or fallback; add the 60s auto-dial with any-tap cancel. Decision needed (see 8.6 #1).

#### P3 — High — The fullscreen critical alert only exists on the Log tab's glucose path

- **Onboarding first reading:** `first-reading.tsx:36-65` ignores `result.critical`. A first reading of 45 mg/dL shows the trophy "celebration" screen and celebrate haptic. At that point a self-onboarded user usually has no emergency contacts.
- **Cardiac / respiratory:** `log.tsx:335-345` and `:409-416` only call `track(...)` on a critical result. No fullscreen alert, no call button. The offline path has no local check at all.
- **Push receipt:** `notifications.ts:185-197` routes only `guardian_alert` and `guardian_daily_summary`. A tapped `critical_alert` push opens nothing specific, on the patient's or the guardian's phone.
- **Wrong code comment:** `critical-alert.processor.ts:94-96` says the patient-device push "is how CriticalAlert.tsx triggers". No such listener exists.
- **Fix:** one shared critical-alert host that is triggered by the log flows, onboarding, and a `critical_alert` push (with a guardian variant: "Call Papa").

#### P4 — High — BP critical bypass is not implemented

> **🔄 In progress (2026-10-26):** branch `feat/bp-critical-bypass`, rebased onto main after #202 merged. Its PR opens after the safety review passes.

- **Evidence:** `CriticalBypassCategory = "glucose" | "cardiac" | "respiratory"` (`packages/shared-types/src/readings.ts:197`). `bp.service.ts` only enqueues `ANALYZE_READING`. A BP of 220/130 raises no alert.
- **Spec:** CLAUDE.md "Phase 4 Invariants" threshold table (bp: sys < 90 OR dia < 60 / sys > 180 OR dia > 110) and `phase4.md` CC.15. `.claude/PROGRESS.md` records the Phase 2 deferral ("wait until Phase 3"), which was never closed.
- **Fix:** add a pure `bp-thresholds` classifier (100% branches), route it through `planMultiCategoryBypassDispatch` with its own cooldown key, and add the mobile fullscreen alert. Needs `safety-reviewer`.

#### P5 — High — A critical alert is lost if its enqueue fails after the reading is saved

> **✅ Fixed in #202 (2026-10-25).** Also bounds the Redis calls on the alert path. Both clients run `maxRetriesPerRequest: null`, so an outage made `queue.add` hang rather than fail.

- **Evidence:** `readings.service.ts:322` inserts the reading, then `:342` updates the streak, `:358` writes the feedback event, and only then `:370-377` enqueues the alert. If anything after the insert throws (e.g. Redis unavailable at `criticalQueue.add`), the client gets a 500.
- The app queues the reading and retries it (`mobile readings.ts:183-196`). The retry hits the replay branch (`readings.service.ts:145-149`), and `buildReplayResult` (`:86-131`) never enqueues. There is no cron fallback, although CLAUDE.md "Fallback Mechanisms" requires "BullMQ stuck → cron fallback for critical".
- **Fix:** mark critical readings `alertPending` in the same write and clear it in the worker. A short cron re-dispatches pending rows. Or: on replay, re-enqueue when no dispatch record exists (idempotent `jobId` per reading). Safety-critical.

#### P6 — High — Prescription approval authority is re-resolved live instead of using the frozen snapshot

> **✅ Fixed in #200 (2026-10-25).** Uses the recommended §8 decision: park the prescription until a guardian exists.

- **Evidence:** `loadPrescriptionForApprover` calls `resolveApproverForUser(prescription.userId)` on every write (`prescriptions.service.ts:1013-1035, 1073-1102`). The stored `requiresGuardianApproval` snapshot is never enforced. The header comment (`:11-16`) says authority is "frozen".
- **Failure case:** guardian required at upload; the patient's household then revokes the family link (allowed for the patient side, `family.service.ts:222-236`). The resolver now returns the patient as a "solo" approver, and the patient can approve.
- **Spec:** CLAUDE.md: "resolved at upload, immutable afterwards … Wrong medication kills. So the guardian — not the patient — approves." `phase4.md` F.2: "a guardian being removed mid-approval can't suddenly drop authority back to the patient".
- **Test gap:** `prescriptions.test.ts` has no revoke-mid-approval case.
- **Fix:** if `requiresGuardianApproval` is true, only an accepted guardian (child/spouse/caregiver) may approve. If none remains, park the prescription as "needs a guardian" and never fall back to the patient.

### 4.2 Offline and data integrity

#### P8 — High — "Saved locally" is false for BP, cardiac, respiratory and meals; medicine logging is online-only

> **Half fixed in #227 (2026-10-28):** BP, cardiac, respiratory and meals are now stored in an offline queue and sent later; the glucose "rejected" copy is honest. **Still open:** medicine taken/skipped (needs server idempotency first).

- **Evidence:**
  - `bp.ts:70-79`, `cardiac.ts:105`, `respiratory.ts:113`, `meals.ts:64` return `{ kind: "queued" }` without storing anything. The UI says "Locally save ho gaya — sync hone par update hoga" (`i18n bp/cardiac/respiratory.savedOffline`; meals use `logging.savedOffline`).
  - An offline critical cardiac/respiratory reading reaches nobody.
  - Medicines tab: `medications.tsx:95-114` posts taken/skipped directly. Offline → error, nothing queued. The WatermelonDB `medication_logs` table is unused.
  - The glucose "rejected" copy "Save nahi ho paya — data locally safe hai, sync baad mein hoga" (`log.tsx:249`) is also false: 4xx rejections are not stored (`readings.ts:160-181`).
- **Impact:** medical readings silently lost. A patient who takes medicine while offline is later marked `missed_no_response` (`med-reminder.worker.ts:129-136`). That feeds the Silent Guardian `med_adherence` signal → false guardian alert.
- **Fix:** queue these writes in WatermelonDB (one additive schema bump, `db-reviewer`) and drain them like glucose. Until then, change the copy to "not saved, please retry".

#### P9 — High — The glucose offline queue deletes readings on any 4xx, including the daily-cap 429

> **✅ Fixed in #226 (2026-10-28).** The safety review found worse: every queued reading drained with `"notes": null`, got a 400 and was deleted. The server now accepts it.

- **Evidence:** `drainPendingReadings` calls `markAsDeleted()` for every 400–499 response (`readings.ts:259-274`). The free-tier daily cap is counted per server UTC day at drain time (`readings.service.ts:50-55, 160-173`) and returns 429 (`error-handler.ts:63-65`). A failed token refresh returns 401.
- **Failure case:** 7 days offline at 3 readings/day = 21 queued. On reconnect, reading 21 gets 429 and is deleted. The same happens after a 30-day refresh expiry (401), or if the per-minute limit (100/min) is hit while draining a large backlog.
- **Fix:** delete only on 400/409/422. Keep and back off on 401/403/429. Server: count the daily cap by the reading's `measuredAt` day, or exempt `clientUuid` replays of old readings.

#### P24 — Medium — The unused `/sync/push` bypasses glucose validation

- **Evidence:** `sync.routes.ts:9-26`: `valueMgDl: z.number().int()` with no 20–600 range, no `notes` max, no batch cap. `/pull` (`:61-80`) is unbounded. The app never calls either route. The real route validates range (`readings.validation.ts:6`).
- **Impact:** an authenticated client can store 0, −5 or 99999, which triggers false critical alerts (SMS to contacts) and corrupts detectors/HbA1c.
- **Fix:** reuse `createGlucoseReadingSchema` and cap the batch, or remove the dead routes.

### 4.3 Shared-phone profiles

#### P7 — High — Several flows ignore the active profile and act on the household primary

CLAUDE.md "Data Corruption Prevention" requires every save to go to the active profile. These flows use the JWT subject (the primary) instead:

| Flow | Evidence | Effect when "Maa ji" is active on Papa's phone |
|---|---|---|
| Medicines | `medications.controller.ts:6-43` uses `req.auth.sub` only; `medications.tsx:51,83,99,276` never send `targetUserId` | Maa's medicines are saved under Papa. Medicines approved from Maa's prescription are invisible on the tab and can't be marked taken → always "missed" |
| SOS | `sos.controller.ts:7`; `sos.validation.ts:7-23` and mobile `sos.ts:46-53` have no `targetUserId` | The SOS event, contact chain, SMS/IVR name and readings snapshot are Papa's. `phase4.md:82,287` claims the locked profile is the SOS identity |
| AI chat | `chat.controller.ts:32` | Maa's question is answered with Papa's readings and conditions; a critical reading of Maa's does not trigger the chat emergency skip |
| Dashboard trend chart | `dashboard.tsx:185` calls `/readings/glucose` without `targetUserId` | Papa's 14-day chart shown under Maa's badge |
| Dashboard offline cache | one key `swasth.dashboardCache.v2` (`dashboard-cache.ts:74`); `dashboard.tsx:114-133` | Offline or on fetch failure, the previous profile's numbers stay on screen under the new badge |
| Prescription approval | solo approver = the sub-profile's own id (`prescriptions.service.ts:1023-1035`), which never holds a JWT | A sub-profile with no remote guardian can upload but nobody can ever approve (fails closed, no safety risk) |
| Streaks | `streaks.routes.ts:11,16` | Returns the primary's streak |

- **Fix:** one PR per row, each using `resolveHouseholdMember(auth, targetUserId)` exactly like readings/meals already do. Key the dashboard cache by profile id.

### 4.4 Notifications and habit loop

#### P10 — High — Server pushes use Android channels the app never creates, so Android doesn't display them

> **✅ Fixed in #203 (2026-10-25).** Confirm on an Android device with one test push per channel after merge.

- **Evidence:** the app creates only `default` and `critical` (`notifications.ts:44-57, 97-110`; no channel config in `app.json`). The server sends:
  - `reminders` — `notification-trigger.worker.ts:258` (all habit-loop reminders)
  - `medications` — `med-reminder.worker.ts:81`
  - `guardian` — `guardian-alert-dispatch.processor.ts:137`, `daily-guardian-summary.processor.ts:79`
- **Expo docs** (push message format, `channelId`): "If an ID is specified but the corresponding channel does not exist on the device … the notification will not be displayed to the user."
- **Not affected:** critical alerts and SOS (`critical` exists), appointment reminders (`default`), and on-device local medicine reminders.
- **Unverified:** not reproduced on a physical Android device in this pass. Confirm with one test push per channel.
- **Fix:** create `reminders`, `medications` and `guardian` channels at startup, before registering the token.

#### P11 — Medium — Anti-fatigue, best-time and message variants never update; no daily cap; taps not routed

- **Evidence:**
  - `recordIgnored`, `recordOpened` and `recoverFatigueOn2DayLogStreak` (`resolver.ts:85-108`) are never called by server code, and the app sends no open/ignore signal. `consecutiveIgnores` and `fatigueLevel` stay 0 forever.
  - `FATIGUE_DAILY_CAP_AT_LEVEL = [Infinity, Infinity, 1, 0]` (`resolver.ts:12`): no daily cap at levels 0–1. CLAUDE.md: max 2/day; 3 ignores → 1/day; 5 → every other day; 7 → stop. Even with the counters wired, 3 ignores would change nothing and 5 would give 1/day.
  - `bestLogTimeFasting` / `bestLogTimePostMeal` are never computed (always the schema defaults 07:00 / 13:30). The 20:30 default is missing.
  - `best_time` fires even if the user already logged today (`notification-trigger.worker.ts:98-112`). `variant_id` is always `null`; no 5-variant pool.
  - Taps: `routeFromNotificationData` (`notifications.ts:185-197`) doesn't route medicine reminders (→ Medicines) or reading reminders (→ Log with mic).
- **Impact:** once P10 is fixed, a user can receive up to 4 non-medicine pushes a day with no back-off. That is the "7 ignores → stop" failure CLAUDE.md is built to prevent.
- **Fix:** report opens from the app (the push data already has `notificationId`); count ignores in the trigger job; set the cap table to CLAUDE.md values; compute best time from a rolling 5-day average.

#### P25 — Medium — 22 required analytics events are never emitted

- **Never emitted anywhere in `apps/`:** `notification_opened`, `notification_ignored`, `app_opened`, `medicine_taken`, `medicine_missed`, `profile_switched`, `critical_alert_cooldown_hit`, `critical_alert_escalation_triggered`, `critical_alert_auto_call_triggered`, `critical_sms_per_contact`, `extreme_value_double_confirm`, `voice_past_tense_rejected`, `voice_uncertainty_detected`, `type_inference_uncertain`, `profile_switch_recent_confirm`, `grace_limit_reached`, `offline_banner_shown`, `festive_tag_disabled`, `med_setup_removed`, `time_manipulation_detected`, `first_failure_help_shown`, `notification_variant_sent`.
- **Impact:** CLAUDE.md developer alerts and derived metrics (notification→open rate, time manipulation, per-contact SMS) cannot be computed. The admin `retention` metric queries `app_opened`, which never arrives.

### 4.5 Logging UX: voice, reading type, feedback

#### P12 — Medium — The voice parser's safety signals are ignored by the UI

- **Evidence:**
  - The parser returns `candidates`, `requiresStrongConfirmation`, `uncertaintyDetected`, `requiresDoubleConfirmation` and rejection `reason`s (`voice-parser/types.ts:15-29`). `log.tsx:164-172` uses only `value`, `readingType` and `requiresTypeConfirmation`.
  - So: no "Aap SURE hain?" step for "shayad 140" or confidence < 0.6; no selection UI for two numbers (top rank used silently); no "Yeh kal ki reading lag rahi hai" message (rejections just count toward the 2-fail numpad fallback).
  - `VoiceInputNative.tsx:154`: when the engine reports no confidence, it assumes 0.85, so the low-confidence path can't trigger on those devices.
  - Profile lock: released on the speech `end` event (`VoiceInputNative.tsx:81-85`), before confirmation. The save uses whoever is active at save time (`log.tsx:76,183-196`), and a notification tap can switch profile then (`notifications.ts:171-179`). CLAUDE.md Edge Case #9: "Reading saved to locked_user_id always."
- **Fix:** carry the parse flags into `ConfirmationScreen`; add the candidate picker and rejection copy; keep the lock until confirm/cancel and save to the locked id.

#### P13 — Medium — Reading type defaults to Fasting; an uncertain type can be saved without choosing

- **Evidence:** `handleNumpad` always sets `type: "fasting"` (`log.tsx:174-177`), at any hour. `ConfirmationScreen` pre-selects it (`:58`) and the confirm button never waits for an explicit choice (`:244-261`). Onboarding does the same (`first-reading.tsx:133-134`).
- **Spec:** CLAUDE.md Edge Case #8: "IF uncertain: do NOT auto-select … Require explicit selection before save."
- **Impact:** evening post-meal readings get saved as Fasting, which breaks the same-type feedback and the spike/trend/HbA1c inputs.

#### P14 — Medium — Wrong post-save copy for critical-low and festive readings

- **Evidence:**
  - A critical reading gets `tone: "gentle_warn"` (`feedback-engine/engine.ts:43-51`). The app shows `feedback.gentle_warn` (`log.tsx:201`) = "Thoda zyada hai. Paani peeyein." (`hi.json:130`), **even for 45 mg/dL**, under the fullscreen alert that says "eat something sweet".
  - Festive turns `gentle_warn` into `celebrate` (`engine.ts:89`) → "Shaabash! Pichli baar se behtar." for a *higher* reading. CLAUDE.md test spec: "gentle_warn → neutral when festive" + "Diwali hai! Enjoy karein".
  - Variants never rotate: `recentVariantIds: []` (`readings.service.ts:251`), and the app ignores `messageKey`.
- **Fix:** give critical its own low/high copy key; map festive to neutral + festive copy; pass recent variant ids.

### 4.6 Medicines and medicine scan

#### P17 — Medium — The medicine-bottle scan has no app entry point and its result reaches no one

- **Evidence:**
  - The mobile `addMedicinePhoto` (`services/prescriptions.ts:194`) is never called by any screen.
  - The worker writes `matchStatus` only (`medicine-photo-cross-check.processor.ts:101-116`): no push, no in-app card, no guardian notice on `mismatch`.
  - It emits `prescription_ocr_completed` instead of `medicine_photo_cross_check{match_status}`.
  - It is gated by `prescription_ocr_enabled` read as a plain boolean (same class as D3).
- **Impact:** "the bottle in the cabinet is not the prescribed drug" is detected but visible only in the admin console.
- **Fix:** add "Dawai ki photo se check karein" on each medicine card; show mismatch to the approver/guardian (flag only, no auto-action, per spec).

#### P18 — Medium — A missed critical medicine never reaches the guardian

- **Evidence:** `med-reminder.worker.ts:138-141` only logs "critical med missed". CLAUDE.md BullMQ: "MED_MISSED_ALERT: 1hr after → guardian if critical". Already recorded as `phase6.md` A1 / §6.0 (free safety feature).
- **Related:** the missed check only looks for a response between −30 and +65 minutes around the reminder (`:114-125`). A dose marked taken more than 30 minutes early is also recorded as missed.

### 4.7 AI chat and what it extracts from chat

#### P15 — Medium — AI chat does not detect typed emergencies

- **Evidence:** the emergency skip checks only for a glucose `critical_warn` feedback row in the last 30 minutes (`chat.service.ts:393-406`). `ChatIntent` has no emergency intent (`shared-types/src/chat.ts:22-27`). Cardiac/respiratory critical readings write no `critical_warn`, so they don't count. The canned reply says "call your doctor", not the emergency contact or SOS.
- **Failure case:** "seene mein dard hai, saans nahi aa rahi" gets a normal template or AI answer.
- **Spec:** CLAUDE.md AI Chat Safety #6: "Emergency → skip chat, trigger SOS guidance."
- **Fix:** a pure emergency-phrase classifier (Hindi / Hinglish / Devanagari, 100% branches) that runs before routing; reply with the priority-1 call button, SOS and 112; also include cardiac/respiratory critical readings.

#### P16 — Medium — The chat-distress signal ("chat_sentiment") can never fire

- **Evidence:** Silent Guardian counts patient messages with `flagged = true` (`silent-guardian-analyze.processor.ts:229-234, 301-317`). But patient (`role: "user"`) rows are never flagged: only assistant rows are, by the safety filter or the 🚩 button (`chat.service.ts:501-530, 349-370`). `distressedTurns` is always 0.
- **Spec and docs:** `phase4.md` C'.1 specifies a pure `chat-sentiment-classifier/`; it does not exist. `phase4.md:77` marks the signal "✅ Landed". There is no server test for this signal.
- **Privacy (checked, fine):** only counts are stored; no chat text goes to guardians.
- **Fix:** classify patient turns with a pure distress-keyword module and store counts only (keep the "no verbatim chat" property test).

### 4.8 Guardian / family flow and privacy

#### P19 — Medium — Guardian critical pushes follow emergency-contact rows, not family links

- **Evidence:** push targets are emergency contacts with `isGuardian` (`bypass.ts:35-38`), matched to users by phone (`critical-alert.processor.ts:106-119`). Accepting an invite seeds a priority-1 contact only if none exists (`family.service.ts:146-150`). Revoking a link never touches that contact (`:231-236`).
- **Failure cases:**
  1. A second accepted guardian gets no critical push unless someone adds them as a contact by hand.
  2. A revoked guardian (e.g. an estranged relative) keeps receiving critical alerts with glucose values, SMS, and SOS calls.
- **Fix:** add accepted guardians with alerts on to the push targets; on revoke, ask the patient whether to remove the seeded contact. Decision needed (8.6 #3).

#### P20 — Medium — Guardian privacy gaps

- **"Visible conditions" is cosmetic:** it filters only the condition labels. `bpLatest`, the latest glucose, the summary, medicines and health score are still returned (`family.service.ts:419-476`). The app hard-codes `visibleConditions: ["diabetes"]` with no user choice (`InviteGuardianForm.tsx:58`).
- **Accept deletes a contact silently:** when the patient already has 5 contacts, accept deletes the lowest-priority one without telling the patient (`family.service.ts:164-171`).
- **Invite reveals names:** the invite endpoint tells any signed-in user whether a phone number is registered and returns that account's name (`family.service.ts:46-60, 106`).

### 4.9 Security, privacy and compliance

#### P21 — Medium — Logout is client-only

- **Evidence:** `auth.store.ts:31-43` clears SecureStore, the dashboard cache and the profile store only. There is no server logout route. The push token stays bound to the logged-out user (`auth.service.ts:242-264`), so the device keeps receiving their critical alerts (with glucose values), guardian alerts and reminders until someone else logs in. The refresh token is a stateless 30-day JWT and can't be revoked (`:191-195, 266-304`). Local WatermelonDB readings and chat cache are not wiped.
- **Fix:** add `POST /auth/logout` that deletes this device's push token and bumps a per-user `sessionVersion` (same pattern proposed for admins in D5); wipe the local DB on logout.

#### P22 — Medium — Phone numbers are logged unredacted

- **Evidence:** the redact list uses `"*.phone"` (`logger.ts:12-27`), which matches only nested keys. Checked with the repo's `pino`: `logger.info({ phone })` prints the number; `{ user: { phone } }` is redacted.
- **Affected lines:** every OTP request (`auth.service.ts:81, 91-98, 119-127`) and SMS/WhatsApp failures, including emergency-contact numbers (`msg91-sms.ts:19,41,46,64,82,87`; `whatsapp.ts:75,80`).
- **Doc conflict:** `docs/ARCHITECTURE.md:134` says phone is never logged.
- **Fix:** add top-level `phone` (and `err.config.data` if needed) to the redact list, plus a unit test.

#### P23 — Medium — No account deletion or data export

- **Evidence:** no route in `users`/`auth` and no mobile UI. `phase4.md` CC.16 expects `user-deletion-cascade.test.ts`, which does not exist. The schema cascades are in place but nothing triggers them.
- **Impact:** DPDP erasure requests can't be served. Google Play and the App Store require in-app account deletion for apps with sign-up (store-launch blocker).

### 4.10 Low / hygiene

- **P26 — Hardcoded IST day boundary.** `readings.service.ts:80,230`, `notification-trigger.worker.ts:66-70` and the grace-reset cron use IST instead of `User.timezone`. `PATCH /users/me` can change `timezone` at any time (`users.service.ts:46`); CLAUDE.md says it is pinned at onboarding.
- **P27 — Thresholds defined in several places.** `readings.service.ts:44-45` and the mobile literals `< 65` (`log.tsx:224,245`) redefine the thresholds instead of importing `GLUCOSE_CRITICAL_*` (safety-reviewer checklist: "defined in ONE place").
- **P28 — Profile safety prompts.** The profile store isn't persisted, so on a cold start `lastActiveAt` is null and the 30-minute selector never shows (`useProfileInactivity.ts:11-17`). The recent-switch warning is text only, with no required "Haan" tap (`ConfirmationScreen.tsx:117-121`; CLAUDE.md Edge Case #10).
- **P29 — Undo / edit gaps.** No undo for offline saves (`log.tsx:632`). A failed undo is silently ignored and the local copy remains (`:640-643`). The "tap last reading → edit" flow and the `reading/[id]` route don't exist.
- **P30 — "Notifications off" toggle.** It silences only on-device reminders; server reminder pushes ignore `UserPreferences.notificationsEnabled`. This is deliberate per `phase4-progress.md`, but conflicts with CLAUDE.md Edge Case #17. Decision needed.
- **P31 — Medicine log validation.** `POST /medications/log` accepts any `scheduleId` without an ownership check (`medications.service.ts:44-54`). `?days=` on adherence is unvalidated and unbounded (`medications.controller.ts:40-43`).
- **P32 — No "Call patient" button** on the guardian alert detail or patient dashboard (`phase3.md` M.3).
- **P33 — Old offline readings alert as new.** A critical reading that syncs hours later triggers a live-looking alert: the decision uses the current time (`readings.service.ts:269-278`) and the copy doesn't say when the reading was taken. **Fix in #228 (open):** late notice, no cooldown, no escalation.
- **P34 — Info — dev seed enables features.** `prisma/seed-flags.ts:14-28` sets `sos_enabled`, `ai_chat_enabled` and `silent_guardian_enabled` to true. It is labelled a dev bootstrap; never run it against production.

### 4.11 Doc drift found in pass 2

- `phase4.md:77`: chat_sentiment "✅ Landed" → inert (P16).
- `phase4.md:82, 287`: SOS carries the locked profile's identity → it carries the primary's (P7).
- `critical-alert.processor.ts:94-96`: claims the push triggers `CriticalAlert.tsx` (P3).
- `prescriptions.service.ts:11-16`: claims approver authority is "frozen" (P6).
- `docs/ARCHITECTURE.md:134`: "never logs phone" (P22).
- Header comments in `bp.ts`, `cardiac.ts`, `respiratory.ts`: "next pull-to-refresh resyncs" — nothing was stored (P8).
- `apps/mobile/CLAUDE.md` "On notification tap" routes don't exist (P11).

---

## 5. What was checked and found correct (do not "fix")

**Admin (pass 1):**

- Every admin **mutation** writes an `AdminAuditLog` row: flags set/rollback/cohort; admin create/update/reset; user tier, deactivate, reactivate, doctor, appointment and test-push; maintenance; refund. Sensitive registry panels write `patient_data_viewed`.
- Role gates on every admin write route match the plan's matrix (except D9's doc conflict).
- Deactivating an admin takes effect on the next request (`requireAdminAuth` loads the account each time).
- Refresh cookie: `httpOnly`, `SameSite=strict`, path-scoped, `Secure` in production. Login uses a timing-equalized bcrypt check plus `authRateLimit`.
- Admin JWT secrets are required in production (`env.ts:198-199`).
- Ops queue table and the queue viewer both read the full queue list automatically, so new queues appear without changes.
- The maintenance mode exemption for `/admin` means ops cannot lock themselves out.
- Medical constants (thresholds, bypass chain, cooldown, 3 AM boundary) cannot be reached through flags.

**App (pass 2):**

- Glucose thresholds are hardcoded; the 64/65 boundary is tested (`critical-bypass-chain.test.ts:413`). Critical values skip the daily readings cap (`readings.service.ts:160-162`).
- Glucose POST idempotency: equal version = replay without side effects, older = 409, concurrent create (P2002) = replay.
- Log-tab critical alert: 30s lock, hardware back blocked, haptic pulse, `tel:` sanitised.
- Extreme values: 3-second confirm delay and red banner on the confirmation screen; festive toggle hidden for critical values.
- Household authorisation (`resolveHouseholdMember`) is applied on readings, meals, insights, HbA1c, health score, dashboard, emergency contacts, schedules, prescriptions, doctors, appointments, reports, activity and sleep.
- Emergency contacts: 5-contact cap, dense priorities, household check on update/delete.
- Guardian dashboard and Silent Guardian endpoints require an accepted link; alert reads are ownership-checked with no existence oracle; phone, notes and photo are stripped from the guardian view.
- Auth: OTP is HMAC-hashed with a 5-attempt limit; the `000000` bypass works only in `development`; Firebase ID tokens are verified with `checkRevoked`.
- AI chat: medication questions go to a template redirect; the post-response safety filter runs on every AI answer; flagged turns are never replayed into prompts; patient context excludes phone and household ids.
- Prescriptions: > 6 doses/day forces `needs_doctor` on approve and manual add; GREEN still needs an explicit approve; approved/rejected prescriptions are locked; the mobile solo-approval friction (3s re-confirm) exists.
- SOS test mode defaults to true in code (`sos.service.ts:127`).

---

## 6. Safety rules for the fix work ("do not break existing things")

1. **One finding per PR**, based on `main` (not stacked), each with a test that fails before the fix and passes after it.
2. **Safety-critical items need two reviewers plus `safety-reviewer`** (CODEOWNERS): D3 (SOS parts), D8, X2, **P1–P7, P15, P18, P19**.
3. **Backward compatibility for flags (D3):** plain `true`/`false` must behave exactly as today. Add integration tests for boolean ON/OFF **and** cohort in/out at the API for each migrated service. Don't change any default.
4. **Read-only additions first:** registry entries (D7), metrics (D15), analytics events (P25) and docs (X1, X5, X6, 4.11) change no behaviour.
5. **Schema changes** (D5 `sessionVersion`, D9 manual Subscription, P5 alert-pending marker, P21 patient session version) must be additive with defaults, pass squawk, and keep schema↔migration parity. D5/P21: tokens without the new claim are treated as version 0, so nobody is logged out on deploy.
6. **Privacy changes (D4, P20, P22)** keep full access for support and above; only analyst output changes. Update the admin integration tests to match.
7. **Mobile local-DB changes (P8, P9)** are one additive WatermelonDB schema bump with `schemaMigrations` wired in, reviewed by `db-reviewer`. Never reset existing local data.
8. **Profile-targeting fixes (P7):** when `targetUserId` is absent, behaviour must stay byte-identical (acts on the JWT subject). Add a household test per endpoint.
9. **Critical-bypass changes (P1–P5)** must keep the existing `critical-bypass-chain.test.ts` cases green and add the new failure-case tests named in each finding.
10. **Run the full gate before every push:** `bash scripts/preflight.sh`, plus `--full` for server changes.

---

## 7. Suggested order

| Wave | Items | Risk |
|---|---|---|
| 1 — zero risk | X1, X5, X6, 4.11 docs; X3 test fix; D16 domain decision; D17 comment; P10 (create Android channels); P22 (redact); P25 (events) | None–low (docs, tests, additive config) |
| 2 — patient safety, server | P1, P5, P6, P4, P19 | Medium — two reviewers + `safety-reviewer` |
| 3 — patient safety, app | P2, P3, P8, P9, P14, P15, P13 | Medium — `mobile-ux-reviewer` + `safety-reviewer` |
| 4 — shared phone | P7 (one PR per row), P12, P28 | Medium — household tests per endpoint |
| 5 — dashboard correctness | D1, D2, D7, D15, D6 (catalog) | Low (read paths + new UI) |
| 6 — security / privacy | D4, D10, D11, D5, D12, D13, D14, P21, P20, P24, P23 | Low–medium (auth paths) |
| 7 — habit loop + features | P11, P16, P17, P18, P26, P27, P29–P33 | Low–medium |
| 8 — flags / ops safety | D3, D8, X2, D9, then X4 runbook rewrite | Medium — two reviewers + `safety-reviewer` |

---

## 8. Open decisions (product owner)

1. **Canonical domains** for the API and admin SPA (`.com` vs `.in`) — D16.
2. **SOS/webhook exemption from maintenance mode** — D8.
3. **Who may override a tier:** super_admin only, or super_admin + ops — D9.
4. **Analyst view of phone numbers:** masked, or hidden entirely — D4.
5. **`sms_msg91_enabled`:** implement it, or remove it from the docs — X2.
6. **App (pass 2):**
   1. **Critical-alert call target:** priority-1 contact with 112 as second button (recommended), or 112 only — P2.
   2. **Guardian removed mid-approval:** park the prescription until a guardian exists (recommended), or allow the patient with solo friction — P6.
   3. **Revoked guardian:** automatically remove their seeded emergency contact, or ask the patient — P19.
   4. **Daily reading cap and offline backlog:** count by `measuredAt` day (recommended), or exempt drained readings — P9.
   5. **"Notifications off" toggle:** also silence server reminders, or keep the current behaviour — P30.

---

## 9. Cross-impact on `phase6.md` (not yet edited there)

Phase 6 is push-heavy and builds on these paths. Fold them into `phase6.md` "Audit findings" / Sequencing step 1 when approved:

- **P10:** every Phase 6 channel (including the planned `family-quiet`) must be created by the app, or its pushes won't show on Android.
- **P11:** R7 "Fatigue budgets hold" depends on fatigue counters that currently never change.
- **P7 (medicines row):** the §6A missed-dose ladder would target the wrong profile on shared phones.
- **P8 (medicine logging offline):** false `missed_no_response` rows would trigger false family nudges and L2 guardian alerts.
- **P3 (push routing):** §Mobile push routing needs a real handler; today only two notification types are routed.

---

## 10. Addendum — 2026-10-20 (device install + branch sweep)

`main` was still at `82a08fe`, so every finding above stands. New items found while installing a debug build on a physical Android device and sweeping every remote branch:

| ID | Severity | Finding | Status |
|---|---|---|---|
| X9 | High | **Mobile app cannot load on `main` since #164.** `subscription-state` (imports `node:crypto`) was re-exported from the domain-logic root barrel, which the React Native bundle imports; Metro fails with "You attempted to import the Node standard library module node:crypto". | Fixed in #177 (server-only subpath export + purity guard that walks the barrel's import graph). **Merge before #174**, which imports from the root barrel. |
| X3 | Medium | Flaky `apple-jws` coverage ratchet (above). Root cause confirmed: `now` captured before the certs exist; reproduced deterministically by forcing a second-boundary crossing. | Fixed in #176. |
| X10 | Low | `defaultRateLimit`'s IP fallback key (`rate-limit.ts:57`) uses raw `req.ip`; express-rate-limit logs `ERR_ERL_KEY_GEN_IPV6` at boot. An unauthenticated IPv6 client can rotate addresses inside its /64 to dodge the per-minute ceiling. | Open — use the library's `ipKeyGenerator` helper for the fallback. |
| X11 | Medium | **Orphaned PR #97** (household tier + per-tier member cap, 24 files). It merged into its stacked parent 24 s after the parent (#96) squash-merged to `main`, so it never landed: `Household` has no `tier`, `household.tier.service.ts` / `tier-caps.ts` don't exist. §K later put tier on `User`, so it can't be cherry-picked as-is. | Open — decide: redesign on top of §K (relates to `phase6.md` A3) or drop. |
| X12 | Low | **Orphaned deploy docs** `a10f2a9` (`docs/deploy-digitalocean.md` + `apps/server/docker-compose.prod.yml`) were pushed to `chore/quality-gate-hardening` after #23 merged and never reached `main`. | Open — cherry-pick onto a fresh branch if still wanted. |

Branch sweep result: of 97 remote branches ahead of `main`, everything else is either already in `main` (squash-merged) or superseded by later work. Local-only leftovers (`chore/phase4-plan-status-update`, `phase4/sos-mobile-ui-local`, unpushed commits on `feat/mobile-ux-polish-round-2`, 9 stashes) contain nothing that isn't superseded.
