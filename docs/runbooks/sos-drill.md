# SOS drill runbook

> Phase 4 Feature D' — companion to the rollback runbook. Run a drill
> the **week of each Phase ramp** AND **once per quarter** as a
> standing rehearsal. Every drill writes one row to the log table at
> the bottom of this file (PR + commit hash + duration).
>
> Owners on-call: see CODEOWNERS. Two reviewers required for any PR
> that flips `sos_test_mode=false` for a cohort (per
> `.github/PULL_REQUEST_TEMPLATE.md`).

---

## Why this exists

The SOS chain is the only product surface that can autonomously dial
an emergency contact. A regression — a wrong stage transition, a
mis-routed contact, a vendor outage — could either:

1. **Fail to alert a real emergency** (silent failure — patient dies
   waiting), OR
2. **Wake someone's family at 3 AM with a false alarm** (the trust
   collapse from that one event burns the whole product).

The drill exists to catch both before they reach a real patient.

---

## 1. Test-mode drill (every Phase ramp)

**Trigger.** Any change to: SOS code, SOS schema, SOS flag defaults,
the Exotel/Twilio wrappers, the SOS escalation cron, or `phase3.md
§579+` / `phase4.md §D'` itself.

**Pre-flight.**

- [ ] `sos_enabled=true` for the drill account only (cohort flag).
- [ ] `sos_test_mode=true` — server-side default. Confirm via:
      `redis-cli GET flag:sos_test_mode` returns `true`.
- [ ] Drill account has ≥ 2 `EmergencyContact` rows configured.

**Steps.**

1. Drill account triggers SOS via the mobile **Test SOS** button (or
   `POST /api/v1/sos/trigger` with `{ source: "patient_manual" }`).
2. Verify within 5s:
   - `SOSEvent` row created with `testMode=true`, `escalationStage`
     = `stage_0_fullscreen`.
   - PostHog event `sos_triggered` fired with `test_mode=true`.
   - Mobile shows the fullscreen alert.
3. Wait 60s. Verify the escalation tick transitioned to
   `stage_1_auto_dial`:
   - `SOSEvent.escalationStage` = `stage_1_auto_dial`.
   - `contactsNotified` JSON contains one entry with
     `channel: "log_only"` (test mode suppresses real calls).
   - PostHog event `sos_stage_transition` fired with
     `reason: "auto_dial_timeout"`.
4. Cancel via the in-app **I'm OK** button.
5. Verify within 5s:
   - `SOSEvent.cancelledAt` set, `cancelledBy = "patient"`.
   - PostHog event `sos_cancelled` fired.
   - No further ticks scheduled.
6. Resolve via the after-action card (mark as false alarm).
7. Verify Sentry breadcrumb chain is intact: one breadcrumb per state
   transition, all under the same SOS `requestId`.

**Acceptance.** All seven steps pass. Log the drill in §3 below.

**On failure.** File a P0 ticket. **Do not** merge any PR that
touches SOS code or flips `sos_test_mode=false` until the failure is
root-caused and a regression test is in.

---

## 2. Real-mode drill (one internal user, one cycle)

**Pre-flight gates** (all must be satisfied; ops sign-off required):

- [ ] 7 consecutive days of internal-cohort `sos_enabled=true` +
      `sos_test_mode=true` with **zero** false-alarm bypass-SMS
      sends (the critical-bypass chain shares the SMS provider; a
      false-alarm there pollutes the SOS drill).
- [ ] At least one Test-mode drill in §1 passed in the last 7 days.
- [ ] Exotel + Twilio credentials present and verified in staging
      (`pnpm --filter @swasth/server exec npx ...` smoke).
- [ ] Two reviewers approved the `sos_test_mode=false` PR.

**Trigger.** Cohort-scoped `sos_test_mode=false` for the drill
account only. Use the admin console's flag editor with a cohort of
exactly one user id.

**Steps.**

1. Drill account triggers SOS as in §1.
2. Within the stage_0 window (60s), the drill account taps **I'm
   OK** to cancel.
3. Verify:
   - No outbound IVR call was placed (Exotel + Twilio request
     counters in the last minute = 0).
   - `SOSEvent.cancelledAt` set.
   - Sentry breadcrumbs include the test-mode flip + cancellation.
4. Restore `sos_test_mode=true` immediately after the drill.

**Acceptance.** Cancellation propagates in < 30s AND no real call
fires.

**On failure.** Flip `sos_enabled=false` GLOBALLY (kill switch). File
a P0. The §1 test-mode regression suite must catch the failure before
any further real-mode drill is attempted.

---

## 3. Drill log

| Date         | Mode      | Driver | PR     | Duration | Result    | Notes                |
| ------------ | --------- | ------ | ------ | -------- | --------- | -------------------- |
| _yyyy-mm-dd_ | test/real | _name_ | _#nnn_ | _Xm Ys_  | pass/fail | _what surprised you_ |

(Append a row per drill. Keep this table reverse-chronological so the
most-recent run is on top once §1 has been run at least once.)

---

## 4. Related references

- `phase3.md §579+` — original SOS spec (Feature D).
- `phase4.md §D'` — Phase 4 carry-over additions (Exotel, multi-
  patient routing, this drill protocol).
- `CLAUDE.md "SOS Test-Mode Default"` — the safety invariant.
- `docs/runbooks/rollback.md` — adjacent runbook; share format.
- `packages/domain-logic/src/sos-escalation/` — pure state machine +
  contact resolver + message builder (100% branch coverage on the
  state machine is the safety floor).
