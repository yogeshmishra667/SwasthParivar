# Phase 4 — Best-in-Class Implementation Plan

> Companion to: `CLAUDE.md`, `phase3.md`, `phase-3-progress.md`, `audit-progress.md`, `docs/ARCHITECTURE.md`.
> Status: draft 2026-05-27. Append a per-session log to `phase-4-progress.md` once the first PR opens.

---

## Context

Phase 1 (glucose-only logging, voice, critical-bypass, profile switcher, streaks, feedback) — shipped.
Phase 2 (BP, meals, insights, HbA1c estimate, health-score, family read-only) — shipped (PR #38).
Phase 3 (AI Chat / Cross-Condition + Correlation detectors / Silent Guardian) — Features A/B/C all shipped through PR #87. **Feature D — SOS — was specced in `phase3.md` §579 but never built** (gated on "4+ weeks Phase 2 stability"; that gate landed ≈ 2026-06-14). **SOS therefore carries into Phase 4 as the first feature, before any new surface.**
Admin Console (M0–M4) — shipped through PR #87.

Phase 4 ("Does it scale?") introduces:

1. The **first true emergency feature** (SOS, carried over from Phase 3).
2. The **first multi-condition surface** (cardiac + respiratory + activity + sleep).
3. The **first AI-into-medical-record path** (prescription OCR via Claude Vision, human approval required).
4. The **first doctor-side surface** (DoctorProfile + DoctorAppointment + pre-visit reports).
5. The **first revenue surface** (Razorpay + Apple IAP + subscription tier transitions).
6. **Wearables, regional languages, festival nudging, Indian food DB** — the scaling polish layer.

Three of these can harm a patient if wrong — wrong SOS routing, wrong prescription transcription, wrong tier-downgrade data-retention behaviour. **This plan is biased to safety, ramp-gating, kill switches, and pure-function testability over speed**, same as Phase 3.

**Outcome:** the system scales from single-disease habit loop → multi-condition family health platform with revenue, while every safety invariant in CLAUDE.md still holds.

---

## Carry-over from Phase 2 / Phase 3 / Admin (explicit pending list)

Before any new Phase 4 feature lands, the items below — un-shipped from earlier phases — must close. They are integrated into the Week 13–14 schedule. This section exists so a future reader can verify nothing was silently dropped.

### Pending from Phase 2 (per CLAUDE.md scope)

| Item                              | Why deferred                                         | Phase 4 home                                          | Blocker for                                |
|-----------------------------------|-----------------------------------------------------|-------------------------------------------------------|--------------------------------------------|
| `HealthCheckSchedule` model        | not built in Phase 2 — slipped                       | Week 13 schema migration `20260601000000_*`           | `SCHEDULE_COMPLIANCE_CHECK` cron, doctor portal adherence display |
| `HealthCheckCompliance` model      | depends on `HealthCheckSchedule`                     | Same migration as above                                | Same                                       |
| `schedule-compliance/` pure module | depends on schema                                    | Week 13                                                | `SCHEDULE_COMPLIANCE_CHECK` job logic       |

**Phase 2 items verified shipped (no carry-over):** `BPReading`, `MealLog`, `InsightEvent`, `HealthScore`, dashboard Hindi summary (`packages/domain-logic/src/dashboard-summary/`), HbA1c estimate (`modules/hba1c/`), guardian read-only view (`FamilyLink`, PR #38), spike + trend detectors.

### Pending from Phase 3 (per CLAUDE.md scope)

| Item                                                                | Why deferred                                                                                          | Phase 4 home                              | Blocker for                                                       |
|---------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------|-------------------------------------------|-------------------------------------------------------------------|
| Feature D — SOS (entire feature)                                    | hard-gated "4+ weeks Phase 2 stability"; gate landed but work slid                                    | Week 13 §D' (verbatim phase3.md §579+)    | Patient safety chain completeness                                  |
| `chat_sentiment` Silent Guardian signal                              | Phase 3 SG scope cap: "basic: med adherence + trend only" (CLAUDE.md)                                  | §C' Silent Guardian expansion             | Full SG signal coverage per CLAUDE.md "Silent Guardian" section    |
| `schedule_miss` SG signal                                            | depends on `HealthCheckCompliance` (above)                                                              | §C' + Week 13 carry-over                  | Same                                                               |
| `activity_drop` SG signal                                            | depends on `ActivityDaily` (Phase 4 Feature I)                                                          | §C'                                       | Same                                                               |
| `cross_signal` SG correlator                                         | depends on other signals being live                                                                    | §C'                                       | Same                                                               |
| Exotel/Twilio IVR vendor wrapper                                     | belongs in SOS — never built                                                                            | §D'.1                                     | SOS stage 2 escalation                                             |
| SOS multi-patient guardian routing + profile lock                    | not specced in phase3.md §D — gap discovered in this audit                                              | §D'.2                                     | Shared-device SOS correctness                                      |
| SOS quarterly drill protocol                                         | not specced in phase3.md §D                                                                             | §D'.3 + `docs/runbooks/sos-drill.md`      | Operational readiness                                              |

**Phase 3 items verified shipped (no carry-over):** AI Chat (server + mobile + WatermelonDB offline + STT + Tier 2 cache + retention sweep), cross-condition + meal-correlation detectors, basic Silent Guardian (med_adherence + data_anomaly), GuardianAlert + dispatch, anomaly detector (`packages/domain-logic/src/detectors/anomaly.ts`), CC.12 Feature Rollout & Targeting, maintenance-mode middleware, household-aware notifications + profile-aware guardian invites (PR #82), critical-bypass no-recipient paging (PR #80).

### Pending from Admin Console M0–M4 (per `admin-dashboard-progress.md` "Deferred")

| Item                                                  | Why deferred                                                                  | Phase 4 home                                | Blocker for                                       | Status |
|-------------------------------------------------------|-------------------------------------------------------------------------------|---------------------------------------------|---------------------------------------------------|--------|
| `User.active` / `deactivatedAt` (suspend a patient)    | patient-facing change, beyond additive admin API                              | Week 13 admin carry-over (new schema field) | **Payments** — can't suspend abusive paying users | **Landed (2026-05-28)** — server + admin UI |
| Runtime-adjustable rate limits                         | hardcoded in `shared/middleware/rate-limit.ts`; console shows read-only        | §T.2 (folded into tier-aware infra)         | Premium ramp incident playbook                     | |
| TOTP recovery codes + email-based admin password reset | admin operability only; no patient/revenue impact                              | **Stays deferred → Phase 5**                | Admin self-service recovery (low priority)         | |

**`User.active` admin carry-over — what shipped:**

- Schema: `users.active BOOLEAN NOT NULL DEFAULT true` + `deactivated_at` + `deactivation_reason` + `deactivated_by_admin_id` (UUID, no FK — `users` and `admin_users` are disjoint auth domains). Migration `20260601100000_user_active_field` is squawk-clean and byte-matches `prisma migrate diff`. Index on `(active)` keeps the admin list scan for deactivated rows cheap.
- New error code `USER_DEACTIVATED` → 403, mapped in `error-handler.ts`.
- Auth perimeter checks: `sendOtp` (DB lookup by phone — unknown phones still 200 so there is no user-enumeration leak), `upsertUserAndIssueTokens` (belt-and-suspenders for the Firebase path that skips `sendOtp`), and `refreshTokens` (now async, blocks both deactivated users AND unknown ids). Existing access tokens stay valid until they expire (≤1h) per the spec's explicit trade-off — no per-request DB check on `requireAuth`.
- Admin endpoints: `POST /admin/users/:id/deactivate { reason }` + `POST /admin/users/:id/reactivate`. super_admin + ops only. Idempotent: re-applying the same state returns 200 with `previouslyActive=false` and does NOT write a duplicate audit row, keeping `AdminAuditLog` a clean record of real transitions.
- Admin console UI: deactivate button (red, opens a dialog with a required `reason` textarea, 3–280 chars) + reactivate button (green, confirm dialog). When `user.active=false` a destructive Alert renders at the top of `UserDetailPage` with the reason + timestamp. Both buttons gated by `RoleGate allow={['super_admin','ops']}`.
- 11 integration test cases in `admin-users.test.ts` covering RBAC, idempotency, audit semantics, validation, 404, list-payload shape, plus the entire auth perimeter (send-otp blocked for deactivated phone; unknown phone still 200; refresh blocked with stale token; reactivate-then-refresh succeeds; unknown user id → 403).

**Admin items verified shipped:** PostHog query client (Session 3), Error Boundary at app root (Session 4), Feature-map viewer (Session 4), all of M0–M4 (RBAC, Users, Analytics, App Control, Ops, Audit, Admin Users, Billing scaffold).

### Pending from audit-progress.md long-term bucket

| Item                                                          | Why deferred                                                                | Phase 4 home                  |
|---------------------------------------------------------------|-----------------------------------------------------------------------------|-------------------------------|
| Dangerfile rules (audit item #9 — test-parity, migration-parity, large-PR explainer) | pure dev-loop; no patient/revenue impact                                  | **Stays deferred** (item #9 was the only [ ] not started; can land any time, doesn't gate Phase 4) |
| Extract `@swasth/{tsconfig,eslint-config,observability,...}` reusable packages (items #17, #18) | premature without a 2nd consumer repo — on audit's own overengineering-warnings list | **Stays deferred → revisit when 2nd repo exists**                          |

---

## Hard build-phase rules (CLAUDE.md, preserved + extended)

- **Critical-bypass thresholds, 30-min cooldown, 3 AM streak boundary — HARDCODED. Untouchable in Phase 4.**
- **AI never changes meds, never diagnoses.** Prescription OCR is *suggestion-only* — every item GREEN/YELLOW/RED requires human approval before it lands in `MedicationSchedule`. The post-response safety filter from Feature A applies to any new AI surface (e.g., doctor-summary paragraph in the PDF report).
- **SOS test mode (`sos_test_mode=true`) is the ship-default.** Real outgoing calls/SMS/IVR require an explicit flag flip after 7 internal-user days with zero false alarms.
- **Tier downgrade NEVER deletes patient health data.** It hides premium UI, locks premium endpoints, and disables premium jobs — `GlucoseReading`, `BPReading`, `MedicationLog`, etc. are retained per DPDP rules (CC.11 §5).
- **Wearable data is *evidence*, not *truth*.** Manual reading always wins over sensor reading for the same timestamp ± 60s. Source tag (`device`) is mandatory in every payload. No detector triggers on wearable-only data until 30 days of paired manual+wearable confirms agreement.
- **Regional language launches are scoped per language** — each new language needs the same 4 fixture buckets (colloquial, devanagari/regional script, noisy, past-tense) before voice-parser ships in that language.

---

## Phase 4 kill-switch flags (added on first use; default OFF)

- `sos_enabled` (boolean — gates the whole SOS surface)
- `sos_test_mode` (boolean — when true, escalation chain logs but does NOT call/SMS/IVR; default true)
- `sos_ivr_enabled` (boolean — gates Twilio IVR specifically; default false)
- `cardiac_logging_enabled` / `respiratory_logging_enabled` / `activity_logging_enabled` / `sleep_logging_enabled` (booleans)
- `prescription_ocr_enabled` (boolean — gates Claude Vision spend)
- `prescription_auto_approve_green` (boolean — default false; even GREEN items require human tap)
- `doctor_portal_enabled` (boolean)
- `appointment_reminders_enabled` (boolean)
- `weekly_report_enabled` (boolean)
- `wearable_healthkit_enabled` / `wearable_googlefit_enabled` (booleans, per-platform)
- `wearable_bluetooth_bp_enabled` / `wearable_bluetooth_glucose_enabled` (booleans)
- `festival_nudging_enabled` (boolean)
- `lang_marathi_enabled` / `lang_tamil_enabled` / `lang_bengali_enabled` / `lang_telugu_enabled` / `lang_gujarati_enabled` / `lang_punjabi_enabled` (booleans, per-language)
- `payments_razorpay_enabled` / `payments_apple_iap_enabled` (booleans)
- `tier_premium_enabled` / `tier_family_enabled` (booleans — gate purchase flow, not data access)

All read through `isFeatureEnabled(userId)` (CC.12.3). Cohort + percentage rollout supported on every flag by default.

---

## Sequencing principle (preserved from Phase 3)

```
Schema (migration, squawk-clean, additive) → Pure domain-logic functions (95%+ coverage; 100% for safety-critical)
  → Service layer (BullMQ jobs + Prisma) → Flag-gated HTTP endpoint
  → Integration test (Testcontainers + supertest) → Mobile integration behind flag
  → Internal cohort enable (≤ 10 users, 7 days no SEV1) → Ramp via percentage → Phase-4 done
```

Each feature lands in the same shape as Phase 3 Feature A/B/C — see `phase3.md` Feature A as the canonical template.

---

## Week-by-week sequence with gates

> "Week" is a logical unit, not calendar — gates matter, dates do not. Each gate must pass on `main` before the next week's PR opens.

### Week 13 — Carry-over: Feature D SOS scaffold + test-mode launch **and** Phase 2 carry-over (HealthCheckSchedule) **and** Admin carry-over (User.active)

**Admin Console carry-over (newly identified):** `M0–M4` shipped without `User.active` / `User.deactivatedAt` because suspending a patient is a patient-facing change. Phase 4 brings payments → must have suspend-on-abuse before revenue. Land alongside SOS schema:

- Schema: `User.active Boolean @default(true)` + `User.deactivatedAt DateTime?` + `User.deactivationReason String?` + `User.deactivatedByAdminId String?`. Migration: `20260601100000_user_active_field/`.
- Auth enforcement: `requireAuth` rejects with 403 `USER_DEACTIVATED` (new error code) when `active=false`. JWT refresh blocked. Existing JWTs still valid for ≤ 15min until expiry — patient can be locked out within their access-token TTL.
- Admin endpoint: `POST /admin/users/:id/deactivate { reason }` + `POST /admin/users/:id/reactivate`. Both audited via `AdminAuditLog`. super_admin or ops role only.
- **No data deletion on deactivation** — same retention rules as tier downgrade. Reactivation restores full access.
- Integration tests: deactivated patient cannot send-otp/verify-otp/refresh; deactivated guardian alerts still fire (medical safety > admin policy).

**Landed shape (2026-05-28) — see top-of-file carry-over table for the full summary.** One deliberate divergence from the spec line above: `requireAuth` does NOT do a per-request DB check (the spec was ambiguous; the "≤15min until expiry" clause was the right read). Existing access tokens stay valid until they expire (≤1h) and the auth perimeter — `sendOtp`, `upsertUserAndIssueTokens` (Firebase path), and the new async `refreshTokens` — is the chokepoint that ends the session for good. The trade-off is documented inline in `auth.service.ts`. Also added: the admin console UI (`UserDetailPage` deactivate/reactivate buttons + destructive banner when `active=false`).



**SOS:** reuse `phase3.md` §579–§720 verbatim. Nothing to redesign.

**Phase 2 carry-over (newly identified):** `HealthCheckSchedule` + `HealthCheckCompliance` were specced for Phase 2 (CLAUDE.md "Scheduling" section) but never shipped. They block the `SCHEDULE_COMPLIANCE_CHECK` cron and the doctor portal's adherence display. **Land them in Week 13 alongside the SOS schema** — same migration window, additive, no patient-facing change until the cron + UI ship in Week 17.

- Schema: `HealthCheckSchedule { user_id, check_type (glucose|bp|cardiac|respiratory), frequency, scheduled_times JSONB, reminder_enabled, active }` + `HealthCheckCompliance { schedule_id, user_id, expected_at, completed_at?, reading_id?, status (on_time|late|missed), reminder_count, guardian_notified }`. Migration `20260601000000_health_check_schedules/`.
- Pure module `packages/domain-logic/src/schedule-compliance/` — `evaluateCompliance(schedule, readings, now)` returning the next due slot + the missed-slot list. 95%+ coverage.

- **Gate to Week 14:** SOS state machine 100% branch coverage; full escalation chain integration test passes in test mode; `sos_enabled=true` + `sos_test_mode=true` rolled to 10 internal users for 7 consecutive days with zero false-alarm bypass-SMS sends. `HealthCheckSchedule` schema migration squawk-clean.

### Week 14 — SOS real-call ramp + Feature E.1 (CardiacLog + RespiratoryLog schema + pure detectors)

- **Gate to Week 15:** `sos_test_mode` flipped to false for 10-user cohort, ≥1 real cancel-without-incident drill executed end-to-end (drill recorded in `docs/runbooks/sos-drill.md` — new file).
- Cardiac + respiratory: schema migration + pure detectors only (no service wiring, no UI). Each detector 95%+ coverage, never-mix-conditions invariant baked into property tests.

### Week 15 — Feature E.2 (cardiac/respiratory service + mobile logging UI) + Feature F.1 (Prescription schema)

- **Gate to Week 16:** Cardiac + respiratory write paths idempotent (client_uuid + version); critical-bypass equivalents (HR < 40 or > 150, peak_flow < 50% of baseline) wired into existing `critical-alert` worker — verified via integration test.

### Week 16 — Feature F.2 (Claude Vision OCR + PrescriptionItem approval flow + photo cross-check)

- **Gate to Week 17:** 30 real prescription photos OCR'd in dev — manual eyeball confirms RED <60% / YELLOW 60–85% / GREEN >85% classification matches CLAUDE.md; zero auto-approvals (every item requires human tap).
- `prescription_ocr_enabled` ramped to 5 internal users for 7 days.

### Week 17 — Feature G (DoctorProfile + DoctorAppointment + appointment reminders + pre-visit PDF report)

- **Gate to Week 18:** Appointment reminder cron sends 7d/1d/2h pushes deterministically (Testcontainers + fake clock); PDF report renders Hindi+English with embedded AI summary paragraph (Claude API, safety-filtered identical to chat); `weekly_report_enabled` ramped.

### Week 18 — Feature H (Indian food DB seed + meal accuracy detector)

- **Gate to Week 19:** ≥ 200 IndianFoodItem rows seeded (verified, sourced, GI/GL values cited); meal search returns < 200ms p95; `correlation_meal` detector continues passing (regression).

### Week 19 — Feature I.1 (HealthKit + Google Fit ActivityDaily + SleepLog)

- **Gate to Week 20:** Wearable-vs-manual reconciliation rule (manual wins ± 60s) verified end-to-end; source tag mandatory at validation; 30-day "trust window" countdown started for each user opting in (Redis key `wearable_trust_until:${userId}`).

### Week 20 — Feature I.2 (Bluetooth BP cuff + Bluetooth glucometer integration)

- **Gate to Week 21:** Bluetooth pairing flow completes < 60s on Android + iOS for the two whitelisted devices (Omron HEM-7156T BP, Accu-Chek Instant glucometer); pairing failure falls back to manual without losing patient input.

### Week 21 — Feature J (Festival nudging engine + first regional language: Marathi)

- **Gate to Week 22:** Festival calendar covers next 90 days (Diwali, Holi, Karwa Chauth, Ramzan, Eid, regional New Year, Janmashtami, Ganesh Chaturthi, Christmas); copy passed by 2 native speakers per language; voice-parser Marathi fixtures match the CLAUDE.md template.

### Week 22 — Feature K (Razorpay + Apple IAP + tier transitions)

- **Gate to launch:** Razorpay webhook signature verification 100% branch covered; tier-downgrade integration test asserts zero `delete` calls against any patient health table; IAP receipt validation verified server-side (never trusted from client); refund webhook restores tier without data loss.

### Week 23 — Hardening, DR drill, beta ramp, Phase 4 close

- DR drill executed per `docs/runbooks/rollback.md`; SOS real-mode bumped to 50% of cohort; payments enabled for closed beta (invite-only flag).

---

## Feature D' — SOS (carry-over from Phase 3)

**Status:** spec exists at `phase3.md` §579. Implement verbatim with one Phase 4 addition:

### D'.1 New requirement — IVR fallback via Exotel / MyOperator

Twilio is not reliably available in India for outbound voice without enterprise contracts. **Default Phase 4 IVR vendor: Exotel** (Indian voice telephony, India-compliant, supports DTMF acknowledgement). Twilio kept as fallback for international guardians.

- `apps/server/src/shared/calls/exotel-voice.ts` (primary) — wraps the Exotel "Connect Application" API for outbound IVR + DTMF acknowledgement.
- `apps/server/src/shared/calls/twilio-voice.ts` (secondary, already specced in phase3.md) — fallback when called number is non-+91.
- Routing: `+91*` → Exotel; everything else → Twilio; both unset and `sos_ivr_enabled=true` → page Sentry with `SOS_IVR_NO_VENDOR` and continue with push+SMS+fullscreen (the safety chain must never fully fail).

### D'.2 Multi-patient guardian routing + profile lock

**Multi-patient guardian (CLAUDE.md "Multi-Patient Guardian"):** when a guardian watches N patients, an active SOS for any one of them **overrides all other guardian alerts**. The guardian dashboard sort key is `(sos_active DESC, urgency DESC, created_at DESC)` — an unresolved SOS pins to the top regardless of other patients' alerts.

**Profile lock at SOS trigger (CLAUDE.md "Voice + Profile Switch Lock" generalised):** when SOS triggers from a shared device, lock the active profile for the duration of the SOS (until `resolved` or `cancelled`). The locked profile is the patient identity carried in every push/SMS/IVR payload. Profile switcher is disabled during SOS. **A shared device cannot mid-SOS switch to a different patient.**

**Notification delivery:** SOS guardian pushes use `resolveHouseholdDelivery()` (shipped #82) for the patient's household, but emergency contacts route via `EmergencyContact.userId` (the patient's contacts, not the guardian's). When the patient is a non-primary profile, the SOS push to the household primary's device carries `data.targetUserId=<patient profile>` so a tap opens the app focused on the right profile.

### D'.3 Drill protocol (new — `docs/runbooks/sos-drill.md`)

Quarterly SOS drill (per CLAUDE.md cadence parity with the DR drill):

1. Internal user triggers SOS with `sos_test_mode=true`.
2. Verify each stage transition timestamp matches the state machine.
3. Verify Sentry breadcrumb chain is intact.
4. Cancel; verify cancellation propagates within 30s.
5. Promote to real mode for one internal user; trigger; cancel within stage_0 (60s window).
6. Log result + duration in `docs/runbooks/sos-drill.md` drill table.

**Drill cadence:** week of each Phase ramp, plus quarterly.

---

## Feature E — Multi-condition health logs (cardiac + respiratory + activity + sleep)

### E.1 Schema

Per CLAUDE.md "Project Structure → Database Schema → Health Readings". All four are **TimescaleDB hypertables**, all use the composite-PK pattern from `GlucoseReading` (no standalone `@unique clientUuid` — see CLAUDE.md note on hypertable PKs).

```prisma
model CardiacLog {
  id                  String   @default(uuid())
  clientUuid          String
  userId              String
  user                User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  heartRate           Int
  rhythmStatus        RhythmStatus  // regular | irregular | unknown
  chestPain           Boolean
  painSeverity        Int?     // 0-10 if chestPain
  exerciseTolerance   ExerciseTolerance  // normal | reduced | severe
  source              ReadingSource  // manual | voice | device
  measuredAt          DateTime
  updatedAt           DateTime @default(now())
  version             Int      @default(1)
  syncedAt            DateTime @default(now())

  @@id([id, measuredAt])
  @@unique([clientUuid, measuredAt])
  @@index([userId, measuredAt(sort: Desc)])
}

model RespiratoryLog { /* peakFlow Int? | inhalerUsed Bool | inhalerType String? | puffs Int? | triggerNote String? | symptomSeverity SymptomSeverity */ }
model ActivityDaily   { /* userId, date (DATE), steps Int, distanceMeters Int, activeMinutes Int, source ActivitySource (healthkit|googlefit|manual), @@unique([userId, date, source]) */ }
model SleepLog        { /* userId, date, sleepStart DateTime, sleepEnd DateTime, durationMinutes Int, quality SleepQuality, source */ }
```

Migration: `20260620000000_cardiac_respiratory_activity_sleep/migration.sql`. Run squawk; expected exclude: `prefer-text-field`. ActivityDaily + SleepLog **are NOT hypertables** (one row per day per source — small fan-out, regular PK suffices).

### E.2 Pure domain-logic additions (`packages/domain-logic/src/`)

1. **`cardiac-thresholds/`** — `classifyCardiacReading(hr, rhythm, chestPain)`. Returns `{ severity: "normal"|"warn"|"critical_bypass", reason: string }`. **Critical-bypass:** HR < 40 OR HR > 150 OR (chestPain && severity ≥ 7) → routes through the existing `critical-alert.processor.ts` chain. **100% branch coverage (safety-critical).**

2. **`respiratory-thresholds/`** — `classifyRespiratoryReading({ peakFlow, baselinePeakFlow, inhalerUsed, symptomSeverity })`. **Critical-bypass:** `peakFlow < baselinePeakFlow * 0.5` (asthma red-zone) OR symptomSeverity === "severe". **100% branch coverage.**

3. **`activity-aggregator/`** — `dailyActivitySummary(logs)`. Pure. Handles dedup across sources (HealthKit + manual same day → manual wins).

4. **`sleep-quality-classifier/`** — `classifySleep({ durationMinutes, sleepStart, sleepEnd })`. Returns adequate/short/fragmented/long.

5. **`detectors/cardiac-trend.ts`** + **`detectors/respiratory-trend.ts`** — additions to the existing detector framework. Same sparsity rules as Phase 3 (≥ 7 days for spike, ≥ 14 days + R² > 0.5 for trend). Never-mix-conditions: cardiac trend never sees BP/glucose, respiratory trend never sees cardiac.

### E.3 Server modules

- `apps/server/src/modules/cardiac/` — `cardiac.{routes,controller,service,validation,types}.ts`. Routes per CLAUDE.md: `POST /api/v1/readings/cardiac`, `GET /api/v1/readings/cardiac`.
- `apps/server/src/modules/respiratory/` — symmetric.
- `apps/server/src/modules/activity/` — `POST /api/v1/activity/daily`, `GET /api/v1/activity?from=&to=`.
- `apps/server/src/modules/sleep/` — `POST /api/v1/sleep`, `GET /api/v1/sleep`.

**Cross-cutting:** the four services reuse `checkIdempotent` (`shared/idempotency.ts`); cardiac + respiratory writes enqueue `ANALYZE_READING` jobs the same way glucose/BP do today; critical-bypass enqueue happens **inside the same write path** (parity with `readings.service.ts`).

### E.4 Integration tests

`tests/integration/cardiac.test.ts`, `respiratory.test.ts`, `activity.test.ts`, `sleep.test.ts` — each ≥ 15 cases. Mandatory:

- Idempotent replay (same `clientUuid` twice → 200 not 500).
- Stale version → 409.
- Critical-bypass enqueue verified via spy on `CRITICAL_ALERT` queue.
- ActivityDaily dedup: HealthKit + manual same day → response shows manual source.
- Source tag missing in payload → 400 with `READING_INVALID_VALUE`.

### E.5 Mobile (Section M.2)

Behind `cardiac_logging_enabled` / `respiratory_logging_enabled` / `activity_logging_enabled` / `sleep_logging_enabled` flags (CC.12). New tabs do NOT appear until the resolver returns true.

- Cardiac log screen (3-tap: pick HR → rhythm toggle → chest-pain toggle → save).
- Respiratory log screen (peak-flow + inhaler toggle).
- Activity dashboard widget (steps + active minutes from HealthKit; manual override available).
- Sleep dashboard widget (last night summary).
- Voice parsing extended to cardiac numbers ("dil ki dhadkan 85") + respiratory ("peak flow do sau"). New voice fixtures land in `packages/test-factories/src/voice-transcript.fixtures.ts`.

---

## Feature F — Prescription OCR + medication management

### F.1 Schema

```prisma
model Prescription {
  id                  String   @id @default(uuid())
  userId              String
  doctorId            String?
  originalPhotoUrls   String[]  // R2 keys
  ocrRawResult        Json      // full Claude Vision response, retained for audit
  status              PrescriptionStatus  // pending_ocr | pending_approval | approved | rejected | partial
  approvedBy          String?   // userId of patient/guardian who tapped approve
  approvedAt          DateTime?
  rejectedAt          DateTime?
  rejectionReason     String?
  prescribedDate      DateTime?
  createdAt           DateTime  @default(now())

  items               PrescriptionItem[]

  @@index([userId, createdAt(sort: Desc)])
  @@index([status])
}

model PrescriptionItem {
  id                       String   @id @default(uuid())
  prescriptionId           String
  prescription             Prescription @relation(fields: [prescriptionId], references: [id], onDelete: Cascade)
  ocrMedicineName          String
  ocrDosage                String
  ocrFrequency             String
  ocrConfidence            Float    // 0-1
  ocrAlternatives          Json?    // [{name, confidence}]
  ocrColor                 PrescriptionItemColor // red | yellow | green (CLAUDE.md classification)
  verifiedMedicineName     String?
  verifiedDosage           String?
  verifiedFrequency        String?
  medicationScheduleId     String?  // backfilled when patient/guardian approves
  status                   PrescriptionItemStatus  // pending | approved | rejected | needs_doctor

  @@index([prescriptionId])
  @@index([status])
}

model MedicinePhoto {
  id                       String   @id @default(uuid())
  medicationScheduleId     String
  photoUrl                 String
  aiReadName               String?
  matchStatus              MedicineMatchStatus // match | mismatch | unclear
  matchConfidence          Float
  verified                 Boolean  @default(false)
  createdAt                DateTime @default(now())
}
```

Migration: `20260627000000_prescriptions/migration.sql`.

### F.2 Trust model — "AI suggests, guardian decides"

**Core failure mode (the reason this whole feature exists):** doctors hand-write prescriptions in ten different scripts at illegible speed. AI will misread some lines. The patient is 60-70 years old and will tap "Haan, sahi hai" through whatever appears on screen. **Wrong medication kills.** So the entire flow is built around removing the elderly patient from the approval loop and putting the **guardian** in the approver seat, with explicit hooks to correct AI errors at approval time.

**Approval authority** — derived at upload time from the patient's `FamilyLink` state:

| Patient situation                                                                  | Canonical approver                              | What patient sees                                                                                       |
|------------------------------------------------------------------------------------|--------------------------------------------------|---------------------------------------------------------------------------------------------------------|
| Has ≥ 1 accepted `FamilyLink` with relationship in (`child`, `spouse`, `caregiver`) | The primary guardian (lowest `priority` or `child` first) | "Approval ke liye [Rohan ji] ko bheja gaya. Unko notification mil gayi hai."                            |
| No guardian linked (solo)                                                          | Patient themselves, with **extra friction**       | High-contrast "Yeh sirf doctor ki di hui dawai hai? Sahi hai?" + 3-second activation delay on Approve.   |
| Patient is themselves a guardian (adult)                                            | Self-approval allowed (already implies capacity) | Standard approve flow.                                                                                  |

`Prescription.requiresGuardianApproval` (new column) — resolved at upload, immutable afterwards (so a guardian being removed mid-approval can't suddenly drop authority back to the patient).

**Patient role on the elderly device:** the patient can *initiate* an upload (take photos, hit submit) but cannot *approve*. The prescription detail screen on the patient device shows the items in read-only with a "[Guardian name] ko bheja — wait karein" banner. This is the same pattern shipped in PR #82 for guardian invites.

### F.3 Upload flow — paired prescription + medicine photos in ONE step

Two failure modes drive the paired-upload design:

1. AI reads "Glycomet 500" but the bottle in the cabinet actually says "Glycomet GP 1". A schedule built only from the prescription would have the patient taking the wrong drug at the right dose.
2. AI reads a name as `<unclear>` (confidence ≈ 30%). With no second source, the item is dead in the water until someone types it.

Both are solved by capturing the medicine bottle photos *at the same upload moment* as the prescription, then running a paired Vision pass.

**Upload screen flow (mobile):**

1. "Doctor ki parchi ki photo lein" — patient/guardian captures 1–N prescription pages.
2. **"Kya aapke paas dawai ka packet hai? Photo bhej dein — match check karne ke liye."** — capture 0–N medicine bottle/strip photos. **Encouraged but not required** — skip is fine, the system falls back to single-source OCR.
3. Submit → all photos upload to R2 in one multipart POST.
4. Server creates one `Prescription` row + `MedicinePhoto` rows linked to the prescription (not yet to any schedule).
5. Enqueues a single `PRESCRIPTION_OCR` job carrying `prescriptionId` AND `pairedMedicinePhotoIds[]`.

**The OCR job now runs two Vision passes**, then reconciles:

- **Pass A (text):** Vision reads each prescription page → list of `{name, dosage, frequency, confidence}` candidates per line.
- **Pass B (bottles):** Vision reads each medicine bottle photo → list of `{aiReadName, confidence}` per bottle.
- **Reconcile:** for each candidate from Pass A, fuzzy-match (Levenshtein + Indian-brand alias table) against every name from Pass B. A match in Pass B promotes confidence ("AI read it AND the bottle agrees"); a mismatch lowers confidence; no Pass B at all = single-source result.

This is implemented as a pure domain-logic module `prescription-paired-reconciliation/` so it's fully testable without hitting Vision twice in tests.

### F.4 Item state machine (revised — includes `need_clarification`)

```
              upload
                 │
                 ▼
       ┌────────────────┐
       │ pending_ocr    │   ← waiting for PRESCRIPTION_OCR job
       └────────┬───────┘
                │ Vision passes complete + reconcile
                ▼
   ┌─────────────────────────────────────────┐
   │ Per-item color classification           │
   │ (prescription-color-classifier)          │
   └─────────────────────────────────────────┘
        │             │              │             │
        ▼             ▼              ▼             ▼
     GREEN         YELLOW         RED          need_clarification  ◀── NEW
   (≥85% AND   (60–85%, or    (<60% AND      (<60% AND no bottle
   bottle      85%+ but no     bottle         photo OR Vision said
   matches)    bottle)         mismatch)      "could not read")
        │             │              │             │
        │             │              │             │ approver-side action:
        │             │              │             │  • Take/upload bottle photo
        │             │              │             │  • Type the medicine name
        │             │              │             │  • Add free-text note
        │             │              │             │       │
        │             │              │             ▼       │
        │             │              │       (re-run Vision pass for this item)
        │             │              │             │       │
        │             │              │             ▼       │
        │             │              │       (item moves to RED/YELLOW/GREEN
        │             │              │        or stays in need_clarification)
        │             │              │             │
        ▼             ▼              ▼             ▼
   approver reviews each item, optionally corrects, approves OR rejects OR escalates
        │             │              │             │
        ▼             ▼              ▼             ▼
   approved      approved        approved      needs_doctor  (terminal — never auto-schedule)
   (one tap)     (must         (must type     OR rejected
                 type-correct   AND upload
                 all fields)    bottle photo)
        │             │              │
        └──── creates MedicationSchedule (transactional) ────┘
```

**`need_clarification` is the new state your flow described** — "AI can't understand, ask for medicine photo or typed input." Until clarified, the item is *parked*, not silently dropped; the prescription stays `partial` and shows up on the approver's queue as "1 item needs your help".

### F.5 Schema additions (versus the initial §F.1 sketch above)

Update `PrescriptionItem`:

```prisma
model PrescriptionItem {
  // ... existing fields ...
  status                   PrescriptionItemStatus  // pending | need_clarification | approved | rejected | needs_doctor
  aiSuggestionHistory      Json     // append-only audit: every Vision pass + every approver correction
  pairedMedicinePhotoIds   String[] // MedicinePhoto IDs that informed the suggestion at OCR time
  approvedByUserId         String?  // who hit Approve (guardian or solo patient)
  approvedAt               DateTime?
  approverCorrections      Json?    // what fields the approver changed from AI's suggestion
  approverNote             String?  // free-text "Dr said 500mg twice daily, prescription unclear"
}

model Prescription {
  // ... existing fields ...
  requiresGuardianApproval Boolean  // resolved at upload, immutable
  approvalRequestedAt      DateTime? // when push went out to the guardian
  approvalCompletedAt      DateTime?
}

model MedicinePhoto {
  // ... existing fields, plus: ...
  prescriptionId           String?  // linked to prescription at upload time (BEFORE a schedule exists)
  prescriptionItemId       String?  // linked to specific item after reconciliation
  medicationScheduleId     String?  // backfilled after approval creates the schedule
  uploadedAt               UploadContext  // initial_upload | mid_approval_clarification | post_schedule_routine_check
}
```

**`aiSuggestionHistory` is the auditable diff** — every Vision call, every approver tap, every text correction goes in as an array entry `{at, by, source: "vision_pass_a"|"vision_pass_b"|"vision_clarification_pass"|"approver_correction", ...}`. If three months later the patient turns up with the wrong drug in their cabinet, ops can replay exactly what happened: which photo, which AI pass, which corrections, who approved. Same audit philosophy as `PaymentEvent.rawPayload`.

### F.6 Pure domain-logic

1. **`prescription-color-classifier/`** — `classifyPrescriptionItem({ ocrConfidence, photoCrossCheckStatus, hasPairedMedicinePhoto })`:
   - `photoCrossCheckStatus === "mismatch"` → RED (overrides all).
   - `ocrConfidence < 0.60` AND `hasPairedMedicinePhoto === false` → **`need_clarification`** (NEW — was RED in original spec).
   - `ocrConfidence < 0.60` AND `hasPairedMedicinePhoto === true` AND bottle matched something → RED (Vision read poorly but we have a bottle hint; force type-correct + bottle-photo-upload before approve).
   - `0.60 ≤ ocrConfidence < 0.85` → YELLOW.
   - `ocrConfidence ≥ 0.85` AND `photoCrossCheckStatus === "match"` → GREEN.
   - `ocrConfidence ≥ 0.85` AND no paired photo → YELLOW (no second source — refuse to mark GREEN without a bottle, per your flow).
   - **100% branch coverage. Property test: no input combination escapes the 5-way classification.**

2. **`prescription-safety-validator/`** — preserved as in original §F.

3. **`prescription-paired-reconciliation/`** (NEW) — pure reconciliation of Pass A (prescription text) vs Pass B (bottle photos). Inputs: candidate lists. Output: per-prescription-item, the best name + a `photoCrossCheckStatus` of `match | mismatch | not_attempted`. Indian-brand alias table is data, not code (`packages/domain-logic/src/medicine-aliases/indian-brands.json` — checked-in, updatable via PR). 95%+ coverage.

4. **`prescription-approver-resolver/`** (NEW) — pure function: `resolveApprover(patientUser, familyLinks): { approverUserId, requiresGuardianApproval, frictionLevel }`. Encodes the table in §F.2. 100% branch coverage (safety-critical).

### F.7 Claude Vision wrapper

Same spec as original — `apps/server/src/shared/ai/claude-vision.ts`, circuit breaker, spend cap, `CLAUDE_VISION_DAILY_SPEND_CAP_USD`, PII guard via `PrescriptionContext`. **Extension:** wrapper accepts `mode: "prescription_text" | "medicine_bottle" | "clarification_pass"` to switch the system prompt; same temperature 0, same max tokens, same retry policy.

### F.8 BullMQ jobs

- `PRESCRIPTION_OCR` — fires on prescription upload. Runs Pass A on every prescription page, runs Pass B on every paired medicine photo, calls `prescription-paired-reconciliation` purely, writes `PrescriptionItem` rows with their initial color/state. Records every Vision call in `aiSuggestionHistory`. Idempotent (`jobId = ocr-${prescriptionId}`). Spend-cap honoured.
- `MEDICINE_PHOTO_CROSS_CHECK` — for `MedicinePhoto` uploads tagged `post_schedule_routine_check` (i.e., the existing CLAUDE.md medicine-bottle-photo flow after a schedule exists). Compares against the linked schedule's name. Writes `matchStatus`. Mismatch flag only (NOT auto-action).
- `PRESCRIPTION_CLARIFICATION_OCR` (NEW) — fires from the mid-approval clarification flow. Takes one item + a new bottle photo or typed name, runs one Vision pass, updates the item's `aiSuggestionHistory` + re-classifies via `prescription-color-classifier`. Idempotent per `(itemId, clarificationAttemptId)`.

### F.9 HTTP routes

- `POST /api/v1/prescriptions/upload` — multipart, accepts **two photo arrays in one request**: `prescriptionPhotos[]` and `medicinePhotos[]`. multer → sharp (EXIF stripped) → R2. Server resolves the approver via `prescription-approver-resolver` and sets `Prescription.requiresGuardianApproval`. Enqueues `PRESCRIPTION_OCR`. Returns the `prescriptionId` so the patient device can poll for OCR completion. Prescription photos: max 10MB each. Medicine photos: max 5MB each.

- `GET /api/v1/prescriptions/:id` — full prescription + items + linked MedicinePhotos + `aiSuggestionHistory` (read access governed by household + `requireAdminRole` for admin queue).

- `POST /api/v1/prescriptions/:id/items/:itemId/clarify` (NEW) — the mid-approval correction endpoint. Body:
  ```json
  {
    "newMedicinePhotoId": "uuid-or-null",  // if approver uploaded a fresh bottle photo
    "typedMedicineName": "Glycomet GP 1",  // optional approver-typed name
    "approverNote": "Dr ne kaha 500 nahi, GP 1 hai",
    "clarificationAttemptId": "uuid-from-client"  // idempotency
  }
  ```
  → enqueues `PRESCRIPTION_CLARIFICATION_OCR`, transitions the item back to `pending_ocr` with a `clarification` marker. Returns 202.

- `POST /api/v1/prescriptions/:id/approve` — guardian-only path; server enforces `req.user.id === resolveApprover(...).approverUserId`. Body:
  ```json
  {
    "items": [
      {
        "id": "uuid",
        "decision": "approve" | "reject" | "needs_doctor",
        "verifiedMedicineName": "...",
        "verifiedDosage": "...",
        "verifiedFrequency": "...",
        "approverNote": "optional"
      }
    ]
  }
  ```
  Approve → creates `MedicationSchedule` rows + links `MedicinePhoto` rows for ongoing matching. All-or-nothing for the items listed; partial approval valid (some `approve`, some `needs_doctor`, leaving others still `pending_ocr` for later). **GREEN items still require this explicit POST** with verified fields — `prescription_auto_approve_green=false` is the ship default.

- `POST /api/v1/prescriptions/:id/reject` — whole-prescription rejection. Cascades to items.

- `POST /api/v1/medicines/:id/photo` — preserved per CLAUDE.md for post-schedule routine cross-checks. Uses `uploadedAt: post_schedule_routine_check`.

### F.10 Solo patient flow (no guardian)

For users without a `FamilyLink`, `requiresGuardianApproval=false` and the patient self-approves — but with hard friction:

- Three-second activation delay on the Approve button (per CLAUDE.md double-confirmation pattern).
- A "Yeh dawai aapke doctor ne hi prescribe ki hai? Bilkul pakka?" confirmation modal before approval lands.
- A nudge after the first solo approval: "Family ko jodne se safety badhti hai — kya aap apne bete/beti ya partner ko add karna chahenge?" (one-tap to FamilyLink invite flow).
- Solo approvals captured in PostHog as `prescription_self_approved{itemCount}` so admin can watch for solo-user OCR error rates separately.

### F.10b Missing-item augmentation — guardian adds what the patient missed

**The real-world case:** father takes a photo of page 1 but skips page 2. Or AI extracts 4 out of 5 lines and silently drops the blurry one — guardian sees the prescription, knows there's a fifth medicine, but it's not in the list. The system must let the guardian **add a missing item** at approval time, not force a re-upload-from-scratch.

This is distinct from `/clarify` — `/clarify` corrects an existing item; this **creates a new item** inside the same prescription.

#### F.10b.1 Two routes, depending on what the guardian has in hand

| Guardian has...                                  | Route                                                       | Behaviour                                                                                                                       |
|--------------------------------------------------|-------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------|
| An additional photo (missed prescription page OR a bottle photo of a missing medicine) | `POST /api/v1/prescriptions/:id/photos`                        | Appends the photo to the existing prescription; enqueues `PRESCRIPTION_OCR_DELTA` (new job) that runs Vision on **just the new photo**, reconciles against existing items, and creates **new `PrescriptionItem` rows for anything the new photo introduces**. |
| Only the medicine name (no photo, just knows what was prescribed) | `POST /api/v1/prescriptions/:id/items` (manual add)             | Creates one new `PrescriptionItem` with `source: "approver_added"`, `ocrConfidence: null`, and the typed fields as `verifiedMedicineName/Dosage/Frequency`. Classification is YELLOW by definition (typed-only = single source, no AI corroboration). |

#### F.10b.2 `POST /prescriptions/:id/photos` — append photos

Body (multipart):
```
prescriptionPhotos[]   // 0-3 new prescription pages
medicinePhotos[]       // 0-5 new bottle photos
deltaUploadId          // client-side idempotency UUID
```

Server:
1. Verifies caller is the resolved approver (same authority check as `/approve` and `/clarify`).
2. Verifies prescription is in `pending_approval` status (cannot append to `approved`, `rejected`, or `archived`).
3. Stores photos in R2 with the same EXIF strip + size limits.
4. Enqueues `PRESCRIPTION_OCR_DELTA` (job ID `ocr-delta-${prescriptionId}-${deltaUploadId}` for idempotency).
5. Returns 202 with the prescription ID; mobile polls for OCR completion.

`PRESCRIPTION_OCR_DELTA` job behaviour:
- Runs Vision Pass A on the new prescription pages → produces candidate items.
- Runs Vision Pass B on the new bottle photos → produces candidate names.
- Reconciles new candidates against **both** the existing items AND each other (a new bottle photo can also be the bottle for an *existing* item that was previously single-source — in which case it promotes that existing item from YELLOW to GREEN via `/clarify` semantics).
- New items added with full `aiSuggestionHistory` capturing the delta upload as the source.
- A new bottle photo that matches an existing item updates *that item's* history; no duplicate item created.

This is the trickiest part — the reconciler must not create duplicate items when the new photo is just better evidence for something already in the list. Pure module `prescription-delta-reconciliation/` owns this logic, 95%+ coverage, property test: "applying delta N times converges (no infinite growth)."

#### F.10b.3 `POST /prescriptions/:id/items` — manual add by approver

Body:
```json
{
  "typedMedicineName": "Telmisartan 40",
  "typedDosage": "40 mg",
  "typedFrequency": "1-0-0",
  "approverNote": "Page 2 mein tha, photo nahi aayi clearly",
  "addAttemptId": "uuid"
}
```

Server creates a `PrescriptionItem` with:
- `ocrMedicineName: null`, `ocrConfidence: null`, `ocrColor: yellow` (manual-add is always YELLOW — single source, no AI corroboration).
- `verifiedMedicineName/Dosage/Frequency` pre-filled from the typed fields (so it shows up as already type-corrected on the approval screen).
- `aiSuggestionHistory[0] = { source: "approver_added", by: approverUserId, at, payload: { typed: {...}, note: "..." } }`.

The item still has to be approved like everything else — manual-add does NOT skip the approval gate. This preserves the "no item becomes a schedule without an explicit `/approve` POST" invariant.

#### F.10b.4 What this lets the guardian do, end to end

A realistic flow:

1. Father uploads prescription page 1 + 2 bottle photos. OCR runs. 3 items extracted, 1 GREEN + 1 YELLOW + 1 in `need_clarification`.
2. Guardian opens approval screen, fixes the YELLOW, clarifies the `need_clarification` with another bottle photo. Now 3 items ready.
3. **Guardian notices the prescription was 2 pages and there's a 4th medicine missing.** Asks father to take photo of page 2. Father sends. Guardian uploads via `POST /prescriptions/:id/photos`. OCR delta runs → 4th item appears in approval screen with its own classification.
4. **Guardian also remembers doctor mentioned Vitamin D3 separately, not on prescription.** Adds manually via `POST /prescriptions/:id/items` → appears as a YELLOW item with approver-typed fields, note: "Doctor ne separately bola".
5. Guardian taps Approve → 5 medication schedules created in one transaction.

At every step, the approver can keep extending until they hit Approve. Once approved, the prescription is locked — further additions require a new prescription upload.

#### F.10b.5 Mobile UX

On the guardian approval screen, **below the per-item cards**, two persistent CTAs:

- **"Aur photo add karein"** → camera → photo strip identical to initial upload (prescription + medicine tabs). Tapping submit fires `POST /:id/photos`. Loading state while OCR delta runs (~3-8 sec); new items animate in.
- **"Dawai khud add karein"** → text form (name + dosage + frequency + note). Tapping submit fires `POST /:id/items` → new YELLOW card appears in the list.

Both CTAs disappear once the approver taps the per-prescription Approve button (or the prescription is rejected).

#### F.10b.6 Audit + safety

- Every manual-add item is tagged `source: "approver_added"` in `aiSuggestionHistory` so admin can filter "what did approvers add by hand?" — useful signal for "is our OCR missing common patterns?"
- A guardian who manual-adds more than 3 items per prescription on average → flagged in PostHog (`prescription_high_manual_add_rate{userId}`); possible signal that OCR is failing systematically for that doctor's handwriting style.
- Manual-added items still respect the dosage > 99% percentile + frequency > 6×/day → `needs_doctor` safety validator.

### F.11 Integration tests

`tests/integration/prescription.test.ts` ≥ 25 cases (up from 20). The new cases beyond original §F.6:

- Paired upload happy path: prescription + bottle photos arrive together → reconciliation marks GREEN where bottle matches.
- Paired upload, bottle name mismatches prescription → all matched items go RED regardless of OCR confidence.
- Single-source upload (no bottle photo) → highest possible classification is YELLOW (never auto-GREEN).
- AI returns `confidence < 0.60` with no paired bottle → item goes to `need_clarification`, no schedule possible.
- `POST /clarify` with a bottle photo → fresh Vision pass updates the item; classification may move from `need_clarification` → YELLOW or GREEN.
- `POST /clarify` with only `typedMedicineName` (no photo) → item moves to YELLOW (typed name treated as one source).
- Approver authority: solo patient with linked guardian tries to call `/approve` → 403 `APPROVAL_REQUIRES_GUARDIAN`.
- Approver authority: guardian calls `/approve` for a patient they're linked to → 200.
- Approver authority: random third user tries `/approve` → 403.
- Solo flow: patient with no FamilyLink approves successfully; PostHog `prescription_self_approved` fired.
- `aiSuggestionHistory` audit: after one initial OCR + one clarification + one approver correction, the history array has 3 entries with correct `source` tags.
- Approval with mixed decisions (3 approve, 1 needs_doctor, 1 left untouched) → 3 schedules created, 1 item terminal, 1 still pending.
- Re-clarification: an item already clarified once can be clarified again (idempotency on `clarificationAttemptId`).
- **Append photos:** guardian calls `POST /:id/photos` with a new prescription page → OCR delta creates new items; existing items untouched.
- **Append photos — new bottle for existing item:** guardian adds a bottle photo that matches an existing YELLOW item → existing item promotes to GREEN; no duplicate item created (delta-reconciliation idempotency).
- **Append photos — duplicate delta upload:** same `deltaUploadId` posted twice → second call is no-op, no duplicate items.
- **Manual add:** guardian calls `POST /:id/items` with typed name/dosage/freq → new YELLOW item appears with `source: "approver_added"`, `ocrConfidence: null`, verified fields pre-filled.
- **Append after approval:** guardian tries `POST /:id/photos` on an already-`approved` prescription → 409 `PRESCRIPTION_LOCKED`.
- **Append authority:** non-approver calls `/:id/photos` or `/:id/items` → 403 `APPROVAL_REQUIRES_GUARDIAN`.
- **Mixed end-to-end:** initial upload + 1 clarify + 1 append-photos (adds 1 item) + 1 manual-add → approve all 5 items → 5 schedules created transactionally; `aiSuggestionHistory` audit chain is intact across every step.
- (existing) OCR happy path, mixed colors, approval transactional, missing fields → 400, spend cap, PII compile-time test, rejection cascade, user-delete cascade.

### F.12 PostHog events (additions)

```
prescription_uploaded{prescription_photos, medicine_photos, requires_guardian_approval}
prescription_ocr_passes_completed{pass_a_items, pass_b_items, reconciled_items}
prescription_need_clarification_item{itemId, reason}
prescription_clarified{itemId, attempt_number, source: bottle_photo|typed|note}
prescription_approver_corrected{itemId, fields_changed: ["name"|"dosage"|"frequency"]}
prescription_self_approved{items_count}
prescription_approval_authority_blocked{reason}  // patient tried to self-approve when guardian required
```

These feed two new developer alerts:

- `prescription_approver_corrected` rate > 30% per week → Vision OCR is drifting; investigate.
- `prescription_need_clarification_item` rate > 20% per week → handwriting / prescription-photo quality issue; consider improving the upload UX (zoom, focus, multi-angle).

### F.13 Mobile UX (Section M.2 addition)

**Upload screen** — single screen with two photo strips: top "Doctor ki parchi (1-3 photos)" + bottom "Dawai ka packet (optional, 1-5 photos)". Both use the existing camera capture flow. Both strips show a count badge ("2/3 added") and a clear-all button.

**Approver screen (guardian device)** — push notification "Naya prescription approve karein — [patient name]". Opens the prescription detail. For each item:

- GREEN with bottle match → big green card, "Sahi lag raha hai" + Approve button.
- YELLOW → editable name/dosage/frequency fields, Approve disabled until all three touched.
- RED → editable fields + a "Dawai ki photo lein" button → camera. On photo capture, fires `POST /clarify` with the new photo. After the clarification pass completes, the card transitions in place to its new color.
- `need_clarification` → big yellow banner, "AI dawai ka naam nahi padh paayi". Two CTAs: "Dawai ki photo lein" + "Naam type karein". Either fires `/clarify`. Card transitions in place.

The "approve" CTA is **never** a sticky bottom button on multi-item prescriptions — each item must be touched individually before the per-prescription Approve at the bottom enables. This is intentional friction.

**Patient screen (elderly device, guardian-required mode)** — same prescription detail screen but read-only. Banner: "[Guardian name] ko approval ke liye bheja gaya hai. Notification jaa chuki hai." A "Resend nudge to guardian" link after 1 hour. No tap-to-approve.

### F.14 Safety net — when everything fails

If after one initial OCR + N clarification attempts an item is still `need_clarification` (configurable max N=3), the UI moves it to `needs_doctor` automatically: "Doctor se confirm karke khud add karein. AI yeh dawai nahi padh paayi." The item is then **terminal** — no schedule can be created from it, ever. The approver can still add a corresponding `MedicationSchedule` *by hand* via the regular Phase 1 medication-add flow; that path is unchanged.

This is the only place the system says "I can't help, you do it manually" — and it says it explicitly, in Hindi, with no apology and no AI-generated guess as a starting point.

---

## Feature G — Doctor portal (profiles + appointments + reports)

### G.1 Schema

`DoctorProfile`, `DoctorAppointment` per CLAUDE.md. Migration: `20260704000000_doctors/migration.sql`.

### G.2 Server modules

- `apps/server/src/modules/doctors/` — CRUD for `DoctorProfile` (patient-owned: a doctor row is created by the patient/guardian, not the doctor; full doctor-side auth is **out of scope for Phase 4**).
- `apps/server/src/modules/appointments/` — CRUD + the `APPOINTMENT_REMINDER` cron (7d, 1d, 2h push reminders; same `notification-resolver` priority chain as med reminders).
- `apps/server/src/modules/reports/` — pre-visit PDF generation (`GENERATE_PDF` job, Puppeteer, R2 storage). Report content:
  - Last 30d glucose + BP trends (sparklines).
  - HbA1c estimate with ESTIMATE label.
  - Med adherence %.
  - Top 3 insights (acknowledged + unacknowledged).
  - **AI summary paragraph** — Claude API call generating executive summary of health trajectory + key discussion points for the doctor. Goes through the same `chat-safety-filter` (no dosage directives, no diagnosis claims).

### G.3 PDF safety

- Sensitive PII (phone, household_id, full DoB) **never** rendered.
- Patient name + age band only.
- Watermark: "Generated by SwasthParivar — not a medical record".
- AI summary paragraph clearly labelled "AI-generated summary, for discussion only".

### G.4 Routes

`POST /api/v1/appointments`, `GET /api/v1/appointments`, `PUT /api/v1/appointments/:id`, `POST /api/v1/appointments/:id/complete`, `POST /api/v1/reports/generate`, `GET /api/v1/reports/:id/status`, `GET /api/v1/reports/:id/download` (signed R2 URL, 1-hour expiry).

---

## Feature H — Indian food DB + meal accuracy

### H.1 Schema

`IndianFoodItem` per CLAUDE.md, plus an index on `name_en` + `name_hi` for prefix search. The CLAUDE.md `name_regional(JSONB)` column holds keys per regional language (`{ mr, ta, bn, te, gu, pa }`) and is **populated only as each language flag ramps** (Feature J) — partial seed is fine: missing language → search falls back to `name_en` + `name_hi`. A GIN index on `name_regional` (`USING gin (name_regional jsonb_path_ops)`) supports cross-language search once Marathi seed lands.

Migration: `20260711000000_indian_food_items/migration.sql`.

### H.2 Seed data

`apps/server/prisma/seed-food-items.ts` — 200+ canonical items across categories (grain/lentil/vegetable/sweet/snack/beverage/fruit), GI/GL sourced from peer-reviewed Indian-population studies (Indian Council of Medical Research tables). Each row carries a `source` field citing the publication.

### H.3 Routes + caching

- `GET /api/v1/foods/search?q=&lang=` — prefix search with Redis cache (key `food:search:${lang}:${q}`, TTL 7d per CLAUDE.md).
- `POST /api/v1/meals` extended with optional `foodItemId` linking to `IndianFoodItem`.

### H.4 Detector update

`detectors/correlation-meal.ts` (already in Phase 3) gains an optional `foodItemId` grouping mode — when ≥ 5 instances of the same food item exist, the detector surfaces "Aloo paratha ke baad sugar 40 zyada aati hai" instead of just "heavy_fried meal ke baad". Same minimum-data rules; same per-reading-type comparison.

---

## Feature I — Wearables

### I.1 HealthKit + Google Fit (passive activity + sleep)

`apps/mobile/src/services/wearables/healthkit.ts`, `googlefit.ts` — read-only sync. Daily background fetch:

1. Pull steps/distance/active_minutes for last 7 days.
2. Pull sleep for last 7 days.
3. POST to `/api/v1/activity/daily` + `/api/v1/sleep` with `source: "healthkit"` / `"googlefit"`.
4. Server dedup: manual entry for same `userId+date` wins.

**Trust window:** for the first 30 days, wearable data is *displayed only*, not fed to detectors. After 30 days of paired manual+wearable readings, the user (or admin) can promote wearables to detector-eligible via `wearable_trust_promoted:${userId}` Redis key.

### I.2 Bluetooth devices (active glucose + BP)

`apps/mobile/src/services/wearables/bluetooth/omron-bp.ts`, `accuchek-glucose.ts` — react-native-ble-plx. Whitelist of two devices for Phase 4:

- **Omron HEM-7156T** (BP cuff, India market) — proven BLE protocol.
- **Accu-Chek Instant** (glucometer) — proven BLE protocol.

Pairing flow: scan → user selects → store device UUID in `User.pairedDevices` JSONB. Subsequent reads auto-flow to `/api/v1/readings/glucose` or `/api/v1/readings/bp` with `source: "device"`. **Manual reading within ± 60s of a device reading overrides the device reading** (per CLAUDE.md "wearable is evidence, not truth").

### I.3 Failure modes

- Bluetooth pair fails → fall back to manual logging silently. Banner: "Device connect nahi hua — manual karein. Settings me dobara try karein."
- HealthKit permission denied → app continues without it; settings deep-link to re-grant.
- Device reading out of plausible range → drop silently, log to PostHog `wearable_reading_dropped{device, value, reason}`. Never raise an alert from a single dropped device reading.

---

## Feature J — Festival nudging + regional languages

### J.1 Festival nudging

`packages/domain-logic/src/festival-calendar/` — pure module. `getFestivalsForDate(date, region)` returns active festivals. **Source data:** static JSON checked into the repo (`packages/domain-logic/src/festival-calendar/festivals-2026.json`), refreshed annually via a manual PR (no third-party API in the hot path — festival dates rarely change but third-party APIs go down). Covers:

- Diwali, Holi, Karwa Chauth, Janmashtami, Ganesh Chaturthi, Christmas (national).
- Eid-ul-Fitr, Eid-ul-Adha, Muharram (lunar — date-shifted yearly).
- Regional: Pongal (TN), Onam (KL), Durga Puja (WB), Baisakhi (PB), Gudi Padwa (MH).

**Nudge rules:**

- 24h before festival: gentle "Kal Diwali hai! Mithai ka maza lijiye, lekin reading log karna na bhoolein 🪔" — counts toward daily push budget.
- During festival: `festive` context tag pre-selected on confirmation screen. CLAUDE.md festive rules apply (max 2 festive tags per week; gentle_warn suppressed; critical-bypass still fires).
- Post-festival +1d: encouraging "Aaj fresh start! Pehli reading le lein 🌅".

`festival_nudging_enabled` gated. Default off until 7-day cohort verifies no over-nudging.

### J.2 Regional languages

CLAUDE.md lists "regional languages" without specifying which. Phase 4 ships Marathi first (largest non-Hindi Indian-app cohort after Tamil); Tamil/Bengali/Telugu/Gujarati/Punjabi behind individual flags, each requiring:

1. Full `i18n/<lang>.json` translation (Hinglish-Latin script for written; Devanagari/regional for voice).
2. Voice parser fixtures: colloquial dictionary equivalent (Marathi "saadenshe" → 150 etc.), past-tense indicators, uncertainty indicators, time keywords.
3. 100% test coverage on the new fixtures.
4. Native speaker sign-off (recorded in `docs/i18n-signoff.md`, new file).

`voice-parser.ts` extended with a `language: "hi"|"en"|"mr"|"ta"|"bn"|"te"|"gu"|"pa"` parameter. Backward compatible: existing calls without `language` default to `"hi"`.

---

## Feature K — Monetization (Razorpay + Apple IAP + tier transitions)

### K.1 Schema

```prisma
model Subscription {
  id                String   @id @default(uuid())
  userId            String   @unique
  user              User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tier              Tier     // free | premium | family
  provider          SubscriptionProvider // razorpay | apple_iap | manual
  providerSubscriptionId String?   // razorpay_subscription_id or original_transaction_id
  status            SubscriptionStatus // active | past_due | cancelled | grace
  currentPeriodEnd  DateTime
  cancelAtPeriodEnd Boolean  @default(false)
  cancelledAt       DateTime?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}

model PaymentEvent {
  id                String   @id @default(uuid())
  userId            String
  provider          SubscriptionProvider
  eventType         String   // razorpay event name OR apple notification type
  rawPayload        Json     // verbatim webhook body, signature-verified
  signatureValid    Boolean
  processedAt       DateTime?
  errorMessage      String?
  createdAt         DateTime @default(now())

  @@index([userId, createdAt(sort: Desc)])
  @@index([provider, eventType])
}
```

Migration: `20260725000000_subscriptions_payments/migration.sql`.

### K.2 Razorpay

`apps/server/src/modules/payments/razorpay.{controller,service,webhook}.ts`:

- `POST /api/v1/payments/razorpay/create-subscription` — server-side `Subscription` create on Razorpay's side, returns `subscription_id` + checkout config.
- `POST /api/v1/webhooks/razorpay` — signature-verified per Razorpay docs (`X-Razorpay-Signature` HMAC SHA256 with `RAZORPAY_WEBHOOK_SECRET`). **Signature failure → 401, no state change, signed-fail logged to Sentry.**
- Handled events: `subscription.activated` → tier up; `subscription.charged` → period extension; `subscription.cancelled` → schedule downgrade at `currentPeriodEnd`; `subscription.paused` → grace; `payment.failed` → soft notification, no immediate downgrade.

### K.3 Apple IAP

`apps/server/src/modules/payments/apple-iap.{controller,service,webhook}.ts`:

- `POST /api/v1/payments/apple-iap/verify-receipt` — receipt validated against Apple's verifyReceipt (sandbox + prod). **Never trust the client's "I bought premium" message.**
- `POST /api/v1/webhooks/apple-iap` — App Store Server Notifications V2, signed JWS verified against Apple's public keys (rotated; cached 24h).

### K.4 Tier-transition rules (CRITICAL)

**Upgrade (free → premium / family):**
- Tier change atomic in a transaction with `Subscription` row create/update.
- Premium endpoints (unlimited chat, advanced insights, full HbA1c history) check `User.tier` via middleware `requireTier("premium")`.
- PostHog `tier_changed{from, to, reason: "purchase", provider}`.

**Downgrade (premium → free):**
- **ZERO patient health data deleted.** `GlucoseReading`, `BPReading`, `CardiacLog`, etc. all retained per DPDP (CC.11 §5).
- Premium UI hides (e.g., 90-day history truncated to 30-day view); on re-upgrade, full history reappears.
- Premium BullMQ jobs (`WEEKLY_REPORT`, advanced detectors) skip via `requireTier` check.
- Rate limits revert to free (3 chats/day, 20 readings/day).
- Family link visibility unchanged — guardians retain read access (per medical-safety rules).
- PostHog `tier_changed{from, to, reason: "cancelled"|"refund"|"past_due"}`.

**Family tier:** premium × N patients (CLAUDE.md). One household primary holds the subscription; all profiles in `household_id` benefit. Downgrade affects the whole household atomically.

### K.5 Integration tests

`tests/integration/razorpay-webhook.test.ts` + `apple-iap-webhook.test.ts` — ≥ 25 cases each. Mandatory:

- Signature verification: valid → 200, invalid → 401, no state change on invalid.
- Idempotency: same event ID twice → second is no-op.
- Tier upgrade transactional.
- **Downgrade does NOT delete glucose readings** (assertion: row count unchanged across downgrade).
- Refund webhook: tier reverts, no data loss.
- Past-due → grace state, then downgrade after grace window.
- Race condition: two webhooks for the same subscription in parallel → final state is correct (Redis `lockSubscriptionForEvent(userId)` mutex).

### K.6 Admin console additions (M5)

The admin dashboard `BillingPlansPage` (M3-T9 scaffold) gains:

- Live subscription table (filter by status, provider).
- Manual tier override (super_admin only, audited).
- Refund-trigger button (super_admin only, audited, routes to Razorpay/Apple admin URLs — server never refunds directly to keep audit trails authoritative on the provider side).
- MRR tile.
- Churn-this-month tile.

---

## Section M.2 — Mobile (per-feature work, behind CC.12 flags)

Each feature above includes a Mobile sub-slice; this section codifies the cross-cutting mobile pieces.

- **Tab nav extension:** Cardiac/Respiratory/Doctor tabs appear only when their respective flag resolves true.
- **WatermelonDB schema bumps:** Add `cardiac_logs`, `respiratory_logs`, `activity_daily`, `sleep_logs`, `prescription_items` (read-only mirror), `appointments`, `food_items_cache` tables. **Schema migrations MUST be additive** — every migration reviewed by `db-reviewer` agent (same pattern as Phase 3 chat schema bump).
- **Bluetooth permissions:** Android `BLUETOOTH_SCAN` + `BLUETOOTH_CONNECT` (API 31+); iOS `NSBluetoothAlwaysUsageDescription`. Both gated by `wearable_bluetooth_*_enabled` so the prompt only appears for users in cohort.
- **HealthKit permissions:** iOS only, requested lazily on first `wearable_healthkit_enabled=true` resolution.
- **In-app purchase UI:** Razorpay Web Checkout in a WebView for Android; native StoreKit for iOS. Single shared "Upgrade" screen that branches on `Platform.OS`.
- **i18n bundle splitting:** with 7+ languages the bundle grows; lazy-load per-language JSON via `i18next-resources-to-backend`.

---

## Cross-cutting concerns

### CC.13 — Hypertable migration rigor

Every new TimescaleDB hypertable (CardiacLog, RespiratoryLog) follows the CardiacLog pattern from `GlucoseReading`:

```sql
SELECT create_hypertable('cardiac_logs', 'measured_at', chunk_time_interval => INTERVAL '7 days');
```

Migration includes:

1. `CREATE TABLE`.
2. `SELECT create_hypertable(...)`.
3. `ALTER TABLE ... ADD CONSTRAINT ... UNIQUE (client_uuid, measured_at)`.
4. Indexes.

**Squawk exclude list unchanged** (`prefer-text-field`). `prepare_database_migration` via the Neon MCP (or local `prisma migrate diff`) verifies schema↔migration parity.

### CC.14 — Spend-cap parity across AI surfaces

The chat spend cap (CLAUDE.md / Feature A) generalizes:

- `CLAUDE_DAILY_SPEND_CAP_USD` (chat — existing).
- `CLAUDE_VISION_DAILY_SPEND_CAP_USD` (prescription OCR + medicine photo cross-check — new).
- `CLAUDE_REPORT_DAILY_SPEND_CAP_USD` (PDF AI summary — new).

Each cap auto-flips its enabling flag (`prescription_ocr_enabled` / `weekly_report_enabled`) and pages Sentry. **No combined cap** — separating caps lets ops kill the expensive surface without breaking the cheap one.

### CC.15 — Multi-condition critical-bypass routing

The existing `critical-alert.processor.ts` handles glucose-only thresholds today. **Phase 4 extension:** the processor gains a `category: "glucose"|"bp"|"cardiac"|"respiratory"` discriminator, switching on the right hardcoded thresholds:

| Category    | Critical-low                       | Critical-high                              |
|-------------|------------------------------------|--------------------------------------------|
| glucose     | < 65                               | > 315                                      |
| bp          | sys < 90 OR dia < 60               | sys > 180 OR dia > 110                     |
| cardiac     | HR < 40                            | HR > 150 OR (chestPain && severity ≥ 7)    |
| respiratory | peakFlow < baseline × 0.5          | symptomSeverity === "severe"               |

**All four routes hit the same parallel chain:** push → SMS fallback → fullscreen → call. Cooldown is **per category, not global** — a glucose-low followed by a BP-high 5min later both fire (different conditions, different urgency context).

**100% branch coverage of the dispatch table required.** Property test: any category × any out-of-range value triggers exactly one bypass; in-range never triggers.

### CC.16 — DPDP compliance for new surfaces

- Prescription photos (R2): retention 1 year then hard-delete (cron `PRESCRIPTION_PHOTO_RETENTION_SWEEP`, gated by `prescription_retention_sweep_enabled`, ships OFF like chat retention).
- AI Vision raw responses (`ocrRawResult`): retained 90d for audit, then anonymized (`ocrRawResult: null`, original kept in S3 lifecycle archive).
- Appointment records: retained indefinitely (medical history).
- Subscription/payment events: retained 7 years (Indian tax law).
- `User` delete cascades to: Subscription, PaymentEvent (anonymized), Prescription, MedicinePhoto, all reading types — verified via integration test (`tests/integration/user-deletion-cascade.test.ts`, ≥ 12 assertions).

### CC.17 — Wearable trust model (formalised)

The "wearable is evidence, not truth" rule from §I.1 codifies as a Redis state per user:

- `wearable_trust:${userId}:until` → epoch ms when 30d trust window ends.
- `wearable_trust:${userId}:promoted` → "1" if user/admin has explicitly promoted wearable to detector-eligible.
- Detector input: skip device-sourced readings unless `promoted === "1"` OR `now >= until`.
- Critical-bypass: device reading STILL triggers bypass (the safety chain trusts the device for emergencies; only "is this a trend" suppresses).

---

## Files index (additions only — existing files reused unchanged)

### Schema + migrations

- `apps/server/prisma/schema.prisma` — `+` SOSEvent, CardiacLog, RespiratoryLog, ActivityDaily, SleepLog, Prescription, PrescriptionItem, MedicinePhoto, DoctorProfile, DoctorAppointment, IndianFoodItem, Subscription, PaymentEvent + matching enums.
- `apps/server/prisma/migrations/20260601000000_sos_events/` (per phase3.md §D.1)
- `apps/server/prisma/migrations/20260620000000_cardiac_respiratory_activity_sleep/`
- `apps/server/prisma/migrations/20260627000000_prescriptions/`
- `apps/server/prisma/migrations/20260704000000_doctors/`
- `apps/server/prisma/migrations/20260711000000_indian_food_items/`
- `apps/server/prisma/migrations/20260718000000_user_paired_devices/` (one column on `User`)
- `apps/server/prisma/migrations/20260725000000_subscriptions_payments/`
- `apps/server/prisma/seed-food-items.ts`

### Pure domain-logic (`packages/domain-logic/src/`)

- `sos-escalation-state-machine/`, `sos-contact-resolver/`, `sos-message-builder/` (phase3.md §D.2 verbatim)
- `cardiac-thresholds/`, `respiratory-thresholds/`, `activity-aggregator/`, `sleep-quality-classifier/`
- `prescription-color-classifier/`, `prescription-safety-validator/`
- `festival-calendar/` (+ `festivals-2026.json`)
- `detectors/cardiac-trend.ts`, `detectors/respiratory-trend.ts`
- `voice-parser/` extended — `language` parameter + per-language colloquial maps

### Server modules

- `apps/server/src/modules/sos/`
- `apps/server/src/modules/cardiac/`, `respiratory/`, `activity/`, `sleep/`
- `apps/server/src/modules/prescriptions/`
- `apps/server/src/modules/doctors/`, `appointments/`, `reports/`
- `apps/server/src/modules/payments/`
- `apps/server/src/shared/calls/exotel-voice.ts` (+ `twilio-voice.ts` fallback)
- `apps/server/src/shared/ai/claude-vision.ts`

### Workers

- `apps/server/src/workers/sos-escalation.{processor,worker}.ts`
- `apps/server/src/workers/sos-notify-contact.{processor,worker}.ts`
- `apps/server/src/workers/prescription-ocr.{processor,worker}.ts`
- `apps/server/src/workers/medicine-photo-cross-check.{processor,worker}.ts`
- `apps/server/src/workers/appointment-reminder.{processor,worker}.ts`
- `apps/server/src/workers/generate-pdf.{processor,worker}.ts`
- `apps/server/src/workers/weekly-report.{processor,worker}.ts`
- `apps/server/src/workers/schedule-compliance-check.{processor,worker}.ts`
- `apps/server/src/workers/medicine-stock-check.{processor,worker}.ts`
- `apps/server/src/workers/prescription-photo-retention-sweep.{processor,worker}.ts`

### Mobile

- `apps/mobile/src/services/wearables/healthkit.ts`, `googlefit.ts`
- `apps/mobile/src/services/wearables/bluetooth/omron-bp.ts`, `accuchek-glucose.ts`
- `apps/mobile/src/services/payments/razorpay.ts`, `apple-iap.ts`
- `apps/mobile/app/cardiac/`, `respiratory/`, `appointments/`, `prescriptions/`, `upgrade/`
- WatermelonDB schema v2 → v3 migration (single PR, db-reviewer agent gate)
- `apps/mobile/src/i18n/mr.json` (and per language as flags ramp)

### Tests

- `apps/server/tests/integration/sos.test.ts` (≥ 20 cases)
- `apps/server/tests/integration/cardiac.test.ts`, `respiratory.test.ts`, `activity.test.ts`, `sleep.test.ts`
- `apps/server/tests/integration/prescription.test.ts` (≥ 20)
- `apps/server/tests/integration/appointments.test.ts`, `reports.test.ts`
- `apps/server/tests/integration/razorpay-webhook.test.ts` (≥ 25)
- `apps/server/tests/integration/apple-iap-webhook.test.ts` (≥ 25)
- `apps/server/tests/integration/user-deletion-cascade.test.ts`
- `packages/domain-logic/tests/cardiac-thresholds.test.ts` + property tests (fast-check)
- `packages/domain-logic/tests/prescription-color-classifier.test.ts` (100% branches)
- `packages/domain-logic/tests/festival-calendar.test.ts`
- `packages/domain-logic/tests/sos-*.test.ts` (per phase3.md §D)

### Docs

- `docs/runbooks/sos-drill.md` (new)
- `docs/runbooks/refund-handling.md` (new)
- `docs/runbooks/prescription-ocr-incident.md` (new)
- `docs/i18n-signoff.md` (new)
- `docs/HOWTO.md` — add "Issue refund", "Pair Bluetooth device", "Promote wearable", "Add a festival"
- `docs/ARCHITECTURE.md` — add Phase 4 section: multi-condition critical-bypass dispatch table, wearable trust model, monetization flow
- `docs/SETUP.md` — Razorpay, Apple IAP, Exotel, Twilio env vars + setup

---

## Feature C' — Silent Guardian advanced signals (Phase 3 expansion)

Phase 3 shipped SG with **med adherence + trend only** (CLAUDE.md scope). Phase 4 lights up the remaining four signals from the CLAUDE.md "Silent Guardian" section:

### C'.1 Signal additions (per CLAUDE.md)

| Signal             | Source                                                   | Phase 4 wiring                                                                                                                          |
|--------------------|----------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------|
| `data_anomaly`     | existing Phase 3 anomaly detector (median + IQR, 21d)    | wrap detector output into a `SilentGuardianSignal` with `risk_contribution` derived from severity_score                                |
| `chat_sentiment`   | new pure module `chat-sentiment-classifier/`              | analyses outgoing patient chat turns post-safety-filter; emits signal when ≥ 3 distressed turns / 7d. **No verbatim chat in payload**.  |
| `schedule_miss`    | `HealthCheckCompliance` rows (Week 13 carry-over)         | ≥ 3 consecutive missed slots → signal. Avoids redundancy with `med_adherence` by being scoped to *check schedules*, not med schedules.  |
| `activity_drop`    | `ActivityDaily` rows (Feature I)                          | 7d rolling avg steps < 50% of 30d baseline AND `wearable_trust:${userId}:promoted=1` → signal. **Never fires inside the 30d trust window**. |
| `cross_signal`     | combines ≥ 2 other signals within 14d                    | pure module `cross-signal-correlator/` — outputs a `cross_signal` signal with `risk_contribution = max(signals) + 10`.                  |

### C'.2 Scoring + alert dispatch (preserved from Phase 3)

CLAUDE.md scoring table unchanged: 0–30 weekly / 31–60 daily / 61–80 push ≤ 2/week / 81–100 immediate. Stacking rule preserved: needs ≥ 1 signal > 40 for ORANGE. 7d decay 50%.

**Verbatim leak guard:** `chat_sentiment` signal payload stores only `{ distressed_turn_count, last_distressed_at }` — never the chat content itself. Verified in `silent-guardian.test.ts` (new property test: signal JSON is searched for `"content"`, `"transcript"`, any > 40-char string → fail).

### C'.3 Alert fatigue (preserved)

Orange max 2/week. Yellow → summary only (rolled into daily guardian summary cron, already shipped). Guardian ignores 3 alerts → reduce frequency, ask "Aap alerts kam karna chahte hain?" (preserved from Phase 3 `daily-guardian-summary.processor.ts`).

### C'.4 Files

- `packages/domain-logic/src/chat-sentiment-classifier/` (new, 95%+ coverage)
- `packages/domain-logic/src/cross-signal-correlator/` (new, 95%+ coverage)
- `apps/server/src/workers/silent-guardian-analyze.processor.ts` (existing — extend signal switch)
- `apps/server/src/workers/activity-drop-detect.{processor,worker}.ts` (new, daily cron)
- `apps/server/src/workers/schedule-miss-detect.{processor,worker}.ts` (new, hourly cron — pairs with `SCHEDULE_COMPLIANCE_CHECK`)

---

## Tier-aware infrastructure (Phase 4 cross-cutting)

### T.1 `requireTier` middleware

```ts
// apps/server/src/shared/middleware/require-tier.ts
export function requireTier(min: "premium" | "family"): RequestHandler;
```

Reads `req.user.tier` (populated by `requireAuth`). Returns 403 `TIER_UPGRADE_REQUIRED` when below threshold. **Family ≥ premium ≥ free.**

Mounted on: `POST /chat/message` (Tier 3 path only — Tier 1 templates remain free), `GET /reports/generate`, advanced insight endpoints, deep history (> 30d) endpoints. The middleware **never gates patient health writes** — logging a reading is always free, always works.

### T.2 Tier-aware rate limit

`shared/middleware/rate-limit.ts` extended with `tieredRateLimit({ free, premium, family })`. Premium = unlimited. Family = premium × household_size. Re-reads `User.tier` per request (cached in `requireAuth`'s user object, no extra DB hit). Family rate window resets per-household to avoid one profile starving another.

**Runtime-adjustable limits (admin carry-over):** Each rate-limit table (default, auth, chat, readings) reads ceilings from the flag service (`rate_limit.default.free`, `rate_limit.chat.free`, etc.). Defaults from CLAUDE.md ("Free: 3 chats/day, 20 readings/day, 100 req/min"). Admin console exposes the live values via a new `RateLimitsCard` on the Ops page — incident playbook: tighten limits without redeploy. Cache TTL 30s (same pattern as the existing flag service).

### T.3 Tier-aware caching — explicit non-rule

We deliberately **do NOT** vary cache TTLs by tier. Premium does not get fresher data; both tiers see identical caching (dashboard 15min, food:search 7d, etc. per CLAUDE.md). Tier governs *access*, not *staleness* — keeping the cache uniform avoids a class of "premium sees ghost data" bugs.

---

## Reading validation reference (Phase 4 additions)

Extends the CLAUDE.md "Reading Validation (Zod)" table. All ranges enforced server-side; client-side validation is UX only.

| Field                          | Range / rule                                           | On violation                                                          |
|--------------------------------|--------------------------------------------------------|-----------------------------------------------------------------------|
| `cardiac.heartRate`            | 30–250 (CLAUDE.md)                                      | 400 `READING_INVALID_VALUE`                                          |
| `cardiac.painSeverity`         | 0–10 when `chestPain=true`; rejected otherwise          | 400 `READING_INVALID_VALUE`                                          |
| `respiratory.peakFlow`         | 50–800 L/min                                            | 400 `READING_INVALID_VALUE`                                          |
| `respiratory.puffs`            | 0–20 when `inhalerUsed=true`                            | 400 `READING_INVALID_VALUE`                                          |
| `activityDaily.steps`          | 0–100000/day                                            | 400 `READING_INVALID_VALUE`                                          |
| `activityDaily.activeMinutes`  | 0–1440                                                  | 400 `READING_INVALID_VALUE`                                          |
| `sleepLog.durationMinutes`     | sleepEnd > sleepStart; duration 0–1440                  | 400 `READING_INVALID_VALUE`                                          |
| `prescription.photoBytes`      | ≤ 10MB; jpeg/png/webp; EXIF stripped                    | 400 `READING_INVALID_VALUE`                                          |
| `medicinePhoto.photoBytes`     | ≤ 5MB; jpeg/png/webp; EXIF stripped                     | 400 `READING_INVALID_VALUE`                                          |
| `source` field (all readings)  | required for cardiac/respiratory/activity/sleep; one of `manual`/`voice`/`device` | 400 `READING_INVALID_VALUE` |
| `cardiac.heartRate` extreme    | < 20 or > 300 → confirm + double-confirm UI flow         | accept after confirm; flag `anti_cheat` if 3 in a row                |

Double-confirmation UI flow (CLAUDE.md Patch #4) extends to cardiac extremes: HR > 200 OR < 40 → RED screen, 3-second delay before confirm activates.

---

## Phase 4 env vars (consolidated)

Add to `apps/server/src/config/env.ts` Zod schema. All require fail-loud validation; missing-in-production → boot fails.

| Env var                               | Required          | Purpose                                                          |
|---------------------------------------|-------------------|------------------------------------------------------------------|
| `EXOTEL_SID`                          | when `sos_ivr_enabled` true | India IVR primary                                      |
| `EXOTEL_API_KEY`                      | when `sos_ivr_enabled` true | "                                                       |
| `EXOTEL_API_TOKEN`                    | when `sos_ivr_enabled` true | "                                                       |
| `EXOTEL_CALLER_ID`                    | when `sos_ivr_enabled` true | DID number                                              |
| `TWILIO_ACCOUNT_SID`                  | optional          | international guardian fallback                                  |
| `TWILIO_AUTH_TOKEN`                   | optional          | "                                                                |
| `TWILIO_FROM_NUMBER`                  | optional          | "                                                                |
| `SOS_AUTO_DIAL_DELAY_SECONDS`         | default 60        | stage 1 delay                                                    |
| `SOS_IVR_DELAY_SECONDS`               | default 300       | stage 2 delay                                                    |
| `CLAUDE_VISION_DAILY_SPEND_CAP_USD`   | required prod     | Vision spend kill switch                                         |
| `CLAUDE_REPORT_DAILY_SPEND_CAP_USD`   | required prod     | PDF AI summary spend kill switch                                 |
| `RAZORPAY_KEY_ID`                     | required prod     | Razorpay public                                                  |
| `RAZORPAY_KEY_SECRET`                 | required prod     | Razorpay secret                                                  |
| `RAZORPAY_WEBHOOK_SECRET`             | required prod     | HMAC for `X-Razorpay-Signature`                                  |
| `APPLE_IAP_SHARED_SECRET`             | required iOS prod | receipt validation                                               |
| `APPLE_IAP_BUNDLE_ID`                 | required iOS prod | identifier check                                                 |
| `APPLE_IAP_ROOT_CERT_PATH`            | required iOS prod | JWS chain verification                                           |
| `R2_PRESCRIPTION_BUCKET`              | required prod     | dedicated bucket separate from chat/profile uploads              |
| `PRESCRIPTION_RETENTION_DAYS`         | default 365       | hard-delete window                                               |
| `WEARABLE_TRUST_WINDOW_DAYS`          | default 30        | trust ramp                                                       |

---

## Phase 4 error codes (consolidated)

Add to `packages/shared-types/src/api.ts`. Map in `shared/middleware/error-handler.ts`.

| Code                                 | HTTP | Surface                                                                 |
|--------------------------------------|------|-------------------------------------------------------------------------|
| `SOS_ALREADY_ACTIVE`                 | 409  | second SOS trigger while one is unresolved                              |
| `SOS_DISABLED`                       | 503  | `sos_enabled=false`                                                     |
| `SOS_IVR_NO_VENDOR`                  | 503  | `sos_ivr_enabled=true` but neither Exotel nor Twilio configured         |
| `RX_PENDING_APPROVAL`                | 400  | attempt to use prescription before items approved (CLAUDE.md)           |
| `RX_OCR_FAILED`                      | 422  | Claude Vision returned no items                                         |
| `RX_PHOTO_TOO_LARGE`                 | 413  | > 10MB                                                                  |
| `PRESCRIPTION_OCR_DISABLED`          | 503  | spend cap reached                                                       |
| `REPORT_GENERATING`                  | 202  | poll for PDF (CLAUDE.md)                                                |
| `REPORT_GENERATION_FAILED`           | 500  | Puppeteer / R2 failure                                                  |
| `APPOINTMENT_CONFLICT`               | 409  | overlapping appointment for same patient                                |
| `TIER_UPGRADE_REQUIRED`              | 403  | premium-gated endpoint hit by free tier                                 |
| `PAYMENT_WEBHOOK_INVALID_SIGNATURE`  | 401  | Razorpay HMAC or Apple JWS verification failed                          |
| `PAYMENT_RECEIPT_INVALID`            | 400  | Apple receipt validation failed                                         |
| `PAYMENT_PROVIDER_UNAVAILABLE`       | 503  | Razorpay / Apple endpoint timeout                                       |
| `SUBSCRIPTION_NOT_FOUND`             | 404  | webhook references unknown subscription                                 |
| `SUBSCRIPTION_ALREADY_CANCELLED`     | 409  | duplicate cancel                                                        |
| `WEARABLE_PAIR_FAILED`               | 503  | BLE pairing exceeded timeout                                            |
| `WEARABLE_DEVICE_UNSUPPORTED`        | 400  | non-whitelisted device                                                  |
| `FOOD_ITEM_NOT_FOUND`                | 404  | meal-log referenced unknown foodItemId                                  |
| `LANGUAGE_UNSUPPORTED`               | 400  | voice request in a language whose `lang_*_enabled` flag is false        |

---

## Phase 4 PostHog events (consolidated)

Add to `apps/server/src/shared/analytics/posthog.ts` `EventPropsMap`. Mobile mirrors via `apps/mobile/src/services/analytics.ts`.

```
sos_triggered{source, category, contacts_count, location_accuracy_m, test_mode}
sos_stage_transition{from, to, elapsed_seconds}
sos_contact_attempted{contact_priority, channel(push|sms|ivr), success}
sos_cancelled{stage, by, elapsed_seconds}
sos_resolved{by, elapsed_seconds, false_alarm}
sos_test_mode_run
sos_ivr_vendor_failover{from(exotel|twilio), to}

critical_bypass_triggered{category, value, sms_success, push_success, source}  // extended with category
cardiac_reading_logged{source, time_to_log_seconds, user_stage}
respiratory_reading_logged{source, time_to_log_seconds, user_stage}
activity_synced{source, days_covered, records}
sleep_synced{source, days_covered}

prescription_uploaded{photos_count, bytes_total}
prescription_ocr_completed{items_red, items_yellow, items_green, latency_ms, vision_tokens}
prescription_approved{items_approved, items_rejected, time_to_approve_seconds}
prescription_rejected{reason}
medicine_photo_uploaded
medicine_photo_cross_check{match_status, confidence}

appointment_created
appointment_reminder_sent{days_before, channel}
appointment_completed{has_report}
report_generated{report_type, ai_summary_included, latency_ms, pdf_bytes}

wearable_pair_attempted{device, platform, success, latency_ms}
wearable_reading_received{device, category, dropped, drop_reason}
wearable_promoted_to_detectors{by(user|admin)}

food_search{query_length, lang, results_count, latency_ms}
meal_logged_with_food_item{food_item_id, category}

festival_nudge_sent{festival, days_before, language}
festive_tag_used{festival}
language_changed{from, to}

subscription_created{tier, provider}
subscription_renewed{tier, provider, days_continuous}
subscription_cancelled{tier, reason}
subscription_refunded{tier, provider}
subscription_grace_entered{tier, days_until_downgrade}
tier_changed{from, to, reason(purchase|cancelled|refund|past_due|admin_override), by_admin_id?}
payment_webhook_received{provider, event_type, signature_valid}
payment_webhook_rejected{provider, reason}

silent_guardian_signal_emitted{signal_type, risk_contribution}
silent_guardian_alert_dispatched{severity, signal_count}
schedule_miss_detected{check_type, consecutive_misses}
```

---

## Phase 4 developer alert thresholds

Extends CLAUDE.md "Developer Alerts". All flow through Sentry → PagerDuty (or whatever oncall channel is wired).

| Metric                                              | Threshold                | Severity  |
|-----------------------------------------------------|--------------------------|-----------|
| `sos_delivery_rate` (any channel reaching ≥1 contact) | < 100% (any single miss) | **PAGE**  |
| `sos_ivr_vendor_failover` count                     | > 5 / day                | **PAGE**  |
| `prescription_ocr_failure_rate`                     | > 10% / day              | INVESTIGATE |
| `medicine_photo_cross_check` mismatch rate          | > 30% / week             | INVESTIGATE |
| `payment_webhook_invalid_signature`                 | > 0 (any)                | **PAGE** (security) |
| `payment_provider_unavailable`                      | > 3 / 10min              | PAGE      |
| `wearable_pair_failure_rate`                        | > 30% / day              | INVESTIGATE |
| `wearable_reading_dropped` per device               | > 5% of received         | INVESTIGATE |
| `tier_changed{reason=refund}` rate                  | > 2% / week              | INVESTIGATE |
| `food_search` p95 latency                           | > 200ms                  | INVESTIGATE |
| `report_generated` p95 latency                      | > 30s                    | INVESTIGATE |
| `report_generation_failed` rate                     | > 5% / day               | INVESTIGATE |
| `silent_guardian_alert_dispatched` (severity=red)   | > 10 / day across cohort | INVESTIGATE (likely detector drift) |

Already covered in CLAUDE.md (preserved): `critical_bypass_sms_success_rate < 95%` (urgent), `voice_success < 70%`, retention day_1→3 < 50%.

---

## Phase 4 fallback mechanisms (consolidated)

Extends CLAUDE.md "Fallback Mechanisms".

| Scenario                                       | Fallback                                                                                                                                  |
|------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------|
| Exotel down (India IVR)                        | Twilio for international; for +91 numbers → degrade to SMS (MSG91) + push + fullscreen. Page Sentry. Patient safety chain still completes. |
| Twilio down                                    | Exotel for +91; non-+91 international → SMS + push. Page Sentry.                                                                          |
| Claude Vision down / spend cap                 | OCR job leaves prescription in `pending_ocr` state; mobile shows "Photo le li gayi, AI thodi der me padhega" — patient/guardian can retry. Photo never lost. |
| Claude (chat summary in PDF) down              | PDF generates without AI summary paragraph (banner: "Summary unavailable — last 30d trends only").                                       |
| Razorpay checkout fails (network)              | Mobile shows "Payment shuru nahi ho paya — internet check karein, dobara try karein". No partial state.                                  |
| Razorpay webhook missed (provider outage)      | Daily reconciliation cron pulls subscription state from Razorpay API; corrects local state idempotently.                                  |
| Apple receipt validation endpoint down         | Trust receipt for **24h grace** (the validation API itself is known-flaky historically); retry hourly. Never block patient access during outage.    |
| Bluetooth pair fails                           | Settings shows "Device connect nahi hua — manual karein" + "Dobara try karein" button. Patient continues with manual logging silently.    |
| Bluetooth reading out of plausible range       | Drop silently, log to PostHog `wearable_reading_dropped{device, value, reason}`. Never raise an alert from a single dropped device reading. |
| HealthKit permission denied                    | App continues without it; settings deep-link to re-grant.                                                                                 |
| Festival JSON missing for a date               | Don't crash, don't nudge — degrade to normal day. Log to Sentry as data gap.                                                              |
| PDF report Puppeteer crashes                   | Job retries 3× exp backoff; final failure → email patient "Report nahi ban paya — dobara request karein" + Sentry capture.                |
| IndianFoodItem table empty (seed incomplete)   | `/foods/search` returns empty list; meal log accepts free-text without `foodItemId`. Never blocks meal logging.                            |

---

## Phase 4 BullMQ jobs (full specs)

Extends CLAUDE.md "BullMQ Jobs". Phase 3 jobs (ANALYZE_READING, UPDATE_STREAK, TRIGGER_NOTIFICATION, DAILY_HEALTH_SCORE, MED_REMINDER, MED_MISSED_ALERT, DAILY_GUARDIAN_SUMMARY, SILENT_GUARDIAN_ANALYZE, CHAT_SAFETY_REVIEW, CHAT_RETENTION_SWEEP, GUARDIAN_ALERT_DISPATCH, RE_ENGAGEMENT, GRACE_RESET) are preserved untouched.

| Job                                  | Trigger                                              | Behaviour                                                                                                                                                                                                              |
|--------------------------------------|------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `SOS_ESCALATION`                     | on `POST /sos/trigger` + repeating 30s tick           | runs `sos-escalation-state-machine` per `phase3.md §D.2`. **Highest queue priority.** Exits on `resolved`/`cancelled`. Idempotent via deterministic `jobId = sos-${sosEventId}`. Failed delivery → Sentry capture.       |
| `SOS_NOTIFY_CONTACT`                 | enqueued by escalation per contact                    | per-contact push/SMS/IVR. **Highest priority.** Records outcome in `SOSEvent.contactsNotified[]`. Retry 3× exp backoff. Failure → Sentry.                                                                              |
| `PRESCRIPTION_OCR`                   | on `POST /prescriptions/upload`                        | Claude Vision call → populate `ocrRawResult` + create `PrescriptionItem` rows with color classification. Idempotent (`jobId = ocr-${prescriptionId}`). Spend-cap honoured. Failure → leaves prescription `pending_ocr`. |
| `MEDICINE_PHOTO_CROSS_CHECK`         | on `POST /medicines/:id/photo`                         | Vision call → Levenshtein vs Indian-brand alias table → write `matchStatus`. Mismatch flag (NOT auto-action).                                                                                                          |
| `APPOINTMENT_REMINDER`               | scheduled at appointment-create (3 delayed jobs)      | 7d / 1d / 2h push (and SMS fallback if push fails). Uses `notification-resolver` priority chain. Skip if appointment cancelled. Sets `reminder_sent_*` flags atomically.                                                |
| `GENERATE_PDF`                       | on `POST /reports/generate`                            | Puppeteer → R2 → signed URL. Includes AI summary paragraph (Claude API, `chat-safety-filter` applied). 3× retry exp backoff. p95 SLO 30s. Failure → patient email + Sentry.                                            |
| `WEEKLY_REPORT`                      | cron Sunday 19:00 user-TZ (premium only)              | per-guardian aggregate report across all linked patients. Generates PDF via `GENERATE_PDF` queue. **`requireTier("premium")` gated** — free tier silently skipped. Email + push notification with download link.        |
| `SCHEDULE_COMPLIANCE_CHECK`          | cron hourly                                            | walks `HealthCheckSchedule` rows where `active=true` and `reminder_enabled=true`; for each due slot computes `HealthCheckCompliance` row (`on_time`/`late`/`missed`). Enqueues nudge push for `late`. Enqueues `silent_guardian_signal` for ≥ 3 consecutive `missed`. |
| `MEDICINE_STOCK_CHECK`               | cron daily 09:00 user-TZ                              | walks `MedicationSchedule.quantity_remaining`; warns when < 5 days at current frequency. Push: "Metformin sirf 4 din ka stock hai — refill karein". Skipped when `quantity_remaining` is null (no inventory tracking).  |
| `PRESCRIPTION_PHOTO_RETENTION_SWEEP` | cron weekly Sunday 21:00 UTC                          | hard-deletes `Prescription.originalPhotoUrls` from R2 + nulls `ocrRawResult` past 1 year (DPDP §16). **Gated by `prescription_retention_sweep_enabled`, ships OFF** (same destructive-default pattern as chat sweep).   |
| `MEDICINE_PHOTO_RETENTION_SWEEP`     | cron weekly Sunday 21:30 UTC                          | hard-deletes `MedicinePhoto` rows past 1 year. **Gated, ships OFF.**                                                                                                                                                   |
| `SG_SIGNAL_SWEEP`                    | cron weekly Sunday 22:00 UTC                          | nulls `SilentGuardianSignal.rawEvidence` past 90d (decay value reaches ~0 by then; payload no longer useful). **Gated, ships OFF.**                                                                                    |
| `WEARABLE_BACKFILL`                  | on HealthKit/Google Fit permission grant              | one-time pull of 30d history → enqueues `/activity/daily` + `/sleep` writes with `source=healthkit\|googlefit`. **Trust window starts at this moment**, not at first sync.                                              |
| `RAZORPAY_RECONCILIATION`            | cron hourly                                            | pulls last 24h of subscription events from Razorpay API and reconciles with local `Subscription` state. Idempotent. Closes the missed-webhook gap (Razorpay outages).                                                  |
| `APPLE_IAP_RECONCILIATION`           | cron hourly                                            | re-validates active iOS subscriptions via App Store Server API. Idempotent. Closes the missed-notification gap.                                                                                                        |
| `SUBSCRIPTION_GRACE_DOWNGRADE`       | enqueued on payment failure                            | scheduled at `currentPeriodEnd + 7d grace`. Final job in the past-due chain — flips `User.tier` to `free` if subscription still unrenewed. Cancellable on payment recovery.                                            |

All jobs use the established defaults (3 retries, exponential backoff 5s base, 1h success retention, 24h failure retention) unless noted. All workers split into `<job>.processor.ts` (pure) + `<job>.worker.ts` (queue binding) per the critical-bypass pattern.

---

## DPDP retention table (Phase 4 consolidated)

| Surface                                        | Retention                                                | Mechanism                                                                                  |
|------------------------------------------------|----------------------------------------------------------|--------------------------------------------------------------------------------------------|
| `GlucoseReading` / `BPReading` / `CardiacLog` / `RespiratoryLog` / `ActivityDaily` / `SleepLog` | indefinite while User active        | hard delete on User delete (cascade)                                                       |
| `MedicationLog` / `MedicationSchedule`         | indefinite while User active                              | hard delete on User delete (cascade)                                                       |
| `Prescription` / `PrescriptionItem`            | 1 year after upload, then hard delete                     | cron `PRESCRIPTION_PHOTO_RETENTION_SWEEP` (gated, ships OFF, same pattern as chat sweep)   |
| `Prescription.ocrRawResult` (raw Vision response) | 90d then anonymized to `null`                          | nested cron pass                                                                            |
| `MedicinePhoto`                                | 1 year, same sweep                                        | cron `MEDICINE_PHOTO_RETENTION_SWEEP`                                                       |
| `ChatSession` / `ChatMessage`                  | 90d archive, 1y hard delete (already shipped)             | `chat-retention-sweep` (gated OFF until ops enables)                                       |
| `SilentGuardianSignal`                         | 90d (decay value-less past that)                          | new cron `SG_SIGNAL_SWEEP`                                                                  |
| `GuardianAlert`                                | indefinite while patient active                            | cascade on User delete                                                                      |
| `DoctorAppointment`                            | indefinite (medical history)                              | cascade on User delete                                                                      |
| `Subscription` / `PaymentEvent`                | 7 years (Indian tax law)                                  | **anonymize-on-User-delete** (set `userId=null`, drop PII), NOT cascade — retain for audit |
| `SOSEvent`                                     | indefinite (medical+legal evidence)                       | cascade on User delete                                                                      |
| R2 buckets                                     | S3-style lifecycle rules mirror Postgres retention        | per-bucket lifecycle.json checked into infra repo                                          |

User delete cascade integration test (`user-deletion-cascade.test.ts`) asserts every row in the cascade map either deletes or anonymizes correctly. ≥ 12 assertions.

---

## CORS (Phase 4 update)

CLAUDE.md current: dev = `localhost:8081`, `localhost:3000`; prod = app origins + admin.

Phase 4 additions:

- Admin SPA (already shipped, served from `admin.swasthparivar.in`) — preserved.
- **Doctor portal** — out of Phase 4 scope (doctor-side auth deferred to Phase 5), but the CORS allowlist already supports future origins via env var `CORS_ALLOWED_ORIGINS` (comma-separated). No code change in Phase 4.
- Razorpay redirect origins (`https://checkout.razorpay.com`) added to `frame-ancestors` CSP for the upgrade WebView on Android.

---

## Festival nudging copy budget (per festival)

Every festival nudge type requires **≥ 3 message variants per language**, rotated using the same `last_3_variant_ids` mechanism in `NotificationState` (CLAUDE.md Patch #21). Nudge types per festival:

- `T-1d` (day before): warm + practical
- `T-0` (day-of): celebrate + light reminder
- `T+1d` (day after): fresh-start encouragement

So each festival × language = 9 strings minimum. Sign-off recorded in `docs/i18n-signoff.md`.

---

## WatermelonDB schema migration sequence

Current mobile schema is at **v3** (post Phase 3 chat tables: `chat_messages`, `chat_pending_sends`). Phase 4 adds:

- v4 (Feature E): `cardiac_logs`, `respiratory_logs`, `activity_daily`, `sleep_logs`.
- v5 (Feature F): `prescriptions` (read-only mirror), `prescription_items`.
- v6 (Feature G): `appointments`.
- v7 (Feature H): `food_items_cache`.
- v8 (Feature K): `subscription_state` (single-row, for offline tier check).

Each version bump = one PR, db-reviewer agent gate, additive only. `schemaMigrations` wired into the SQLite adapter on every bump (without it, an existing install resets local DB — Phase 3 lesson preserved).

---

## Phase 4 closing gate

Phase 4 ships when:

1. All Week 13–22 gates pass.
2. SOS real-mode in production for 30 days with ≥ 5 real triggers and 100% delivery rate (push OR SMS OR IVR reaching ≥ 1 contact).
3. Subscription system in production for 30 days with zero refund-related data-loss complaints.
4. CodeQL + Trivy + eslint-plugin-security clean on `main`.
5. DR drill executed and logged.
6. Branch protection on `main` requires all CI gates.
7. `audit-progress.md` updated.

Open the **Phase 5 plan** (next-tier intelligence: cross-patient pattern learning, doctor-side onboarding, partner integrations) only after gate 7.
