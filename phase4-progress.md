# Phase 4 — Live Progress Board

> **Companion to `phase4.md`** (the original spec). This file tracks what's done, what's in flight, and what's next. Update on every merged PR. The spec stays canonical for HOW things should be built.
>
> Last updated: **2026-06-03** (Phase 1/2 corrigenda + DX polish session — working tree, not yet PR'd).

---

## TL;DR — where we actually are

| Track | State | Next concrete action |
|---|---|---|
| **Carry-over from Phase 2, Phase 3, Admin** | ✅ Code-complete | None — see "operational close-out" below |
| **Phase 1 corrigendum: emergency contacts** | 🟡 Server done (#115), mobile management screen + onboarding priority-1 seeding still pending | Build Settings → Emergency contacts screen + wire guardian-assisted onboarding to seed priority-1 row |
| **Preferences backend persistence** | ✅ Server + mobile wired (working tree, 2026-06-03) | Land via PR + verify cross-device sync on a real install |
| **checkFrequency local reminders** | ✅ Wired (working tree, 2026-06-03) | Land via PR |
| **Cold-start test users** | ✅ Seed script live, 6 free-tier users at days 0/3/7/13/7/35 (working tree, 2026-06-03) | Land via PR |
| **Rate-limit alert UI** | ✅ Glucose log surface shows prominent card on 429 (working tree, 2026-06-03) | Land via PR |
| **Brand assets** | ✅ Real icon/splash/notification PNGs regenerated; fixes square-notification bug (working tree, 2026-06-03) | Rebuild via EAS to ship to device |
| **Dark mode on log surfaces** | ✅ Invisible-text bugs fixed on numpad / BP field chips / confirmation warnings (working tree, 2026-06-03) | Land via PR |
| **HbA1c response-shape type** | ✅ Mobile type aligned to domain-logic source of truth (working tree, 2026-06-03) | Land via PR; consider promoting `HbA1cEstimate` to `@swasth/shared-types` so this can't recur |
| **SOS ramp** | 🟡 Code-complete, needs operational soak | Provision vendor creds → 7-day test-mode soak → first drill → flag flips |
| **Push delivery hardening** | ✅ Diagnostic + auto-prune + per-user rate-limit keying landed (#113, #114, #112) | Verify the Expo token / projectId pairing in prod once #114 prunes the dead tokens |
| **UI polish + dark mode + new settings** | ✅ Antigravity rollup (#117-121) cleaned up + shippable in #118 | Visual click-through on Light/Dark/System across all screens before EAS build |
| **Feature E — Multi-condition health logs** | ❌ Not started (Week 14 target) | Cardiac + respiratory schema migration |
| **Feature F — Prescription OCR** | ❌ Not started (Week 15-16) | Spec is in `phase4.md §F.1`; needs Claude Vision spend cap wiring |
| **Feature G — Doctor portal** | ❌ Not started (Week 17) | — |
| **Feature H — Indian food DB** | ❌ Not started (Week 18) | — |
| **Feature I — Wearables** | ❌ Not started (Week 19-20) | Blocks `activity_drop` SG signal from going live |
| **Feature J — Festival nudging + regional languages** | ❌ Not started (Week 21) | — |
| **Feature K — Payments (Razorpay + Apple IAP)** | ❌ Not started (Week 22) | Requires `User.active` (already shipped) for abusive-user suspension |
| **Week 23 — Hardening + DR drill + beta ramp** | ❌ Not started | — |

---

## What shipped (chronological — keeps the source of truth out of the spec)

Earliest first within each cluster; most recent cluster last.

### Phase 2 carry-over (Week 13)
- PR #92 (2026-05-28) — `HealthCheckSchedule` + `HealthCheckCompliance` schema + pure `schedule-compliance/` module + cron + admin / CRUD endpoints.
- PR-A (2026-05-30) — Server slice: `/api/v1/schedules` CRUD, `SCHEDULE_COMPLIANCE_CHECK` BullMQ cron, kill switch, integration tests.
- 🟡 **Still pending**: mobile schedule editor + adherence widget (separate PR alongside doctor-portal UI). Doctor portal adherence column depends on Feature G.

### Phase 3 carry-over — Silent Guardian §C' expansion (Week 13)
- PR-B (2026-05-30) — `chat_sentiment` + `schedule_miss` + `cross_signal` signals fully wired; `activity_drop` scorer + processor exist but worker returns score=0 until `ActivityDaily` lands.

### Phase 3 carry-over — SOS (Week 13)
- PR #94 (2026-05-28) — SOS scaffold (server only, test-mode default).
- PR #95 (2026-05-28) — Mobile UI: 5 components + flow host + 30 i18n keys (hi + en).
- PR #99 (2026-05-29) — Close-out: real Exotel + Twilio HTTP, status webhooks, dispatch, auto-escalate worker, profile lock, foreground rehydrate, multi-patient routing, `critical_bypass_escalation` + `guardian_initiated` sources behind per-source flags.
- PR #109 (2026-05-30) — Rollup of #94 + #95 + #99 into `main` (squash-merge as one commit).
- PR #110 (2026-05-30) — Hardened webhook signature verification (missing header in prod now 401 instead of bypass).
- PR #116 (2026-05-31) — Clinical visual redesign of `SOSButton`, `SOSConfirmationScreen`, `SOSActiveFullscreen`. Behaviour unchanged.

### Phase 1 corrigendum — Emergency contacts (Week 13)
- PR #115 (2026-05-31) — Server CRUD module + 5-contact cap + cascade-shift priority + household authz + 10 integration tests. **Mobile management screen still pending.**

### Admin carry-over (Week 13)
- PR #93 (2026-05-28) — `User.active` soft-disable + auth-perimeter blocks + admin UI.
- PR #102 (2026-05-29) — Runtime-adjustable rate limits (4 flag-backed ceilings).

### Operational hardening — Week 13 batch
- PR #103 (2026-05-30) — Bull-board mounted at `/admin/queues` with JWT-cookie auth.
- PR #104 (2026-05-30) — Solo-patient critical alert fix + admin device visibility.
- PR #105 (2026-05-30) — Admin "Send test push" endpoint + `push_zero_recipients` PostHog event.
- PR #106 (2026-05-30) — Rate-limit cell affordance + push-diagnostics hint card.
- PR #107 (2026-05-30) — Devices card overflow + Expo error hint sub-component.

### Push delivery hardening (2026-05-30 → 31)
- PR #111 (2026-05-31) — Wired `rate_limit.readings.free` enforcement (was defined but called nowhere); critical-bypass values bypass the cap.
- PR #112 (2026-05-31) — `defaultRateLimit` now keys per-userId when JWT verifiable, IP fallback otherwise. Defeats Indian carrier-NAT mass-throttling.
- PR #113 (2026-05-31) — Surface Expo's `errors[].code` + `errors[].message` in admin UI instead of opaque `HTTP_400`.
- PR #114 (2026-05-31) — Auto-prune push tokens that return `PushTooManyExperienceIds` or `MismatchSenderId` (was only `DeviceNotRegistered`).

### Phase 1/2 corrigenda + DX polish (2026-06-03) — *working tree, not yet PR'd*

- **Rate-limit alert UI** (`apps/mobile/app/(tabs)/log.tsx`) — glucose save flow now distinguishes `RATE_LIMITED` from other rejections. New `rateLimited` state replaces the input region with an amber card (icon + "Aaj ka limit poori ho gayi" + "Dashboard dekhein" CTA) when the daily-readings cap is hit. Critical values still bypass the cap server-side, so the card never blocks a safety alert. New `logging.rateLimited.{title,body,cta}` i18n keys in en + hi.
- **Brand assets regenerated** — `apps/mobile/scripts/generate-icons.mjs` (new) renders real heart-with-ECG-pulse marks for all four required PNGs from a single pixel rasteriser, no native deps, 16× supersampled. Replaces the placeholder solid-color rectangles. The `notification-icon.png` fix is the highest-impact: prior file was opaque white everywhere → Android tinted the entire 96×96 rectangle as a colored square; new file is white silhouette on transparent so the tint paints only the heart shape.
- **Dark mode on log surfaces** — fixed real invisible-text bugs in `NumpadInput.tsx` (digit labels had no color → black-on-dark-gray invisible), `BPInput.tsx` (FieldChip active state was `bg-blue-50` only → white value text invisible on light blue in dark mode), `ConfirmationScreen.tsx` (5 bugs: warning text class collision, radio inner dot wrongly inheriting `dark:bg-gray-900`, festive toggle label uncolored, toggle ball dark-gray in dark mode, status card bgs missing dark variants), `BPConfirmationScreen.tsx` (high-BP warning had the same class collision), `VoiceInput.tsx` (loading placeholder `bg-gray-200` themed). `CriticalAlert.tsx` intentionally left alone (red/white safety surface, theme-independent by design).
- **Cold-start seed script** — `apps/server/prisma/seed-coldstart-users.ts` (new). Six free-tier users at stages 0/3/7/13/7/35: Anil/Sunita/Vikram/Lakshmi for stage-isolated testing, plus Rajesh (`+918349227777`, day 7, diabetes + HTN, poorly-controlled arc) and Priya (`+917509069999`, day 35, well-controlled, past full unlock so HbA1c + 30d trend detector fire) sharing phones with `seed-test-users.ts`. Whichever seed runs last wins; both idempotent. `createdAt` offset by `-1hr` so `Math.floor((now - createdAt)/86_400_000)` lands on the right side of the day boundary. Reading `measuredAt` uses negative hour offsets so day-0 readings are never in the future. Wired as `db:seed:coldstart-users` in `apps/server/package.json`.
- **`checkFrequency` wiring** — new `apps/mobile/src/services/check-reminders.ts`. `syncCheckReminders()` maps each frequency to the right `expo-notifications` trigger (DAILY / 2× WEEKLY Mon+Thu / WEEKLY Sun / 8× DATE for biweekly / MONTHLY day-1). Identifier prefix `check-*` so reconcile/cancel can discover everything without a separate index. `preferences.store.ts`: setters for `checkFrequency`/`notificationsEnabled`/`reminderTime` resync after `set()`. `onRehydrateStorage` resyncs on cold-start to refill the biweekly DATE-trigger queue. Server-side push reminders (best_log_time, streak-risk) remain independent — they're behaviour-aware and shouldn't be silenced by this setting. Top-level `notifications.glucoseCheck.{title,body}` i18n keys added in en + hi.
- **Preferences backend persistence** — new `UserPreferences` model + migration `20260602200000_user_preferences` (single row per user, PK on user_id, cascade-deletes with user, defaults match mobile store defaults). Server `users` module extended with `GET /users/me/preferences` (returns defaults when row missing) + `PUT /users/me/preferences` (upsert; strips `undefined` for strict-TS). New `apps/mobile/src/services/preferences.ts` (`fetchPreferences()` + `pushPreferences()`, both swallow errors so local AsyncStorage stays source of truth on network failures). `preferences.store.ts` setters push best-effort; new `hydrateFromServer()` action (server wins on mismatch, then resyncs local reminders); wired into `app/_layout.tsx` auth-aware effect. End-to-end verified: missing row → defaults; PUT partial body → persists only sent fields; explicit `null` distinguished from `undefined` (clears vs. don't-touch). Out of scope: `language` stays on `User.preferredLanguage` (existing path).
- **HbA1c response-shape bug** — mobile `services/health.ts` had hand-written `HbA1cEstimate` declaring `estimate`/`readingCount`/`weightedMeanMgDl`/`computedAt`; the actual `@swasth/domain-logic` shape uses `hba1cPercent`/`totalReadings`/`weightedAverageMgDl`/`computedAtIso`. TypeScript couldn't catch it because the type was a guess, not derived from source — surfaced at runtime as `estimate.toFixed is not a function (it is undefined)` on `HbA1cCard.tsx:114`. Fixed the type and cleaned up a defensive `typeof ... ? ... : "N/A"` ladder on the card. Follow-up: promote `HbA1cEstimate` to `@swasth/shared-types` so server + mobile import the same definition (separate refactor).

### UI Polish & Settings (2026-05-31) — *by Antigravity*
- PR #117 (2026-05-31) — Complete settings screen redesign with `ReminderTimePicker` and `CheckFrequencyPicker` modal flows (by Antigravity).
- PR #118 (2026-05-31) — NativeWind theme integration (`usePreferencesStore` linked to `setColorScheme`) with an `AnimatedThemeToggle` component for Light/Dark/System (by Antigravity).
- PR #119 (2026-05-31) — App-wide Dark Mode support executed via a comprehensive style injection script across 60+ UI files and dynamic Tab Bar colors (by Antigravity).
- PR #120 (2026-05-31) — Fixed generic black text overriding the dark mode theme across 35 UI files by injecting `dark:text-gray-100` into `text-hero` and `text-important` classes (by Antigravity).
- PR #121 (2026-05-31) — Fixed a UX edge-case where the Dashboard `InsightsBadge` teased "new patterns" prior to the 14-day unlock, preventing users from getting trapped on the "Insights Locked" screen (by Antigravity).
- **Architectural Decision (Multi-Profile Push Routing)**: Confirmed that for shared devices (e.g., 3 profiles managed on 1 phone), push notifications and SMS alerts for ALL profiles must route to the primary account's device/number. The push token is tied to the primary user's install, and the backend must route alerts for sub-profiles to this token (by Antigravity).
- PR #118 (2026-05-31) — Cleanup pass on the Antigravity rollup (#117–#121):
  - Dark mode rebuilt with a real 3-tier palette (page = `gray-950`, surface = `gray-900` + dark border, elevated = `gray-800`) — previously cards sat *below* the page bg, rendering as wells instead of elevated surfaces.
  - Removed `bg-gradient-to-br` cards that don't render in React Native (`FamilyQuickSummary`, `PatternSummaryCard`, `GuardianEmptyState`), replaced with flat `bg-*-50 dark:bg-*-950/40`.
  - Fixed class collisions (`text-critical text-gray-900`, `text-primary text-gray-900`), added missing dark variants across `InviteGuardianForm`, `EditProfileModal`, `ActiveProfileBadge` (now resolves icon colors via `useColorScheme`), `TipsCarousel`, `NotificationToggle`.
  - `ReminderTimePicker`: fixed the `settings.reminderTime.value` i18n key leaking the literal key string into the UI; added `accessibilityLabel` on hour/minute inputs.
  - Added ~50 missing i18n keys across `settings.*`, `insights.tips.*`, `insights.emptyState.*`, `insights.loggingProgress.*`, `guardian.emptyState.*`, `family.quickSummary.*` in both `en.json` and `hi.json` (Hindi-first, CLAUDE.md tone).
  - `LoggingProgressCard` wired to real data: fetches `GET /readings/glucose?from=-7d`, counts distinct local calendar days, surfaces X-of-7 with tiered color (green ≥70% / amber 40-69% / red <40%) and three copy variants. Soft-hides on fetch failure.
  - Server fix: `household.controller` was passing `req.params.id` (typed `string | string[]` under Express 5) directly to the service; `household.service` was throwing `DomainError("NOT_FOUND", …)` against an `ErrorCode` union that didn't include it. Added `HOUSEHOLD_PROFILE_NOT_FOUND` to `@swasth/shared-types` and mapped to 404 in the error handler.
  - Cleanup: deleted the one-shot `apps/mobile/fix_dark_text.js` codemod artifact; `.gitignore` now ignores `service-account-key.json`.
  - Lint debt closed on every touched file. Verify pipeline (`pnpm typecheck` × 5 projects, `pnpm lint`, `pnpm -r build`) green.


---

## Pending operational close-out (no code — gate flips + drills)

### SOS go-live checklist

- [ ] Provision vendor credentials: `EXOTEL_ACCOUNT_SID`, `EXOTEL_API_KEY`, `EXOTEL_API_TOKEN`, `EXOTEL_CALLER_ID`, `EXOTEL_APPLET_URL`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `PUBLIC_API_BASE_URL`. Optional: `EXOTEL_WEBHOOK_SECRET` for HMAC.
- [ ] 7-day internal test-mode soak per `docs/runbooks/sos-drill.md` §2 pre-flight. Zero false alarms required before real-mode promotion.
- [ ] First real drill executed and logged in `docs/runbooks/sos-drill.md` §3.
- [ ] Flag promotion sequence:
  1. `sos_enabled` → internal cohort (≤ 10 users).
  2. After 7d clean: `sos_ivr_enabled` → same cohort.
  3. Per-source flags: `sos_source_critical_bypass_enabled`, `sos_source_guardian_initiated_enabled`.
  4. Percentage ramp to broader cohorts.

### Push delivery verification

- [ ] Confirm `EXPO_ACCESS_TOKEN` in prod env belongs to the Expo account that owns the project (`projectId = 2e01622b-f527-4bfd-a9cc-002327b0babc`, owner `yogeshmishra667`).
- [ ] Rotate any access token that was pasted in chat or stored in plaintext outside `.env` / secret store.
- [ ] After PR #114 auto-prunes broken tokens, reinstall the mobile app on each affected device so a clean token gets registered against the current `projectId`.
- [ ] Run admin "Send test push" against a fresh install — expect 200 with `success_count > 0`.

### Emergency contacts go-live

- [ ] Build Settings → Emergency Contacts mobile screen (CRUD against `/api/v1/emergency-contacts`). Reorder via priority change. 48dp targets, Hindi-first copy.
- [ ] Wire guardian-assisted onboarding step to write an initial `EmergencyContact` row at priority 1 with `isGuardian: true` (CLAUDE.md line 171). **NEXT UP** in current session — see "Pending from 2026-06-03 session" below.

### Pending from 2026-06-03 session

- [ ] Land the working-tree changes (Cold-start seed, checkFrequency wiring, Preferences backend persistence, Rate-limit alert UI, Brand assets, Dark mode log surface fixes, HbA1c shape fix) as one or more PRs. Currently uncommitted; tied together because they're independent enough that a verify pipeline only needs to run once.
- [ ] EmergencyContact priority-1 seeding on guardian-assisted onboarding — the one item from the original audit list that hasn't been touched yet this session.
- [ ] Promote `HbA1cEstimate` to `@swasth/shared-types` so server + mobile share the type (separate small refactor; prevents this class of bug recurring).

---

## What's next (Week 14 — first new Phase 4 surface)

Per `phase4.md` Week-14 row: **SOS real-call ramp + Feature E.1 (CardiacLog + RespiratoryLog schema + pure detectors)**.

The "SOS real-call ramp" is operational (see checklist above) — no code unless an issue surfaces during the soak. So the code work for Week 14 is **Feature E.1**:

### Feature E.1 — Cardiac + Respiratory schema + pure detectors

Spec: `phase4.md §E.1` + `§E.2`.

1. **Schema migration**: `CardiacLog` (user_id, heart_rate, rhythm_status, chest_pain, pain_severity?, exercise_tolerance, measured_at) + `RespiratoryLog` (user_id, peak_flow?, inhaler_used, inhaler_type?, puffs?, trigger_note?, symptom_severity, measured_at). Both TimescaleDB hypertables, same composite PK pattern as `GlucoseReading`.
2. **Pure detectors** in `packages/domain-logic/src/`:
   - `cardiac-bypass` — critical thresholds: HR < 40, HR > 150, chest_pain && severity ≥ 7.
   - `respiratory-bypass` — peakFlow < baseline × 0.5, symptomSeverity === "severe".
3. **Critical-bypass dispatch** must reuse the existing `critical-alert` BullMQ chain — push + SMS + fullscreen + call, all four in parallel, per-category cooldown. CLAUDE.md "Phase 4 Invariants — Multi-condition Critical-Bypass Dispatch".
4. Coverage targets: 100% branches on each `*-bypass.ts`. Vitest ratchet pinned.
5. Flags: `cardiac_logging_enabled`, `respiratory_logging_enabled` (both default off).

### Then Feature E.2 (Week 15)

Server modules `apps/server/src/modules/cardiac/`, `apps/server/src/modules/respiratory/`. Mobile logging UI (`Section M.2`).

---

## Risks / known unknowns

- **SOS soak might surface vendor issues.** Exotel Indian E.164 routing has been known to silently drop calls when the `CallerId` is unverified — verify before the soak starts.
- **Mobile push notifications are still flaky** until the user reinstalls on every affected device (existing broken `PushTooManyExperienceIds` tokens). The auto-prune from #114 helps but a stale install will keep re-registering the same broken token until reinstalled.
- **Activity-drop SG signal** stays score=0 until Feature I (Week 19). This is the only Phase 3 carry-over that's wired-but-dormant — fine, but Feature I is far away in the schedule.
- **Mobile schedule editor + emergency-contact screen** are both small Phase 1/2 corrigenda that keep getting deferred. They'll likely land alongside Feature G's doctor-portal mobile work (Week 17) unless prioritised sooner.

---

## How to use this file

- **After every PR merges**, append a one-line entry under "What shipped" with PR #, date, and one-sentence summary.
- **When a checklist item completes**, replace the `[ ]` with `[x]` and add the date in parens.
- **When a new feature track starts**, add it to the TL;DR table and to "What's next".
- **Don't duplicate spec content here.** Link to the `phase4.md §` section instead.
