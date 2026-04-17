# SwasthParivar — Build Progress

**Last session:** 2026-04-16
**Branch:** main (4 commits local, unpushed — GitHub network issue at time of session)

## Current dependency versions

| Package | Version |
|---|---|
| Prisma (client + CLI) | 7.7.0 |
| @prisma/adapter-pg | 7.7.0 |
| Express | 5.x |
| TypeScript | 6.x |
| Vitest | 4.x |
| Expo SDK | 54 |
| React | 19 |
| React Native | 0.81 |
| expo-router | 6.x |
| pnpm | workspace |

## What exists

### Monorepo
pnpm workspace, TypeScript strict (no `any`, exactOptionalPropertyTypes,
noUncheckedIndexedAccess), ESLint (typescript-eslint recommendedTypeChecked),
Prettier, Vitest. Docker-compose with TimescaleDB + Redis. Claude Code
config with agents, skills, commands, and a PostToolUse hook that blocks
domain-logic from importing `@prisma`, `ioredis`, `bullmq`.

### `packages/`
- **shared-types** — source-referenced (main/types → `src/index.ts`, no
  dist build needed). Glucose thresholds hardcoded (65/315).
- **domain-logic** — pure functions, zero DB/network imports:
  - voice-parser (Hindi colloquial dict, longer-phrase priority,
    past-tense rejection, uncertainty detection)
  - streak-engine (3AM IST boundary via `streakDateFor()`, grace,
    anti-cheat flags)
  - feedback-engine (same-type comparison, 7-day rolling median,
    festive override, noise floor <10)
  - notification-resolver (priority order, fatigue levels 0-3,
    24hr dedup)
  - critical-bypass (always fullscreen+call; push/SMS skipped in cooldown)
- **test-factories** — faker-based User, GlucoseReading, UserStreak,
  NotificationState, voice transcript fixtures.

**45 unit tests pass.**

### `apps/server/` (Phase 1 scope)
Express 5 + Prisma 7 (strict, no `any`). **No express-async-errors** —
Express 5 propagates async errors natively.

**Database layer:** `pg.Pool` + `@prisma/adapter-pg` driver adapter pattern.
Datasource URL is NOT in schema.prisma — it lives in `prisma.config.ts`
(Prisma 7 external config). `database.ts` creates the pool and passes
the adapter to PrismaClient. On disconnect: `prisma.$disconnect()` then
`pool.end()`.

**Schema (9 models):** User, Household, EmergencyContact, GlucoseReading
(composite `@@id([id, measuredAt])` for hypertable + `@@unique([clientUuid, measuredAt])`),
MedicationSchedule, MedicationLog, UserStreak, FeedbackEvent, NotificationState.

**Migration:** `apps/server/prisma/migrations/20260416063106_init/` exists
but has NOT been applied to local Docker yet. Run after `docker-compose up -d`:
```
pnpm --filter=@swasth/server exec prisma migrate deploy
# then add hypertable:
docker exec -it <timescale-container> psql -U postgres -d swasth_parivar \
  -c "SELECT create_hypertable('glucose_readings', 'measured_at');"
```

Modules wired: auth (OTP+JWT), readings (idempotent by clientUuid,
version conflict → 409, enqueues CRITICAL_ALERT), medications, streaks,
sync (push/pull), dashboard, health. BullMQ critical-alert worker is a
stub — MSG91 + Expo Push not yet wired.

**Pagination cursor:** composite `${clientUuid}_${measuredAt.toISOString()}`
(not plain clientUuid — required because `@@id` is composite for hypertable).

**Integration tests:** `apps/server/tests/integration/health.test.ts` —
Testcontainers (TimescaleDB + Redis), runs prisma migrate deploy, creates
hypertable, then tests `/health` and `/health/deep`. Stub only — needs
`buildApp()` export from `app.ts` and the pool/adapter to accept dynamic URLs.

### `apps/mobile/` (Phase 1 scope)
Expo SDK 54, React Native 0.81, React 19, New Architecture, Expo Router v6,
NativeWind v4, Zustand, WatermelonDB, i18next (hi default).
`experimentalDecorators: true` for WatermelonDB models.

Routes: `(auth)` login/verify, `(onboarding)` language→condition→profile
→first-reading→medications, `(tabs)` dashboard/log/medications/settings,
plus SOS modal. Voice input is a stub — `expo-speech-recognition` not
yet wired. Analytics events shape matches root CLAUDE.md spec.

## Critical patterns (already applied, don't repeat)

- **Internal package type resolution**: `shared-types` + `domain-logic`
  both source-reference `src/index.ts` via package.json `main`/`types`/
  `exports`. No dist build in dev. Consumers import `@swasth/*` and TS
  resolves to source.
- **Prisma 7 config**: datasource URL goes in `prisma.config.ts`, NOT in
  `schema.prisma`. `PrismaClient` receives a `PrismaPg` adapter, not
  `datasources` override.
- **Express augmentation**: types in `apps/server/src/types.d.ts`
  augmenting `express-serve-static-core`. `@types/express-serve-static-core`
  must be an explicit dep (not transitive).
- **GlucoseReading unique constraint**: `@@unique([clientUuid, measuredAt])`
  — NOT `@unique` on clientUuid alone. TimescaleDB hypertable forces
  composite PK `@@id([id, measuredAt])`, which makes standalone unique
  indices incompatible. Queries use `findFirst({ where: { clientUuid } })`
  and update `where: { clientUuid_measuredAt: { ... } }`.
- **Voice parser colloquial matching**: phrases sorted by length DESC
  before lookup so "sava do sau"→225 matches before "do sau"→200.
- **Past-tense rejection**: `if (hasNegated) reject` unconditionally —
  do NOT gate on `!hasPresent`.
- **Streak boundary**: always use `streakDateFor(measuredAtIso, tzOffset)`
  — never fall back to raw `todayIso`.
- **Critical bypass**: fullscreen+call ALWAYS; only push/SMS skipped
  within 30-min cooldown.
- **Express 5**: do NOT add express-async-errors — Express 5 handles
  async errors natively.

## Pending work (Phase 1 completion)

1. **Voice API wiring** — replace `apps/mobile/src/components/logging/
   VoiceInput.tsx` stub with real `expo-speech-recognition` integration.
   Call `parseVoiceTranscript()` with actual transcript + confidence.
2. **Server BullMQ worker integrations** — wire Expo Push (primary) and
   MSG91 SMS (fallback) in `apps/server/src/workers/critical-alert.worker.ts`.
   Currently logs and exits.
3. **Apply migration + hypertable** — migration file exists; run against
   local Docker (see commands above). Then verify `@@unique([clientUuid, measuredAt])`
   is enforced at DB level.
4. **Integration tests wiring** — `health.test.ts` stub exists but
   `app.ts` needs `buildApp()` export and the database adapter needs
   to accept the Testcontainers URL at test time (dynamic import after env set).
5. **Push token registration** — `POST /api/v1/auth/push-token` endpoint
   not implemented; mobile `services/notifications.ts` has the client
   side ready.
6. **WatermelonDB sync wiring** — `apps/mobile/src/db/sync.ts` calls
   `/sync/pull` and `/sync/push`; server endpoints exist as stubs, need
   real conflict resolution matching root CLAUDE.md §13 (version-based
   with 409 on stale).

## Do NOT start Phase 2 until

- Papa logs 2+ readings/day for 14 consecutive days (CLAUDE.md success
  metric). Phase 1 ships first: glucose only, no BP, no meals, no AI
  chat, no guardian alerts, no SOS.
