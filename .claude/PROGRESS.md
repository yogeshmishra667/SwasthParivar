# SwasthParivar — Build Progress

**Last updated:** 2026-05-11 (session 5, end)
**Status:** ✅ **Phase 1 complete.** Phase 2 may begin.
**Branch:** main (8 PRs merged + PR #6/#7/#8 open at the time of this update)

## Dependency versions

| Package               | Version |
| --------------------- | ------- |
| Prisma (client + CLI) | 7.7.0   |
| @prisma/adapter-pg    | 7.7.0   |
| Express               | 5.x     |
| TypeScript            | 6.x     |
| Vitest                | 4.x     |
| Expo SDK              | 54      |
| React                 | 19      |
| React Native          | 0.81    |
| expo-router           | 6.x     |

---

## Backend — Phase 1

### Completed

- [x] Auth module — OTP+JWT, dev bypass (000000), refresh tokens
- [x] Users module — GET /api/v1/users/me (profile + household), PATCH /api/v1/users/me (name, age, conditions, language, timezone, onboardingStep, onboardingComplete)
- [x] Readings module — POST glucose (idempotent by clientUuid, version conflict 409, returns streak + feedback + critical decision), GET list (cursor pagination)
- [x] Medications module — CRUD schedules, log taken/skipped/delayed, adherence query. Status type from @swasth/shared-types.
- [x] Streaks module — GET current streak
- [x] Dashboard module — GET (streak, latest reading, today count, active meds). Re-fetches /users/me to refresh profile store.
- [x] Sync module — push/pull endpoint stubs
- [x] Health module — GET /health, GET /health/deep
- [x] Error handler — ZodError->400, DomainError->mapped, Prisma P2025->404, P2002->409, P2003->400, unhandled->logged+500
- [x] Database — Prisma 7 pg driver adapter, prisma.config.ts, init migration applied, TimescaleDB hypertable on glucose_readings
- [x] Schema — 10 models: User, Household, EmergencyContact, GlucoseReading, MedicationSchedule, MedicationLog, UserStreak, FeedbackEvent, NotificationState, PushToken
- [x] **Push token registration** — POST /api/v1/auth/push-token upserts by token, binds userId + platform + deviceId. Migration `20260418000000_push_tokens`.
- [x] **Critical-alert worker wired** — Expo push (primary, to guardian push tokens + patient) + MSG91 SMS fallback (to all contact phones when push fails). Per-token/per-phone success flags logged for observability. Uses `shared/notifications/{expo-push,msg91-sms}.ts`.
- [x] **Med reminder jobs** — MED_REMINDER + MED_MISSED_ALERT workers. On `createSchedule`, repeatable BullMQ jobs registered per time slot (IST cron pattern). Fire → Hindi push; 1hr later missed-alert checks for taken/skipped/delayed log and auto-creates `missed_no_response` if absent. Critical meds flagged for future guardian escalation.
- [x] **Notification trigger cron** — TRIGGER_NOTIFICATION repeatable every 15 min. Iterates onboarded users, builds candidates (best_time ±7min, missed_day, streak_risk ≥7d after 8PM), runs `resolveNotification` from @swasth/domain-logic (priority + 30-min throttle + fatigue cap), dispatches via Expo push, persists nextState.

- [x] **Push token cleanup** — `sendExpoPush` now prunes tokens returned with `DeviceNotRegistered` error via `prisma.pushToken.deleteMany` (non-fatal on failure).
- [x] **Integration tests (readings + sync)** — `tests/integration/readings.test.ts`: glucose POST happy path (streak + feedback), stale version → 409 READING_STALE_VERSION, critical flag for value < 65, sync/push per-row stale status. Uses Testcontainers + spawnSync prisma migrate deploy.
- [x] **Server-time streak fallback (Patch #18)** — `apps/server/src/modules/readings/readings.service.ts` now compares `measuredAt` to server clock; >2hr drift atomically increments `User.timeAnomalyCount`. Once count ≥ 2, streak credit uses server time instead of client time. Reading's `measured_at` still preserves patient-reported timestamp for medical fidelity.
- [x] **Anti-cheat flag persistence** — `glucose_readings.anti_cheat_flags` jsonb column added (migration `20260510120000_reading_anti_cheat_and_streak_source`). Engine output stored on every reading; never blocks save.
- [x] **Streak-credited-at-server-time flag** — `glucose_readings.streak_credited_at_server_time` boolean records whether Patch #18 fired for that row.
- [x] **Weekly grace reset cron** — `apps/server/src/workers/grace-reset.worker.ts`. BullMQ repeatable, fires Sunday 21:30 UTC = Monday 03:00 IST, scoped UPDATE on `UserStreak` rows where `graceUsedThisWeek > 0`. Idempotent across multi-replica deploys via `repeat.key`.
- [x] **Critical-alert queue assertion test** — `tests/integration/readings.test.ts` posts glucose < 65 with a fresh user (avoids prior cooldown), polls all relevant BullMQ queue states, asserts the `dispatch` job lands with the correct `readingId`.
- [x] **Anti-cheat persistence test** — posts 4 identical fasting readings, asserts the 4th carries `same_value_3_consecutive` in `antiCheatFlags`.
- [x] **Server-time fallback test** — fresh user, two anomalous readings 5hr in the past; asserts `streakCreditedAtServerTime` flips on the 2nd save and `timeAnomalyCount` reaches 2.
- [x] **Reading-update path no longer mutates partition key** — fixed a latent bug where the existing-row update spread `measuredAt`, which would have triggered TimescaleDB partition-key violations under sync. Update now writes only `valueMgDl, readingType, context, notes, source, streak*, antiCheatFlags, version`.
- [x] **Test cleanup** — `disconnectDatabase()` helper now used in both integration test files so the underlying `pg.Pool` closes before Testcontainers stops Postgres. Eliminates the FATAL 57P01 noise that was failing process exit.
- [x] **Test status assertions** — fixed pre-existing `expected 201 to be 200` mismatch in 3 readings tests (controller has always returned 201; assertions were stale from scaffold).

### Pending (Phase 1 polish)

_No items remaining. Every Phase 1 mandate from `CLAUDE.md` is shipped._

### Done in session 5 (server polish)

- [x] **Add-household-member endpoint** — `POST /api/v1/household/profiles` mints a synthetic-phone (`household:<owner-uuid>:<hex>`) User row in the caller's household, capped at 8/household, returns the same shape as `/users/me`'s `householdProfiles`. Auth required; non-primary profiles cannot log in independently — by design (CLAUDE.md shared-device model). 4 integration tests cover happy path, 409 cap, 401 unauthenticated, 400 malformed body. PR #4.
- [x] **Re-engagement notification ladder** — `notification-trigger.worker` now emits `re_engagement` candidates for `daysSinceLog ∈ [3, 8)` with per-day `messageKey` (so 24h dup suppression doesn't eat the next day's nudge). Anti-fatigue (existing resolver) clamps cadence to 1/day at 3 ignores, every-other-day at 5, silent at 7 — matching CLAUDE.md re-engagement spec. New trigger types `re_engagement` (priority 3) and `welcome_back` (priority 2) added to `shared-types`. Copy is invitation-toned, never guilt. PR #7.

### Acceptable for Phase 1 (NOT a blocker)

- [ ] **Multi-device notification dedup** — resolver sees `NotificationState` but copies go to all user tokens; may double-notify if user has multiple active devices. Phase 2 polish.

### Deferred to Phase 2

- [ ] **BP readings module** — `BPReading` model, POST/GET endpoints, 5-day mean/variance detectors.
- [ ] **Meal log module** — `MealLog` (halka/normal/heavy) + meal-category correlation detector.
- [ ] **Insight engine** — `InsightEvent` model + spike/trend/correlation/anomaly detectors (pure functions in `@swasth/domain-logic/detectors`).
- [ ] **Health check schedule** — `HealthCheckSchedule` + `HealthCheckCompliance` models with reminder jobs.
- [ ] **HbA1c estimator** — `GET /api/v1/hba1c/estimate` using 90d weighted avg (30d ×1.5, 30d ×1.0, 30d ×0.5), always labelled ESTIMATE.
- [ ] **HealthScore daily job** — logging 20% + stability 25% + trend 25% + med 20% + streak 10%, stored in `HealthScore` table, Redis-cached 24hr.
- [ ] **Hindi dashboard summary card** — natural-language aggregation ("Aaj ka din: Sugar thik hai (Fasting: 118)…").
- [ ] **Guardian read-only view** — `FamilyLink` model, `GET /api/v1/family/patients/:id/dashboard`. No alerts yet.

### Deferred to Phase 3

- [ ] **Guardian alert dispatch** — med-missed worker flags critical-med misses but doesn't push to guardians yet (needs `GuardianAlert` model + FamilyLink).
- [ ] **AI chat** — `ChatMessage` model, Tier 1 template / Tier 2 cached / Tier 3 Sonnet; post-response safety filter; rate limit 3/day free tier.
- [ ] **Silent Guardian** — `SilentGuardianSignal` model, 0-100 scoring + decay, orange/yellow alerts max 2/week.
- [ ] **Cross-condition detectors** — t-test, p < 0.05, ≥30 days of data.
- [ ] **SOS** — `SOSEvent` model, `POST /api/v1/sos/trigger`, escalation chain + IVR fallback (only after 4+ weeks of system stability).

### Deferred to Phase 4+

- [ ] **Prescription OCR** — `Prescription` + `PrescriptionItem` + Claude Vision job. RED/YELLOW/GREEN confidence tiers, all human-approved.
- [ ] **CardiacLog / RespiratoryLog** — Phase 4 conditions.
- [ ] **Doctor appointments** — `DoctorProfile`, `DoctorAppointment`, 7d/1d/2h reminder job.
- [ ] **Activity + sleep sync** — `ActivityDaily`, `SleepLog` (wearable integration).
- [ ] **Reports (PDF)** — `POST /api/v1/reports/generate` → Puppeteer + Claude executive summary → R2.
- [ ] **Payments** — Razorpay webhooks, tier transitions, Apple IAP on iOS.
- [ ] **Regional languages + festival nudging** — beyond Hindi/English.

---

## Frontend — Phase 1

### Completed

- [x] Auth flow — login, verify, SecureStore tokens, dev bypass (000000)
- [x] 401 auto-refresh interceptor — detects 401, refreshes via /auth/refresh, retries request, concurrent-safe promise lock
- [x] Onboarding (end-to-end) — language (local pref), condition (PATCH conditions), profile (PATCH name+age), first-reading (POST /readings/glucose), medications (PATCH onboardingComplete). Each screen tracks onboardingStep.
- [x] index.tsx routing — fetches /users/me, routes to correct onboarding step if incomplete, dashboard if done. Seeds profile store with household profiles.
- [x] Dashboard — real data from GET /dashboard (streak, latest reading, today count). Pull-to-refresh. Stale data warning. Re-fetches /users/me to refresh profile badge.
- [x] Log screen — numpad input, voice stub, confirmation with profile badge + type toggle + 3s delay on extreme values. Shows feedback message + streak after save. Triggers fullscreen CriticalAlert for glucose <65 or >315.
- [x] Profile switcher + badge — seeded from /users/me on app start + dashboard mount. Netflix-style avatars. Locks during logging.
- [x] Icon component — @expo/vector-icons Ionicons wrapper. Tab bar icons (home, add-circle, medkit, settings). All emojis removed.
- [x] i18n — all screens use t() calls. hi.json + en.json. Language switch in settings works. compatibilityJSON v3.
- [x] Error logging — logError(screen, error) in all catch blocks. console.warn in dev, PostHog track in prod.
- [x] Reading save fix — sends `measuredAt` (not `measuredAtIso`) matching server validation schema.

### Pending (Phase 1)

_No items remaining. Every CLAUDE.md mandate is shipped._

### Done in session 5 (mobile completion)

- [x] **Offline write queue (WatermelonDB Option B)** — `services/readings.ts` exposes `saveGlucoseReading` (API-first; queues to Watermelon on network failure) and `drainPendingReadings` (replays queued rows in `measured_at` order, drops 4xx, retries 5xx/network). `useSyncDrain` mounted in `_layout.tsx` triggers drain on auth-token hydrate, every NetInfo "connected" transition, and a 60s defensive interval. `SyncStatusBadge` on the dashboard surfaces "💾 N saved locally" / "↻ syncing" / "☁️ synced". `getDatabase()` lazy-init keeps Expo Go on Android from crashing. Critical-glucose alert still fires from local threshold check on offline path. PR #2.
- [x] **Med reminder local notifications** — `services/medication-reminders.ts` schedules `expo-notifications` DAILY trigger per slot on `addMedicine`, cancels on delete, reconciles on every medications screen load (fixes drift after re-install / force-quit). Identifier scheme `med-<scheduleId>-<HH:MM>` for clean cancellation. Hindi copy via i18n keys with safe defaults. PR #3.
- [x] **Add-profile UI** — Settings → "Family on this device" section + "Add another profile" button → bottom-sheet modal (name + age + condition multi-select). On success, splices the new profile into `useProfileStore` and switches active profile immediately, no `/users/me` round-trip needed. PR #4.
- [x] **Festive tag toggle** — Confirmation screen shows "🎉 Special din?" toggle below type picker. Hidden on critical values (safety wins). 2/week cap tracked in `useFestiveStore` (zustand + AsyncStorage). Toggle disabled at limit, copy reads "Used twice this week". `festive_tag_used` PostHog event. Server already accepted `context: "festive"`; now the mobile UI reaches that path. PR #5.
- [x] **Voice STT (real)** — `expo-speech-recognition` wired in `src/components/logging/VoiceInputNative.tsx`. Permission gating, hi-IN/en-IN locale, interim results, 5s silence auto-stop, 2-fail → numpad fallback, full error code handling, recurring haptic pulse during recording. **Lazy-loaded** so Expo Go on Android falls back to numpad without crashing the bundle. PR #1.
- [x] **Large-text toggle (real)** — Tailwind font tokens resolve from NativeWind CSS variables; `<FontScaleProvider>` updates them when the toggle flips; every `text-*` class scales 1.3× instantly. Removed the broken `Text.defaultProps.style` hack from `useAccessibility`. PR #1.
- [x] **Profile badge tap → selector** — `ActiveProfileBadge` is `Pressable` when `profileCount > 1`. Static otherwise. PR #1.
- [x] **CriticalAlert hardware-back lock** — `BackHandler` swallows back press while `secondsLeft > 0`. Modal `onRequestClose` only forwards on dismissible. Live `Wait Ns...` countdown. Recurring haptic pulse every 4s. PR #1.
- [x] **`tel:` URI sanitizer (security)** — `src/utils/phone.ts` (`sanitizePhoneForTelUri`). Strips everything except digits, leading `+`, `*`, `#`. Used in CriticalAlert and `app/sos.tsx` (the latter previously interpolated raw deep-link `phone` query param into the URL — closed). PR #1.
- [x] **Local-first dashboard reads + welcome-back banner** — `services/dashboard-cache.ts` (AsyncStorage cache-aside): mount paints cached data → API fetches in background → updates + saves cache. Stale banner gated on hydrated-from-cache + fetch-failed + cache-age > 1h, with "Last updated: Nm ago" timestamp. `WelcomeBackBanner` shows when `daysSinceLatestReading ≥ 3 && !loggedToday` (matches server-side re-engagement worker thresholds). `clearDashboardCache()` wired into `auth.store.clear()` so logout doesn't leak previous user's data. PR #8.
- [x] **Settings persistence** — already shipping via Zustand `persist` middleware on `usePreferencesStore` (AsyncStorage). Verified.
- [x] **Profile inactivity check** — already shipping via `useProfileInactivity`. Verified.
- [x] **Undo reading** — wired in `app/(tabs)/log.tsx` via `api.delete("/readings/glucose/:id")`. Verified.
- [x] **30s critical alert lock** — was already implemented; this session added the back-button block + countdown UI on top.
- [x] **Time-anomaly banner** — already shows on dashboard when `timeAnomalyCount >= 2`. Verified.
- [x] **Push token registration** — calls `registerAndSyncPushToken()` after `accessToken` hydration in `_layout.tsx`. Verified.
- [x] **Medications CRUD UI** — done in session 3. Verified by user (add medicine + Taken/Skipped working).
- [x] **`.expo/` ignore broadened** — root `.gitignore` uses `**/.expo/` so stray Expo dirs in any workspace don't leak into git status.

### Done in session 4 (mobile polish)

- [x] **Voice STT (real)** — `expo-speech-recognition` wired in `src/components/logging/VoiceInputNative.tsx`. Permission gating, hi-IN/en-IN locale based on language pref, interim results, 5s silence auto-stop, 2-fail → numpad fallback, error codes (no-speech, audio-capture, not-allowed, etc.) handled, recurring haptic pulse during recording. Native module is **lazy-loaded** so Expo Go on Android falls back to numpad with a clear message instead of crashing the bundle.
- [x] **Large-text toggle (real)** — Tailwind font tokens (`text-body`, `text-important`, `text-number`, `text-hero`) now resolve from NativeWind CSS variables. `<FontScaleProvider>` wraps the tree and updates the variables when the toggle flips; every `text-*` class scales 1.3× instantly. Removed the old broken `Text.defaultProps.style` hack from `useAccessibility`.
- [x] **Profile badge tap → selector** — `ActiveProfileBadge` is `Pressable` when `profileCount > 1`, opens the existing `ProfileSelectorModal`. Static when there's only one profile (no false-affordance).
- [x] **CriticalAlert hardware-back lock** — `BackHandler` swallows back press while `secondsLeft > 0`. Modal `onRequestClose` only forwards to `onDismiss` when dismissible. Countdown shown as live `Wait Ns...` label. Recurring haptic pulse every 4s per CLAUDE.md "haptic on critical: continuous".
- [x] **`tel:` URI sanitizer (security)** — added `src/utils/phone.ts` (`sanitizePhoneForTelUri`). Strips everything except digits, leading `+`, `*`, `#` before opening `tel:`. Prevents pause/2nd-stage injection (`,` `;` `p` `w`). Used in CriticalAlert and `app/sos.tsx` (the latter previously interpolated raw deep-link `phone` query param straight into the URL — closed).
- [x] **Settings persistence** — already shipping via Zustand `persist` middleware on `usePreferencesStore` (AsyncStorage). Verified.
- [x] **Profile inactivity check** — already shipping via `useProfileInactivity`. Verified.
- [x] **Undo reading** — already wired in `app/(tabs)/log.tsx` via `api.delete("/readings/glucose/:id")`. Verified.
- [x] **30s critical alert lock** — was already implemented; this session added the back-button block + countdown UI on top.
- [x] **Time-anomaly banner** — already shows on dashboard when `timeAnomalyCount >= 2`. Verified.
- [x] **Push token registration** — already calls `registerAndSyncPushToken()` after `accessToken` hydration in `_layout.tsx`. Verified.
- [x] **Medications CRUD UI** — done in session 3. Verified by user (add medicine + Taken/Skipped working).
- [x] **`.expo/` ignore broadened** — root `.gitignore` now uses `**/.expo/` so stray Expo dirs in any workspace don't leak into git status.

### Deferred to Phase 2 (Frontend)

- [ ] **BP logging screen** — numpad (systolic / diastolic / pulse), confirmation flow mirroring glucose.
- [ ] **Meal log quick-entry** — halka / normal / heavy_fried buttons after post_meal reading.
- [ ] **Insights feed** — `InsightEvent` list with acknowledge + helpful feedback.
- [ ] **Dashboard Hindi summary card** — renders server-provided natural-language summary.
- [ ] **Weekly report preview** — shows median + mini-chart unlocked day 7+.
- [ ] **Guardian read-only dashboard** — separate view for linked patients.

### Deferred to Phase 3 (Frontend)

- [ ] **AI Chat screen** — send/receive messages, language toggle, flag button, rate-limit UI.
- [ ] **Silent Guardian alert drawer** — orange/yellow cards with explanation + action.
- [ ] **SOS button + cancel flow** — 5s long-press, countdown, auto-call priority 1.

### Deferred to Phase 4+ (Frontend)

- [ ] **Prescription upload + OCR review** — camera + confidence-tier UI.
- [ ] **Medicine photo verification** — capture + AI match status.
- [ ] **Doctor appointment booking + pre-visit report** — list view + reminders.
- [ ] **Regional language packs** — beyond hi/en.

---

## Critical patterns

- Prisma 7: datasource URL in prisma.config.ts, PrismaPg adapter
- GlucoseReading: @@unique([clientUuid, measuredAt]), findFirst not findUnique
- Pagination cursor: composite clientUuid_measuredAt string
- Express 5: async errors propagate natively, no express-async-errors
- Metro: custom resolver in metro.config.js for .js -> .ts workspace imports
- semver@7 forced via root package.json dep (reanimated needs functions/satisfies)
- Mobile field name: `measuredAt` (not measuredAtIso) — must match server Zod schema
- Reading update path must NEVER mutate `measured_at` (TimescaleDB partition key) — only `valueMgDl, readingType, context, notes, source, streak*, antiCheatFlags, version` are updatable
- Patch #18: `User.timeAnomalyCount` is incremented atomically via Prisma `increment: 1`; >= 2 → streak credit uses server time, not `measuredAt`
- Native modules with `requireNativeModule` (e.g. `expo-speech-recognition`, WatermelonDB) must be lazy-loaded behind a `Constants.appOwnership === "expo"` guard so Expo Go on Android doesn't crash at bundle load

## DB access

```
docker exec -it swasth-postgres psql -U postgres -d swasth_parivar
```

```sql
SELECT id, name, age, conditions, onboarding_complete, onboarding_step FROM users;
SELECT id, user_id, value_mg_dl, reading_type, measured_at FROM glucose_readings ORDER BY measured_at DESC;
SELECT * FROM user_streaks;
-- Reset user for re-testing onboarding:
UPDATE users SET name='', age=0, conditions='{}', onboarding_complete=false, onboarding_step=0 WHERE phone='+919999999999';
```

---

## Changelog

### Session 4 (2026-05-10) — Phase 1 hardening

Branch: `phase1-hardening`. All checks green: mobile typecheck, server typecheck, domain-logic 45/45 unit, server integration 9/9 (exit 0). 8 atomic commits.

**Mobile**

1. Voice STT wired (`expo-speech-recognition`) with lazy native-module load so Expo Go on Android falls back to numpad without crashing the bundle. Permission gating, hi-IN/en-IN locale, 5s silence timeout, 2-fail → numpad, all error codes handled.
2. Large-text toggle now actually scales fonts. Tailwind tokens (`text-body|important|number|hero`) routed through NativeWind CSS variables; `<FontScaleProvider>` updates them at runtime. Removed broken `Text.defaultProps.style` hack.
3. Profile badge tappable when `profileCount > 1` (opens `ProfileSelectorModal`); static otherwise.
4. CriticalAlert: hardware-back blocked while locked, live `Wait Ns...` countdown, recurring haptic pulse every 4s.
5. Security: `tel:` URI sanitizer extracted to `src/utils/phone.ts` and used in both CriticalAlert and `app/sos.tsx` (the latter previously took raw deep-link `phone` and concatenated into `tel:`).
6. `_layout.tsx` lazy-loads `expo-notifications` only outside Expo Go (was crashing at boot in Expo Go SDK 53+).
7. `notifications.ts` sets handler only outside Expo Go.
8. Stray `apps/server/.expo/` no longer untracked — root `.gitignore` broadened to `**/.expo/`.

**Server**

9. **Patch #18 — server-time streak fallback.** `readings.service.ts` compares `measuredAt` to server clock; >2hr drift atomically increments `User.timeAnomalyCount`. Once count ≥ 2, streak credit uses server time; reading's medical timestamp is preserved.
10. New columns: `glucose_readings.anti_cheat_flags jsonb` and `glucose_readings.streak_credited_at_server_time boolean`. Migration `20260510120000_reading_anti_cheat_and_streak_source` (NOT NULL with safe defaults — non-blocking).
11. **Reading update path narrowed** — no longer mutates `measured_at` (was a latent TimescaleDB partition-key violation under sync edits).
12. **Weekly grace reset cron** — `workers/grace-reset.worker.ts`. BullMQ repeatable, Sunday 21:30 UTC = Monday 03:00 IST, `repeat.key` for multi-replica idempotency.
13. **3 new integration tests** — critical-alert queue receives job; anti-cheat flag persisted on 4th identical reading; server-time fallback engages on 2nd anomalous clock.
14. Fixed pre-existing `expected 201 to be 200` mismatch in 3 readings tests.
15. Fixed pg.Pool teardown — both integration test files now call `disconnectDatabase()` before stopping Testcontainers, eliminating FATAL 57P01 noise on exit.

**Pending after this session:** WatermelonDB sync wiring, med reminder local-notification fallback, add-household-member endpoint + UI. See `Pending (Phase 1)` above.

### Session 3b (2026-04-18) — Cleanup + tests

10. `sendExpoPush` prunes push tokens flagged `DeviceNotRegistered` by Expo receipt
11. `tests/integration/readings.test.ts` — full Testcontainers harness: readings POST (200/409/critical) + sync/push (stale row reporting)

### Session 3 (2026-04-18) — Notification backbone

1. `PushToken` model + migration (`push_tokens` table, unique by token, indexed by user)
2. `POST /api/v1/auth/push-token` upsert endpoint (bound to auth middleware)
3. `shared/notifications/expo-push.ts` — Expo push batch client with per-token success flags
4. `shared/notifications/msg91-sms.ts` — MSG91 flow API client with graceful NOT_CONFIGURED fallback
5. `critical-alert.worker.ts` rewritten — resolves guardian phones → users → push tokens, sends push, falls back to SMS on push failure, logs success counts per channel
6. `med-reminder.worker.ts` — fires scheduled reminders, enqueues 1hr missed-check; missed-alert worker auto-logs `missed_no_response`
7. `medications.jobs.ts` — BullMQ repeatable jobs registered per HH:mm time slot on `createSchedule` (IST cron, stable repeatable keys)
8. `notification-trigger.worker.ts` — 15-min tick iterates onboarded users, builds trigger candidates, delegates to domain `resolveNotification`, dispatches push, persists next `NotificationState`
9. `bootstrapNotificationCron` on server start ensures tick repeatable exists (idempotent by key)

### Session 2 (2026-04-17)

1. Created users module (GET + PATCH /api/v1/users/me)
2. Wired all 5 onboarding screens to persist data via API
3. index.tsx: fetches /users/me, routes to correct onboarding step, seeds profile store
4. Dashboard: real data fetch + pull-to-refresh + stale warning + profile re-fetch
5. Log screen: shows feedback + streak after save, triggers CriticalAlert on extreme values
6. Created shared-types/medications.ts, deduplicated MedicationLogStatus across server
7. Error handler: added Prisma P2025/P2002/P2003 catch
8. Mobile api.ts: 401 auto-refresh interceptor with concurrent race prevention
9. All catch blocks replaced with logError() — no silent swallowing
10. Fixed reading save: measuredAtIso -> measuredAt field name mismatch
11. Dashboard re-fetches /users/me to refresh profile badge after onboarding
12. All screens converted to t() i18n calls — language switch now works
13. Added i18n keys: dashboard, logging, medications, settings, onboarding sections

### Session 1 (2026-04-16)

1. Upgraded deps: Prisma 7, Express 5, TS 6, Vitest 4, Expo 54, React 19, RN 0.81
2. shamefully-hoist=true for Metro pnpm compat
3. Metro custom resolver for .js -> .ts workspace imports
4. semver@7 override for reanimated
5. SplashScreen lifecycle fix (preventAutoHide + hideAsync)
6. verify.tsx response unwrapping fix
7. Dev OTP bypass (000000)
8. expo-notifications v0.32 API fix
9. i18n Intl.PluralRules compat (compatibilityJSON v3)
10. All emojis replaced with Ionicons vector icons
11. Icon component + tab bar icons
12. Removed dead components (SyncStatusBadge, TimeoutFallback)
