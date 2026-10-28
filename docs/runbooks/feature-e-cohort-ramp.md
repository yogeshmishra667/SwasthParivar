# Feature E cohort flag-ramp runbook

> Phase 4 Feature E — operational ramp for the multi-condition log
> surfaces (cardiac + respiratory). Companion to `sos-drill.md` and
> `rollback.md`. Run the cardiac ramp and the respiratory ramp in
> sequence, not parallel — a regression in either should not pollute
> the soak data of the other.
>
> Two reviewers required for any flag flip that widens the cohort or
> crosses a percentage threshold. Append a row to §4 for every flip.
>
> `$ADMIN_JWT` below is a 15-minute admin access token from a
> `super_admin` or `ops` account:
> `export ADMIN_JWT=$(node scripts/admin-token.mjs --api https://api.swasthparivar.com)`
> (see `docs/HOWTO.md` → "Get an admin token for curl"). Re-run it when a
> call returns 401.

---

## Why this exists

Cardiac and respiratory logs carry their own critical-bypass chains
(HR < 40 / > 150, peak flow < baseline × 0.5, severe symptoms — per
CLAUDE.md "Phase 4 Invariants — Multi-condition Critical-Bypass
Dispatch"). A regression in either could:

1. **Fire a false bypass alarm** — wake the guardian at 3 AM with a
   spurious "Papa needs help" push. Trust collapse.
2. **Miss a real bypass** — the patient's HR is 38 and the system stays
   silent. Patient harm.

The ramp gates both surfaces behind `cardiac_logging_enabled` and
`respiratory_logging_enabled` (both default `false`). The cohort
expansion at each stage adds users only after the prior stage shows
zero false-alarms in the PostHog `critical_bypass_triggered` stream
filtered by `surface`.

---

## 0. Pre-flight (do once per feature before stage 1)

- [ ] `pnpm -r build` clean on `main`; the latest §E follow-up rollup
      (PR #132) is the floor — verify `git log --oneline -1` matches
      `3789942` or newer.
- [ ] Admin account has `super_admin` or `ops` role (`requireAdminRole`
      gates the flag writes — see
      `apps/server/src/modules/admin/flags/admin-flags.routes.ts:18`).
- [ ] PostHog dashboards saved with these surface-filtered queries:
  - `voice_attempt` where `surface = cardiac` → success rate, last 24h.
  - `voice_attempt` where `surface = respiratory` → success rate.
  - `critical_bypass_triggered` where `surface = cardiac` → expect 0
    during soak; any row needs immediate review.
  - `critical_bypass_triggered` where `surface = respiratory` → same.
  - `fail_safe_triggered` where `scenario LIKE 'cardiac%'` or
    `'respiratory%'` → catches the offline / save-fail copy paths.
- [ ] Drill cohort identified: 1 ops user + 1 dev user with cardiac or
      respiratory conditions in their `User.conditions` array.
      Production user IDs, not staging — the flag system reads Redis on
      the real server.

---

## 1. Cardiac cohort ramp

### Stage 1 — Internal smoke (1 user, 24h)

**Trigger.** §0 pre-flight green.

**Steps.**

1. Set the flag to a one-user cohort. `userIds` are account (household
   primary) ids; every profile on that phone follows its account, at the
   API and in the app alike:
   ```bash
   curl -X PUT \
     -H "Authorization: Bearer $ADMIN_JWT" \
     -H "Content-Type: application/json" \
     -d '{"value": {"rollout": "cohort", "userIds": ["<ops-user-id>"]}}' \
     https://api.swasth-parivar.in/admin/flags/cardiac_logging_enabled
   ```
2. On the ops user's device: open mobile → Log tab → confirm the
   "Heart" mode button is visible (gated by
   `GET /api/v1/config/features → cardiac_logging`).
3. Log one normal reading (HR 75, regular rhythm, no chest pain,
   normal exercise tolerance). Confirm save succeeds and the
   confirmation banner shows `severity: "normal"`.
4. Log one warn reading (HR 125, irregular rhythm). Confirm the warn
   banner renders the right localised copy.
5. **Do not** trigger a critical reading in stage 1 — the bypass chain
   would page real guardians (the ops user's emergency contacts).
   Critical-band coverage is covered by the existing integration test
   `tests/integration/cardiac.test.ts § "critical bypass enqueue"`.

**Acceptance.** Steps 1-4 pass. After 24h:

- 0 rows in `critical_bypass_triggered{surface=cardiac}`.
- 0 rows in `fail_safe_triggered{scenario=cardiac_save_failed}`.
- Voice path (if the ops user opted in): `voice_attempt{surface=cardiac, success=true}` ≥ 80% of attempts.

**On failure.** Patch the cohort to remove the user:

```bash
curl -X PATCH \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"remove": ["<ops-user-id>"]}' \
  https://api.swasth-parivar.in/admin/flags/cardiac_logging_enabled/cohort
```

File a P1. Do not advance to stage 2.

### Stage 2 — Internal cohort (≤10 users, 7d)

**Pre-flight.** Stage 1 acceptance criteria met for 24 consecutive
hours.

**Steps.**

1. Add the soak cohort:
   ```bash
   curl -X PATCH \
     -H "Authorization: Bearer $ADMIN_JWT" \
     -H "Content-Type: application/json" \
     -d '{"add": ["<user-id-1>", "<user-id-2>", "..."]}' \
     https://api.swasth-parivar.in/admin/flags/cardiac_logging_enabled/cohort
   ```
   ≤ 10 user IDs total. Pick users whose `User.conditions` array
   includes `cardiac` so the surface is naturally exercised.
2. Watch PostHog for 7 calendar days:
   - `critical_bypass_triggered{surface=cardiac}` — every row reviewed
     within the next on-call shift. A confirmed real critical reading
     passes the soak; a false alarm (e.g. an out-of-range HR from a
     wearable that should have been suppressed by the 30-day trust
     window) fails it.
   - `voice_attempt` success rate by surface — should not drop more
     than 5 percentage points vs. glucose baseline.
   - Sentry: zero new unhandled errors tagged `category:cardiac`.
3. End of day 7: if all green, advance to stage 3.

**Acceptance.** 7 consecutive days, zero false-alarm
`critical_bypass_triggered{surface=cardiac}` rows, zero Sentry P1s.

**On failure.** Same patch-to-remove as stage 1. File a P1. The
regression-trigger logic must land + ship + verify-clean before the
soak restarts (do not just re-add the same users).

### Stage 3 — Percentage ramp

**Pre-flight.** Stage 2 acceptance met. PR opened that converts the
flag to a `cohort_or_percentage` rollout so the existing cohort users
stay on alongside the new percentage.

**Steps.**

1. Initial ramp — 5%:
   ```bash
   curl -X PUT \
     -H "Authorization: Bearer $ADMIN_JWT" \
     -H "Content-Type: application/json" \
     -d '{"value": {"rollout": "cohort_or_percentage", "userIds": ["..."], "percent": 5}}' \
     https://api.swasth-parivar.in/admin/flags/cardiac_logging_enabled
   ```
2. Hold 48h. Same PostHog watch as stage 2.
3. Ramp 5 → 25 → 50 → 100, holding 24h between each step. Any false-
   alarm row at any step → flip back to the previous percentage
   immediately via the same PUT.

**Acceptance.** 100% rollout with the watch criteria still green for
48h.

**Rollback.** A single PUT back to `cohort` with the original soak
cohort kills the percentage while preserving the audit trail in
`GET /admin/flags/cardiac_logging_enabled/audit`. The server-side
kill-switch in `cardiac.service.ts` returns 503
`CARDIAC_DISABLED` for users outside the cohort, and the mobile
client renders the disabled copy from `cardiac.disabled` (i18n).

---

## 2. Respiratory cohort ramp

Mirror of §1 with these substitutions throughout:

- Flag key: `respiratory_logging_enabled`
- Error code: `RESPIRATORY_DISABLED`
- Mobile mode: respiratory
- PostHog filter: `surface = respiratory`
- Soak cohort: users whose `User.conditions` array includes
  `asthma` or `copd`.

Stage 1 smoke values: peak flow 350 (normal), 250 (yellow zone — warn
band assuming a 400 baseline), inhaler-used=false, symptom severity=none.

Critical-band coverage is via integration test
`tests/integration/respiratory.test.ts § "critical bypass enqueue"` —
do not trigger a real critical reading in stage 1.

---

## 3. Coupling rules

- **Do not run cardiac and respiratory ramps in parallel.** A
  regression in shared infra (the critical-bypass chain, the
  ANALYZE_READING worker, the voice parser dispatch) would taint both
  soak datasets and force a restart.
- **Mobile voice integration ships flag-gated alongside the surface.**
  The `VoiceInput` mode dispatch in chunk 7 reads from the same
  `cardiac_logging` / `respiratory_logging` flag — a user outside the
  cohort cannot reach the cardiac/respiratory mode chooser at all, so
  the voice path is automatically gated.
- **Critical-bypass thresholds are not flag-tunable.** The cohort
  ramp gates VISIBILITY of the surface, not the medical thresholds.
  HR < 40, peak flow < baseline × 0.5, etc. are hardcoded per
  CLAUDE.md "Phase 4 Invariants" — never config-driven.

---

## 4. Ramp log

| Date         | Feature             | Stage | Driver | Cohort size | PostHog clean? | Notes                |
| ------------ | ------------------- | ----- | ------ | ----------- | -------------- | -------------------- |
| _yyyy-mm-dd_ | cardiac/respiratory | 1/2/3 | _name_ | _N users_   | yes/no         | _what surprised you_ |

(Reverse-chronological once stage 1 runs at least once.)

---

## 5. Related references

- `phase4.md §E` — original Feature E spec.
- `phase4-progress.md` — live progress board; the "What's next" section
  links back here.
- `CLAUDE.md "Phase 4 Invariants — Multi-condition Critical-Bypass
Dispatch"` — the hardcoded threshold table.
- `apps/server/src/modules/admin/flags/admin-flags.routes.ts` — flag
  write endpoints used in the curl commands above.
- `apps/server/src/modules/config/config.service.ts` — `FEATURE_REGISTRY`
  binding public feature names to flag keys.
- `apps/server/src/modules/readings/cardiac.service.ts` — server-side
  kill-switch returning `CARDIAC_DISABLED` (503) when the flag is off.
- `apps/server/src/modules/readings/respiratory.service.ts` —
  symmetric, returns `RESPIRATORY_DISABLED`.
- `docs/HOWTO.md` — flag-flip recipe (the "Switch OTP provider" entry
  is a worked example of the same flag system in action).
- `docs/runbooks/sos-drill.md` — shares format; the SOS ramp uses the
  same one-user → 7-day-soak → percentage pattern.
- `docs/runbooks/rollback.md` — if the ramp uncovers a code bug, the
  rollback path lives here.
