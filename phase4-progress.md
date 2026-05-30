# Phase 4 — Live Progress Board

> **Companion to `phase4.md`** (the original spec). This file tracks what's done, what's in flight, and what's next. Update on every merged PR. The spec stays canonical for HOW things should be built.
>
> Last updated: **2026-05-31** (end of Week 13 carry-over).

---

## TL;DR — where we actually are

| Track | State | Next concrete action |
|---|---|---|
| **Carry-over from Phase 2, Phase 3, Admin** | ✅ Code-complete | None — see "operational close-out" below |
| **Phase 1 corrigendum: emergency contacts** | 🟡 Server done (#115), mobile management screen pending | Build Settings → Emergency contacts screen + wire onboarding |
| **SOS ramp** | 🟡 Code-complete, needs operational soak | Provision vendor creds → 7-day test-mode soak → first drill → flag flips |
| **Push delivery hardening** | ✅ Diagnostic + auto-prune + per-user rate-limit keying landed (#113, #114, #112) | Verify the Expo token / projectId pairing in prod once #114 prunes the dead tokens |
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
- [ ] Wire guardian-assisted onboarding step to write an initial `EmergencyContact` row at priority 1 with `isGuardian: true` (CLAUDE.md line 171).

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
