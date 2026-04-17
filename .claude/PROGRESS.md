# SwasthParivar — Build Progress

**Last updated:** 2026-04-17 (session 2, end)
**Branch:** main

## Dependency versions

| Package | Version |
| --- | --- |
| Prisma (client + CLI) | 7.7.0 |
| @prisma/adapter-pg | 7.7.0 |
| Express | 5.x |
| TypeScript | 6.x |
| Vitest | 4.x |
| Expo SDK | 54 |
| React | 19 |
| React Native | 0.81 |
| expo-router | 6.x |

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
- [x] Schema — 9 models: User, Household, EmergencyContact, GlucoseReading (composite PK+unique), MedicationSchedule, MedicationLog, UserStreak, FeedbackEvent, NotificationState

### Pending

- [ ] **BullMQ critical-alert worker** — currently logs and exits. Wire Expo Push (primary) + MSG91 SMS (fallback). Per CLAUDE.md: push to ALL guardian contacts, SMS only where push fails.
- [ ] **Push token registration** — POST /api/v1/auth/push-token endpoint. Mobile has client-side `registerForPushNotificationsAsync()` ready but never called.
- [ ] **Notification scheduling** — med reminder jobs (delayed per med time), best-time detection (rolling 5-day avg), streak-risk (>=7 and no log by 8PM), anti-fatigue (max 2 push/day, 3 ignores->1/day, 7->stop).
- [ ] **Sync endpoints** — real conflict resolution: client_uuid + version, reject stale (version <= stored) with 409, last-write-wins by version.
- [ ] **Integration tests** — health.test.ts stub exists with Testcontainers setup. Needs: dynamic env import (app.ts has buildApp()), readings endpoint test, sync conflict test.

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

### Pending

- [ ] **Voice input** — wire `expo-speech-recognition` to replace VoiceInput.tsx setTimeout stub. Call `parseVoiceTranscript()` from @swasth/domain-logic with real transcript + confidence. CLAUDE.md: 2 fails -> auto-show numpad, 5s silence -> dismiss mic.
- [ ] **Medications CRUD UI** — medications tab is placeholder. Needs: add medicine (name + time slots), edit/delete, mark taken/skipped per schedule, adherence display.
- [ ] **Med reminder notifications** — schedule local notifications via expo-notifications at med times. Reschedule on add/edit/delete.
- [ ] **WatermelonDB sync** — offline-first queue for readings + meds. Sync on reconnect. db/sync.ts calls /sync/pull and /sync/push but not wired to app lifecycle.
- [ ] **Push token registration** — call registerForPushNotificationsAsync() on app launch, POST token to server.
- [ ] **Settings persistence** — preferences (language, large text) reset on app restart. Needs Zustand persist middleware with AsyncStorage.
- [ ] **Large text toggle** — toggle state exists but doesn't scale fonts. Need to apply LARGE_TEXT_SCALE (1.3x) to NativeWind/Tailwind config dynamically.
- [ ] **Profile inactivity check** — per CLAUDE.md: app open after 30+ min inactive -> show profile selector. Not implemented.
- [ ] **Undo reading** — "Undo" toast shows but doesn't call API to delete the reading.

---

## Critical patterns

- Prisma 7: datasource URL in prisma.config.ts, PrismaPg adapter
- GlucoseReading: @@unique([clientUuid, measuredAt]), findFirst not findUnique
- Pagination cursor: composite clientUuid_measuredAt string
- Express 5: async errors propagate natively, no express-async-errors
- Metro: custom resolver in metro.config.js for .js -> .ts workspace imports
- semver@7 forced via root package.json dep (reanimated needs functions/satisfies)
- Mobile field name: `measuredAt` (not measuredAtIso) — must match server Zod schema

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
