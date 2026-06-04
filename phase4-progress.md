# Phase 4 — Live Progress Board

> **Companion to `phase4.md`** (the original spec). This file tracks what's done, what's in flight, and what's next. Update on every merged PR. The spec stays canonical for HOW things should be built.
>
> Last updated: **2026-06-04** (Mobile UX polish round 2 + SOS dark-mode fix + brand-icon refresh + dev IP refresh).

---

## TL;DR — where we actually are

| Track | State | Next concrete action |
|---|---|---|
| **Carry-over from Phase 2, Phase 3, Admin** | ✅ Code-complete | None — see "operational close-out" below |
| **Phase 1 corrigendum: emergency contacts** | ✅ Server (#115) + onboarding priority-1 seed (both household-profile + FamilyLink-accept paths) + mobile Settings CRUD screen all landed (2026-06-03 follow-up session) | None — Phase 1 corrigendum closed |
| **Preferences backend persistence** | 🟡 Server + mobile wired (PR #125 open) | Merge #125; verify cross-device sync on a real install |
| **checkFrequency local reminders** | 🟡 Wired (PR #125 open) | Merge #125 |
| **Cold-start test users** | 🟡 Seed script live, 6 free-tier users at days 0/3/7/13/7/35 (PR #125 open) | Merge #125 |
| **Rate-limit alert UI** | 🟡 Glucose log surface shows prominent card on 429 (PR #125 open) | Merge #125 |
| **Brand assets** | 🟡 Real icon/splash/notification PNGs regenerated; fixes square-notification bug (PR #125 open) | Merge #125 → rebuild via EAS to ship to device |
| **Dark mode on log surfaces** | 🟡 Invisible-text bugs fixed on numpad / BP field chips / confirmation warnings (PR #125 open) | Merge #125 |
| **HbA1c response-shape type** | 🟡 Mobile type aligned to domain-logic source of truth (PR #125 open) | Merge #125; follow-up PR to promote `HbA1cEstimate` to `@swasth/shared-types` so this can't recur |
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

### Mobile UX polish round 2 + SOS dark-mode + icon refresh (2026-06-04)

Continuation session on the same working tree as the 2026-06-03 entry. Closes the visual rough edges and locks in the brand-icon swap.

- **Brand-icon swap.** User dropped a hand-designed family-of-figures inside a heart for `icon.png`; companion assets were broken (white-only adaptive, blank notification). New `apps/mobile/scripts/derive-companion-icons.mjs` reads `icon.png`, chroma-keys the brand-blue, and regenerates `adaptive-icon.png` (white art on transparent at 50% safe zone — conservative enough to survive Pixel circular, OneUI squircle, and teardrop launcher masks; was 66% which was clipping the heart's top edges on real devices) and `notification-icon.png` (96×96 pure-white silhouette so Android tints correctly). Run with `pnpm --filter @swasth/mobile icon:derive`. Original `splash.png` is still hand-designed and unchanged; the `expo-splash-screen` plugin detour got reverted to the legacy `expo.splash` config because the plugin's screen-center anchor was clipping the logo on tall phones.
- **Dev IP refresh.** Updated `apps/mobile/app.json` `extra.apiBaseUrl` and the fallback in `apps/mobile/src/services/api.ts` from `10.251.99.196` → `10.228.161.196` (carrier-NAT rotation).
- **TipsCarousel editorial redesign.** After three iterations, settled on a two-zone editorial card layout: tinted top zone with an icon tile (bottom-left, spans the seam between zones) + big faded number top-right + two decorative offset blobs; clean content zone below with title, body, and an action row that has a leading topic-icon chip + action text + circular arrow nudge. Peek-and-gap snap carousel (`CARD_W = USABLE_W − 24px peek`, `GAP = 14`) — earlier full-width version with `pagingEnabled` glued cards edge-to-edge; current version respects the parent insights ScrollView's existing 16dp padding so we don't double-inset. Pagination dots with a wider active state. Zero emojis (per user request); the leading icon in the action row replaces what was previously a 💧/🚶/🥗/🌙.
- **InviteGuardianForm — profile as the header.** The "for {{name}} ji" context now lives IN the card header: the active profile's avatar (real `avatarColor` from the profile switcher) is the hero icon, the title and `inviteForLine` sit beside it. Removes the separate "Inviting for X" pill below the header that was crammed and visually orphaned. Soft hero band, icon-prefixed phone + relationship inputs, color-coded sensitivity radio cards (green/blue/red dots), iconified error/success pills. Nothing removed — only restructured.
- **Family tab hero + section headers.** Live count + avatar stack in `FamilyQuickSummary.tsx`. Icon-chip section headers with count badges. Iconified `EmptyState` cards for both invites + patients sections. Family route file unchanged except for the new helpers.
- **Profile-switcher dark-mode polish.** Closed the gaps in `ProfileSwitcher.tsx` (inactive ring + label color), `ProfileSelectorModal.tsx` (active-row bg, border, added selected check icon), `AddProfileModal.tsx` + `EditProfileModal.tsx` (label colors, close icon contrast).
- **Check-frequency UX surfacing.** New `src/utils/nextReminder.ts` exports `nextReminderAt()` + `formatNextReminder()` + `cadenceLabel()` — pure helpers (TFunction-typed, easy to unit-test) that compute the next time the local reminder will fire and format it as "Aaj 7:30 PM" / "Kal 7:00 AM" / "Somvaar 7:00 AM" / "1 Apr, 7:00 AM". Two new surfaces consume them: `CheckScheduleChip` (subtle "Daily • 7:00 AM" pill at the top of the Log input stage) and `NextCheckReminderCard` (post-save card that says "Agla [Sugar/BP/both] check reminder: Kal 7:00 AM"). Both are condition-aware (read active profile's `conditions`) and hide themselves when notifications are off. Wired into `app/(tabs)/log.tsx` for glucose, BP, and meal modes. Active-profile changes in `_layout.tsx` resync the schedule so a profile switch re-renders the title/body. ~30 new `nextReminder.*` i18n keys (en + hi). Skipped guardian-side surfacing — would require extending `getPatientDashboard` server-side to expose patient preferences; flagged as a follow-up.
- **SOS Button extension + AfterAction dark-mode fix.** The user's SOS clinical redesign (`SOSActiveFullscreen`, `SOSConfirmationScreen`, `SOSAfterActionCard`) passed `style` + `textStyle` props that the existing `Button` component didn't declare — 7 typecheck errors. Extended `apps/mobile/src/components/ui/Button.tsx` to accept both, merging `style` AFTER the built-in 48dp touch-target floor so accessibility minimums survive overrides. Separately, `SOSAfterActionCard.tsx` had hardcoded `#FFFFFF` / `#EFF6FF` / `#374151` choice tiles that were broken in dark mode — extracted a `ChoiceTile` helper, swapped to NativeWind `bg-blue-50 dark:bg-blue-950/40` etc. The two panic surfaces (`SOSActiveFullscreen`, `SOSConfirmationScreen`) stay always-dark by design (same logic as `CriticalAlert.tsx` — safety surfaces are theme-independent).
- **Emoji purge.** Per user request, removed every emoji from session-touched files: 💧🚶🥗🌙 from tip action defaultValues, 🙏 × 3 from notification-body defaultValues in `check-reminders.ts`, 👤 from the orphaned `family.inviteForProfile` i18n key. All decorative meaning now carried by Ionicons.

### Phase 1 corrigendum close-out + UI polish (2026-06-03 follow-up session)

Mobile UX polish + the remaining Phase 1 audit item closed:

- **EmergencyContact priority-1 seeding (both paths)** — `apps/server/src/modules/household/household.service.ts` (`addHouseholdProfile`) wraps the sub-profile creation in a transaction and seeds the new profile's priority-1 `EmergencyContact` with the household primary's name + phone + `isGuardian:true` (defensive skip if the primary's phone is synthetic). Complementary hook in `apps/server/src/modules/family/family.service.ts` (`respondToInvite("accept")`): when a cross-household guardian accepts a FamilyLink invite, seed the patient's priority-1 EC with the guardian's phone IFF no priority-1 exists. New integration tests in `tests/integration/household.test.ts` (asserts the seed shape on profile creation) and `tests/integration/family.test.ts` (seed on accept, no-overwrite branch on pre-existing priority-1).
- **Check-frequency reminder copy is now condition-aware** — `apps/mobile/src/services/check-reminders.ts` exports `composeReminderCopy(conditions)`: sugar-only / BP-only / both, picked from the active profile's `conditions`. Single picker, single fire per slot. New `useEffect` in `app/_layout.tsx` re-runs `syncCheckReminders` on profile-id / conditions change so mid-session profile switches re-render the title. Preferences store passes `activeConditions()` to every reminder resync call.
- **TipsCarousel redesign** — `apps/mobile/src/components/insights/TipsCarousel.tsx` rewritten as a snap-paged `FlatList` (`decelerationRate="fast"`, `snapToInterval = card+gap`, peek of next card). Cards size to content (was `h-full` → looked half-empty), new card design (rounded icon halo + accent bottom stripe), active page-indicator dots beneath.
- **Profile switcher dark-mode polish** — closed gaps in `ProfileSwitcher.tsx` (inactive ring, label color), `ProfileSelectorModal.tsx` (active row bg, border, added selected check icon), `AddProfileModal.tsx`+`EditProfileModal.tsx` (label/icon color tokens).
- **Family tab hierarchy** — `apps/mobile/app/(tabs)/family.tsx` re-organised with a new hero card (`FamilyQuickSummary.tsx` rewritten to show live count + avatar stack + pending-invite callout), icon-chip section headers with count badges, iconified `EmptyState` card. Nothing removed.
- **Brand assets v2** — new `apps/mobile/scripts/generate-icons-v2.mjs` + `assets/images/icon-source.svg` produce a lotus + tilak + ECG pulse mark replacing the v1 generic heart. Pure-JS rasteriser (same plumbing as v1), all four PNG outputs regenerated. `pnpm --filter @swasth/mobile icon:build` runs v2; `icon:build:legacy` runs v1 for revert.
- **Mobile Settings → Emergency Contacts CRUD** (Phase 1 corrigendum, second half) — new screen at `apps/mobile/app/settings/emergency-contacts.tsx` lists contacts by priority with a tap-only ↑/↓ reorder (no drag — CLAUDE.md "core flows: TAP ONLY"), edit modal, delete confirm. Disabled "+ Add contact" once the 5-cap hits, with copy explaining why. Top of screen explains "Priority #1 sabse pehle call hoga". The household primary can manage a sub-profile's contacts because `targetUserId` is set from the active profile. Companion `apps/mobile/src/services/emergency-contacts.ts` is the typed client. `apps/mobile/src/components/settings/EmergencyContactModal.tsx` does add+edit in one form with inline E.164 validation. New "Safety" section on the Settings tab is the entry point. ~50 new `emergencyContacts.*` i18n keys (en + hi). Closes the Phase 1 corrigendum: every onboarding path now seeds priority-1 (server) AND users can manage the list (mobile).

### Phase 1/2 corrigenda + DX polish (2026-06-03) — *PR #125 open*

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

- [x] (2026-06-03 follow-up) Build Settings → Emergency Contacts mobile screen (CRUD against `/api/v1/emergency-contacts`). Reorder via tap-only ↑/↓ swap with neighbour (no drag, per CLAUDE.md "core flows: TAP ONLY"). 48dp targets, Hindi-first copy. Active-profile aware via `targetUserId` so the household primary can manage sub-profile contacts. Files: `apps/mobile/src/services/emergency-contacts.ts` (typed client), `apps/mobile/src/components/settings/EmergencyContactModal.tsx` (add/edit form with E.164 inline validation), `apps/mobile/app/settings/emergency-contacts.tsx` (list + reorder + delete confirm). Entry point added under a new "Safety" section on the Settings tab. ~50 new i18n keys (en + hi).
- [x] (2026-06-03 follow-up) Wire guardian-assisted onboarding step to write an initial `EmergencyContact` row at priority 1 with `isGuardian: true` (CLAUDE.md line 171). Landed in `addHouseholdProfile` (household.service.ts) so creating a sub-profile seeds the new profile's priority-1 EC with the household primary's phone in the same transaction. Complementary hook landed in `respondToInvite("accept")` (family.service.ts) for the cross-household FamilyLink path.

### Pending — next session pickup

- [x] (2026-06-03) Land the 2026-06-03 working-tree changes as PR #125 — 8 commits, all 11 preflight gates green.
- [x] (2026-06-03 follow-up) **EmergencyContact priority-1 seeding on guardian-assisted onboarding** (CLAUDE.md:171). Last item from the original audit list. Landed in `apps/server/src/modules/household/household.service.ts` (`addHouseholdProfile` seeds priority-1 EC in same tx as profile creation; defensive skip for synthetic primary phones) AND in `apps/server/src/modules/family/family.service.ts` (`respondToInvite("accept")` seeds priority-1 EC for the patient with the accepting guardian's phone, IFF no priority-1 exists, with standard shift-cascade). New integration tests in `household.test.ts` and `family.test.ts` cover the seed + no-overwrite branches.
- [x] (2026-06-03 follow-up) Mobile Settings → Emergency Contacts CRUD screen — see "Emergency contacts go-live" checkbox above.
- [ ] Follow-up refactor: promote `HbA1cEstimate` to `@swasth/shared-types` so server + mobile share the type. Prevents this class of drift bug recurring. Small, independent — can land alongside or after the EmergencyContact PR.

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
