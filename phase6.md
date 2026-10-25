# Phase 6 — Emotional Notifications ("Parivar ki awaaz") — Premium package

> **Status:** Spec only — nothing built. Drafted 2026-09-28; premium model, admin controls and §6E added the same day after a code audit.
> **Numbering:** called Phase 6 at the product owner's request. There is no `phase5.md`; this phase does not depend on anything planned for a Phase 5.
> **Depends on:** Phase 1 med reminders, Phase 3 family links + guardian app, Phase 4 household delivery + Feature K payments.
> **Companion docs:** `CLAUDE.md` (invariants win on any conflict), `phase4.md` (conventions this doc follows).

---

## Product decisions (2026-09-28)

1. **Phase 6 is a Premium package.** The emotional layer (the child's name and voice, voice notes, the family support loops) is sold as premium.
2. **One piece stays free, always:** a missed **critical** medicine alerts the guardian, with a "Call" button. CLAUDE.md already specifies this ("MED_MISSED_ALERT: 1hr after → guardian if critical"), and it is a safety feature (R12).
3. **§6E support loops are approved into scope** (E1–E9). E9 (mood) additionally needs a recorded safety + privacy review before it's built.
4. **Everything is controllable from the admin dashboard without a deploy:** on/off per feature, per-user pilots, which features are free vs premium, and the numeric limits (see "Flags & tunables" and "Admin dashboard").

---

## Context — why this phase

Today, when a patient misses a dose, **nothing reaches the family**. `MED_MISSED_ALERT` writes a `missed_no_response` log and, for critical meds, only writes a warning to the server log (`apps/server/src/workers/med-reminder.worker.ts`, comment: _"Guardian alert for critical meds (Phase 3 will extend this)"_).

This phase closes that gap by using the product's real asset — the family — instead of a louder robot:

1. Papa forgets → a warm nudge, in the child's name **only if the child set it up**.
2. Papa forgets again → the child is told, with one tap to **call Papa from their own phone** or **send a 10-second voice note**.
3. Papa hears the child's voice → one tap "✅ Dawai le li" → the child gets "Papa ne dawai le li ✅".
4. Beyond missed doses (§6E): good news, thanks, refills, appointments, weekly summaries, check-ins, greetings — so the family doesn't only hear from the app when something is wrong.

**Running cost:** close to ₹0. Everything uses free push, the child's own phone plan, or near-free storage. The only paid step (automated call, §6D) is deferred.

---

## Audit findings that affect this phase (checked in code, 2026-09-28)

| # | Finding | Evidence | What Phase 6 must do |
|---|---|---|---|
| A1 | Missed critical dose reaches nobody | `apps/server/src/workers/med-reminder.worker.ts` (log only) | Build §6.0 first. |
| A2 | Premium today = only **unlimited AI chat** and **unlimited daily readings**. `requireTier` exists but is used nowhere; the `WEEKLY_REPORT` job is not built. | `chat.service.ts:130`, `readings.service.ts:162`, `shared/middleware/require-tier.ts` | Phase 6 becomes the first real premium feature set. |
| A3 | A **family plan upgrades only the buyer's own account**; linked parents keep free-tier limits. | `payments.service.ts:260`, `apple-iap.service.ts:317` | Entitlement checks the guardian (payer) **or** the patient's household primary — see "Who must be premium". The underlying Feature K gap still needs its own fix. |
| A4 | **Bug:** server kill switches read cohort-rollout flags as plain booleans. The Feature E ramp runbook sets `cardiac_logging_enabled` to `{"rollout":"cohort",…}`, and `getFlag<boolean>` treats any object as `true`, so the API is on for **everyone** while only the mobile UI respects the cohort. | `readings/cardiac.service.ts:77`, `docs/runbooks/feature-e-cohort-ramp.md:70`, `shared/rollout.ts` (`isFeatureEnabled`) | Every Phase 6 gate uses `isFeatureEnabled(flag, userId)`, never `getFlag<boolean>`. Fix the existing services in a separate PR **before** the Feature E cohort ramp. |
| A5 | The admin Flags page has **no catalog**: ops see raw keys; descriptions live only in `prisma/seed-flags.ts` comments. | `apps/admin/src/pages/FlagsPage.tsx` | Add a flag catalog (key, description, owner, safe default) and register every Phase 6 flag in it. |
| A6 | The mobile feature list only covers `ai_chat`, `cardiac_logging`, `respiratory_logging`. | `modules/config/config.service.ts` `FEATURE_REGISTRY` | Add a key for every Phase 6 surface the app must hide. |
| A7 | Shared-phone sub-profiles have a **fake phone** (`household:…`) that can't be dialled. | `modules/household/household.service.ts:136` (`isSyntheticHouseholdPhone`) | "Call Papa" dials the household primary's real number when the patient's is synthetic. |
| A8 | Guardian alerts fall back to **paid SMS** when push fails. | `workers/guardian-alert-dispatch.processor.ts:153` | Phase 6 must not reuse that path (R5). |
| A9 | The mobile **Upgrade screen** (§K) is not built. | `phase4-progress.md` §K | The paywall can't switch on until it ships. Pilot first with gating OFF (see Sequencing). |
| A10 | Admin data registry is missing `activity_daily` and `sleep_logs` (Feature I missed the "one registry entry per Phase 4 entity" rule). | `modules/admin/registry/admin-resource.registry.ts` | Outside Phase 6 — fix separately. Phase 6's own tables get registry entries (see Admin dashboard). |

---

## Hard rules (enforce — ZERO tolerance)

| # | Rule | Why |
|---|------|-----|
| R1 | **Only `missed_no_response` escalates.** A dose marked `skipped` (patient chose not to take it) NEVER triggers a patient-side nudge, voice-note prompt or call. | A patient who isn't eating and skips a sulfonylurea (glimepiride, gliclazide) or insulin is avoiding low sugar. Pressuring them can cause hypoglycaemia. |
| R2 | **Confirm, don't command.** Patient copy asks "Did you take it?" (✅ Le li thi / ⏭️ Aaj nahi). It never tells the patient to take a late or extra dose. | Late-dose rules vary by drug; that advice belongs to the doctor (CLAUDE.md AI Chat Safety #1). |
| R3 | **No guilt, no scolding.** Existing tone rules apply: never "kharab", never guilt, correlation-only wording (CLAUDE.md Edge Case #12). | Elderly UX + retention. |
| R4 | **Honesty.** A message shown "from Rahul" is either recorded by Rahul or a template Rahul explicitly enabled. A grandchild's note is labelled "Aarav ki taraf se (Rahul ke phone se)". **No AI voice cloning, ever.** | Trust. AI voice-clone scams impersonating children are the fastest-growing fraud against people over 50 in India (2026). |
| R5 | **Push only — never SMS.** Nothing in this phase uses the SMS fallback. | CLAUDE.md Edge Case #14 + cost. |
| R6 | **Critical-bypass is untouched.** Nothing here delays, dedups or replaces the critical-alert chain. | Safety. |
| R7 | **Fatigue budgets hold** (see "Push budgets"). | CLAUDE.md anti-fatigue: 7 ignored pushes stop ALL non-critical pushes to that user. |
| R8 | **Missed-dose alerts are NOT `GuardianAlert` rows.** They must not consume Silent Guardian's orange budget (max 2/week). | Keeps the Silent Guardian risk model clean. |
| R9 | **Household delivery.** Every patient-facing push goes through `resolveHouseholdDelivery()` with profile prefix + `data.targetUserId`. | CLAUDE.md shared-phone rule. |
| R10 | **Opt-in + deletion.** Guardians opt in; the patient can switch any family feature off; voice notes auto-delete (default 30 days); revoking a family link deletes that guardian's notes. | DPDP data minimisation. |
| R11 | **No paywall on the patient's screens.** The elderly patient never sees a price, a "Premium" badge or an upgrade prompt. Upsell appears only in the guardian's app. | Elderly UX; the child is the buyer. |
| R12 | **Safety is never paywalled.** The critical-medicine missed-dose alert and its Call button are free and cannot be moved behind premium by any flag (hard-coded in the entitlement resolver). | Medical safety. |
| R13 | **Downgrade never deletes data.** Premium features stop; stored notes, greetings and settings are kept and come back on re-upgrade. | CLAUDE.md "Tier Downgrade Data-Retention Rule". |

---

## Premium model

### Free vs Premium (default; ops can move items — see `family_features.free`)

| Feature | Free | Premium |
|---|:---:|:---:|
| Missed **critical** medicine → guardian push + 📞 Call button (§6.0) | ✅ always (R12) | ✅ |
| Plain missed-dose nudge to patient in the app's own voice (L1 plain) | ✅ | ✅ |
| E5 weekly good-news summary to guardian (includes ≤ 1 soft upsell line) | ✅ | ✅ |
| Voice-note **trial**: 3 notes per guardian per month | ✅ | — |
| L1 nudge **in the child's name** + standing voice note | — | ✅ |
| L2 guardian alert for **non-critical** medicines | — | ✅ |
| Voice notes (within daily caps) + up to 5 rotating standing notes | — | ✅ |
| Loop close ("Papa ne dawai le li ✅") + multi-child coordination (§6C) | — | ✅ |
| E1 good-news loop · E2 shukriya · E3 refill helper · E4 appointment heads-up · E6 daily check-in · E7 grandchild notes · E8 scheduled greetings · E9 mood | — | ✅ |
| §6D automated call (deferred) | — | ✅ |

### Who must be premium (the "payer" rule)

The child is usually the one who pays, and a family plan currently doesn't propagate (A3). So a feature is unlocked for a **(guardian, patient) pair** when ANY of these is true:

1. the **guardian's** own `tier` is `premium` or `family`;
2. the **patient's household primary** has `premium` or `family` (Papa's side paid);
3. the guardian or the patient is inside the `family_features.free_access` rollout (pilots, promos, comps).

Patient-initiated features (E2 shukriya, E6 check-in, E9 mood) are unlocked when the patient has **at least one** unlocked guardian, or their own household paid.

### Pure resolver — `packages/domain-logic/src/family-entitlement/`

```ts
resolveFamilyEntitlement({
  feature,                     // FamilyFeatureKey
  guardianTier,                // "free" | "premium" | "family" | null
  patientHouseholdTier,
  gatingActive,                // see "Premium control flags"
  freeTierFeatures,            // from family_features.free
  inFreeAccessRollout,
  voiceNoteTrialUsedThisMonth,
  voiceNoteTrialQuota,
}): { allowed: boolean;
      via: "safety" | "premium" | "free_tier" | "free_access" | "trial" | "gating_off";
      showUpgrade: boolean }   // true only for guardian surfaces
```

- `SAFETY_FEATURES` (`critical_missed_alert`, `critical_call_button`) are hard-coded `allowed: true`, whatever the flags say (R12).
- **100% branch coverage pinned.** Property tests: safety features are always allowed; nothing is blocked while `gatingActive=false`; a premium or family tier is always allowed.

### Server enforcement

- New middleware `requireFamilyFeature(feature)` on guardian routes. It wraps the resolver (plain `requireTier` can't express the OR rules above) and returns the existing **403 `TIER_UPGRADE_REQUIRED`**, which the app already knows as "show upgrade".
- **Workers** check the resolver per recipient before enqueueing. Not unlocked → the premium push is skipped silently. At most one soft upsell line per week goes into the free weekly summary ("Premium se Papa ko apni awaaz mein yaad dilayein").
- **Patient routes never return `TIER_UPGRADE_REQUIRED`** (R11). A locked patient-side feature simply doesn't render.

### Upsell UX (guardian app only)

- Locked items show a "⭐ Premium" badge and a one-line benefit; tapping opens the §K Upgrade screen (dependency A9).
- Free guardians still get the critical alert with the Call button, and 3 trial voice notes a month so they experience the feature before paying.

### Cancel / downgrade

- Follows §K: a cancellation keeps premium until the paid period ends.
- On drop to free: new premium actions stop. Already-delivered voice notes stay playable until their normal expiry. Standing notes, rotating notes and scheduled greetings are **kept but inactive** and resume on re-upgrade (R13). Critical-medicine alerts continue (R12).

---

## Flags & tunables

### Rules

- **Always `isFeatureEnabled(flag, userId)`** (cohort- and percentage-aware), never `getFlag<boolean>` (A4). The cohort key is the **patient id** for patient-facing and pair features, and the **guardian id** for guardian-only features.
- Every flag gets: a default in `prisma/seed-flags.ts`, an entry in the new flag catalog (A5), and a `FEATURE_REGISTRY` key if it hides app UI (A6).

### Kill switches (boolean or rollout object)

| Flag | Default | Controls | App key |
|---|---|---|---|
| `missed_dose_critical_alert_enabled` | **ON** | §6.0 free safety alert (kill switch only) | — |
| `family_nudges_enabled` | OFF | L1 (child's name) + L2 non-critical + loop close + §6C | `family_nudges` |
| `voice_notes_enabled` | OFF | §6B | `voice_notes` |
| `good_news_loop_enabled` | OFF | E1 + E2 | `good_news_loop` |
| `refill_helper_enabled` | OFF | E3 (also gates `MEDICINE_STOCK_CHECK`) | `refill_helper` |
| `guardian_appointment_headsup_enabled` | OFF | E4 | — (push only) |
| `weekly_family_summary_enabled` | OFF | E5 | — (push only) |
| `daily_checkin_enabled` | OFF | E6 | `daily_checkin` |
| `grandchild_notes_enabled` | OFF | E7 | `grandchild_notes` |
| `scheduled_greetings_enabled` | OFF | E8 | `scheduled_greetings` |
| `mood_checkin_enabled` | OFF | E9 (build blocked until review sign-off) | `mood_checkin` |
| `voice_note_retention_sweep_enabled` | **ON** | Auto-delete. Deliberate deviation from "destructive sweeps ship OFF": deletion is a promise shown to users. Ops can pause it. | — |
| `missed_dose_auto_call_enabled` + `missed_dose_auto_call_test_mode` | OFF + **ON** | §6D (deferred), same test-mode pattern as SOS | — |

### Premium control flags (how ops runs the paywall)

| Flag | Type | Default | Meaning |
|---|---|---|---|
| `family_features.premium_gating_enabled` | boolean | **OFF** | Master paywall switch. OFF = everyone gets every enabled feature (pilot mode). **Only takes effect if `payments_razorpay_enabled` or `payments_apple_iap_enabled` is also ON**, so users are never locked out of something they have no way to buy. |
| `family_features.free` | string[] | `["plain_nudge","weekly_summary","voice_note_trial"]` | Features available on the free tier. Move a feature free ↔ premium with no deploy. Safety features are always free no matter what's here. |
| `family_features.free_access` | rollout object | unset | Users (guardian or patient ids) who get the full premium package free: pilot families, promos, A/B tests, comps. Supports `cohort`, `percentage`, `cohort_or_percentage`. |

### Numeric tunables (admin Ops page, same pattern as `RATE_LIMIT_FLAGS`)

| Flag | Default | Hard bounds (server clamps) |
|---|---|---|
| `family_nudge.patient_daily_cap` | 3 | 1–5 |
| `family_push.guardian_daily_cap_per_patient` | 4 | 1–8 |
| `voice_note.patient_daily_push_cap` | 3 | 1–5 |
| `voice_note.max_seconds` | 15 | 5–30 |
| `voice_note.retention_days` | 30 | 7–90 |
| `voice_note.free_trial_per_month` | 3 | 0–10 |
| `voice_note.rotating_standing_max` | 5 | 1–10 |

The clamps mean a typo can't break the privacy promise (retention) or the cost model (length).

---

## Admin dashboard

What's added to `apps/admin` and `modules/admin` so ops can run this without engineers:

| Page | Addition |
|---|---|
| **Flags** | All flags above, plus the new flag catalog with descriptions (A5). The existing per-user rollout preview answers "is this user in the pilot?". |
| **Ops** | New "Family notifications" block with the numeric tunables, same UI as the rate-limit block (`apps/admin/src/pages/OpsPage.tsx:287`). |
| **User detail** | Registry entries (one entry each, no controller change): `voice_notes` (sensitive), `missed_dose_responses` (sensitive), `family_reactions` (sensitive), `daily_check_ins` (sensitive; includes mood). **Metadata only: admins can never play or download audio.** New `FamilyLink` columns appear automatically in the existing `family_links` panel. |
| **User detail — entitlements** | New read endpoint `GET /admin/users/:id/family-entitlements` (support+): each feature, allowed or not, and **why** (`via`). Answers "why can't my son send voice notes?". |
| **User detail — actions** | Audited writes (super_admin + ops, 3–280-char reason recorded in `AdminAuditLog`, same pattern as the doctor-portal writes): `DELETE /admin/users/:id/voice-notes/:noteId` (takedown, deletes the audio) and `PUT /admin/users/:id/family-nudges` (switch family features off for a patient or one link after a complaint). |
| **Analytics** | New metrics in `admin-analytics.registry.ts`: `dose_recovery_rate` (database), `family_nudge_funnel` (PostHog), `voice_note_volume` (database), `guardian_nudge_mute_rate` (PostHog), `family_premium_conversion` (PostHog: blocked → upgrade tapped → `tier_changed{purchase}`). |
| **Billing** | No change; `tier_distribution` already exists. |

**Comps and pilots — which tool to use:**

- **Pilot, promo or A/B test:** add ids to `family_features.free_access` on the Flags page. Bulk, reversible, audited, and time-boxable.
- **One-off comp:** the existing `PUT /admin/users/:id/tier` works, but any later payment webhook for that user overwrites it. Prefer `free_access` for anything temporary.

---

## §6.0 Prerequisite — missed critical dose reaches the guardian (FREE)

- Split `medMissedAlertWorker` into `med-missed-alert.processor.ts` + `.worker.ts` (repo convention).
- After writing the `missed_no_response` log, call `resolveMissedDoseEscalation` (§6A) and enqueue the resulting pushes on a new `FAMILY_NUDGE_DISPATCH` queue.
- Critical medicine → each accepted guardian with `alertEnabled` gets the alert and the missed-dose screen with the Call button. Always free, gated only by the kill switch `missed_dose_critical_alert_enabled`.
- Record in the existing `MedicationLog.guardianAlerted`.
- Push-only helper `sendFamilyPush()`; it has no SMS path (R5).

---

## §6A — Missed-dose escalation ladder

### Definitions

- **Miss** = a `MedicationLog` with `status = missed_no_response`, written 60 min after the reminder when no `taken`/`skipped`/`delayed` response exists.
- **Consecutive-miss count** is per `MedicationSchedule`: `missed_no_response` logs since the last `taken` or `delayed`. `skipped` neither counts nor resets (R1).

### The ladder

| Level | Trigger | Who | Tier | Example copy |
|---|---|---|---|---|
| **L1 plain** | 1st consecutive miss | Patient | Free | "Papa, Metformin (9 baje) ki entry nahi hui. Le li ho to ✅ dabayein 🙏" |
| **L1 family** | same, when the guardian enabled "remind in my name" | Patient | Premium | "Rahul ne yaad dilane ko kaha hai: Metformin ki entry nahi hui…" + "🎙️ Rahul ka message suniye" when a standing note exists |
| **L2 critical** | 1st miss of an `isCritical` schedule | Guardians | **Free** (§6.0) | "Papa ne 9 baje ki dawai nahi li" → Call button |
| **L2** | 2nd consecutive miss of a non-critical schedule | Guardians with missed-dose alerts on | Premium | "Papa ne 9 baje ki Metformin nahi li (2 baar se)" → Call + Voice note |
| **L3** | Deferred — §6D | — | Premium | — |

### Quiet hours

- Patient (22:00–06:00 patient TZ): L1 and voice-note pushes are delivered **silently** (Android channel `family-quiet`, no sound). Not held, so a bedtime dose can still be recovered.
- Guardian (22:00–07:00 guardian TZ): non-critical L2 is **held** and folded into the next morning's summary. Critical L2 is delivered normally.

### Loop close (premium)

When the patient logs `taken` for a dose with an open L2, push **once** to each guardian who acted on it: "Papa ne dawai le li ✅". Guardians who didn't act see it in the evening summary.

### Pure module — `packages/domain-logic/src/missed-dose-escalation/`

`resolveMissedDoseEscalation({ recentLogs, isCritical, patientLocalHour, patientNudgesSentToday, patientVoiceNotesEnabled, standingNoteSenderIds, guardians[] })` → `{ patientNudge, guardianAlerts[], reason }`. It takes entitlement results as input and doesn't compute them. **100% branch coverage pinned.** Property tests: a `skipped` newest log never produces a patient nudge; at most one patient nudge per call; `alertEnabled=false` guardians never alerted; caps never exceeded.

---

## §6B — Voice notes (guardian → patient)

| Kind | Recorded when | Used by | Retention |
|---|---|---|---|
| `standing` | Settings or the opt-in sheet. Premium: up to 5, rotated with no repeat within the last 3 (same idea as the notification variant pool). | L1 family | Until replaced, deleted, or link revoked. In-app prompt every 30 days: "Naya message record karein?" |
| `reply` | On demand, from the missed-dose screen | Sent immediately | `voice_note.retention_days` after creation (default 30) |
| `greeting` | E8 | Delivered on a chosen date | 30 days after delivery |

- **Limits:** `voice_note.max_seconds` (default 15), max 300 KB. Server accepts `audio/mp4`, `audio/m4a`, `audio/aac` only. Record with an AAC/`.m4a` preset in `expo-audio`, and confirm the preset output on iOS and Android during implementation.
- **Storage:** private R2 key `voice-notes/{patientId}/{noteId}.m4a`, served only through the existing 1-hour presigned GET (`shared/storage/r2.ts`).
- **Recording hint to the guardian:** "Pyaar se yaad dilayein. Dawai ki matra (dose) na badlein — woh doctor batayenge."
- **Platform limit:** a push can't auto-play audio recorded after the app was built (Expo bundles notification sounds at build time; Android fixes a channel's sound). The flow is push → tap → the screen opens and plays automatically.

---

## §6C — Family coordination (premium)

A patient can have several guardians (`FamilyLink` is unique per pair). Each action on the missed-dose screen is stored in `MissedDoseResponse`, and the other guardians see "Priya ne Papa ko call kiya ✓ (9:12)", **in-app only with no extra push**, so three children don't all call at once.

---

## §6D — Automated call (DEFERRED — premium, not in v1)

- Premium only, **critical medicines only**, patient opt-in + saved number, max 1 call/day.
- Plays the child's standing note through the existing IVR stack (`shared/calls/`, currently TTS-only). Playing a recording needs vendor verification (Exotel applet / Twilio `<Play>`).
- **TRAI:** automated calls with a pre-recorded voice must be pre-declared and come from **160-series** numbers. Papa will NOT see the child's number.
- The call must open with "SwasthParivar se call hai — Rahul ka sandesh…" so it doesn't look like a voice-clone scam.
- Test mode ON by default. **Cost:** about ₹0.60–1.50/min plus a paid Exotel plan — the only step here that grows in cost with users.

---

## §6E — Family support loops (APPROVED 2026-09-28, premium)

**Principle:** most new pushes go to the **child**, not to Papa. Papa's push budget is small; after 7 ignored pushes the anti-fatigue rule stops everything non-critical for him.

### E1 — Good-news loop

- **Trigger:** a streak milestone (3/7/14/30/50/100 days) is recorded by the streak engine (`milestonesReached`, written in the readings path). Milestones never reach guardians today.
- **Guardian push:** "Papa ki 7 din ki streak! 🔥 Shabaash bhejein?" → sheet with ❤️ / 👏 / 🎙️.
- **Papa:** dashboard card "Rahul ne 👏 bheja". A push is sent only if within his existing 2/day non-med cap; the card shows either way.
- **Data:** `FamilyReaction`.

### E2 — "Shukriya beta"

After a voice note plays, Papa's screen shows "❤️ Shukriya bhejein" → `FamilyReaction` (patient → guardian) → guardian push "Papa ne ❤️ bheja". Max 1 per note.

### E3 — Refill helper

- **Triggers:** (a) skip reason `ran_out` → immediate guardian push; (b) new `MEDICINE_STOCK_CHECK` job (spec'd in `phase4.md`, not built): daily 09:00 patient TZ, when `quantityRemaining` ÷ doses per day < 5.
- **Copy:** "Papa ki Metformin 4 din ki bachi hai — order kar dein?" with a button "Order ho gaya ✓" (stops repeats).
- Max 1 nudge per schedule per 3 days. Only works when `quantityRemaining` is tracked.

### E4 — Appointment heads-up to the child

`APPOINTMENT_REMINDER` (patient household only today) also pushes to entitled guardians, **1-day window only**: "Kal 11 baje Papa ka Dr. Sharma se appointment hai — saath jaayenge?" Requires `doctor_portal_enabled`.

### E5 — Weekly good-news summary (FREE by default)

- New `WEEKLY_FAMILY_SUMMARY` cron, Sunday 19:00 guardian TZ, one push per guardian: "Is hafte Papa ne 12/14 dawai li, 9 readings, 7 din ki streak 👍".
- Built from existing aggregates; no medical interpretation beyond the dashboard summary style.
- Free guardians get at most 1 upsell line.
- Separate from the premium PDF `WEEKLY_REPORT` (not built).

### E6 — "Main theek hoon" daily check-in

- Patient opt-in (`dailyCheckInEnabled`). Dashboard gets a big "🙂 Main theek hoon" button; any reading or medicine log also counts.
- Nothing by 20:00 patient TZ → one guardian push: "Aaj Papa ne check-in nahi kiya — ek call kar lein? 📞" (with the Call button).
- Max 1/day. Never framed as an emergency; SOS stays the emergency path.

### E7 — Grandchild notes

`VoiceNote.senderLabel` (e.g. "Aarav"), chosen on the guardian's phone, with no separate account. Papa sees "Aarav ki taraf se (Rahul ke phone se)" (R4).

### E8 — Scheduled greetings

- The guardian records a greeting and picks a date (or a festival from Feature J's calendar once built; `User` has age, not a birth date).
- Delivered at 08:00 patient TZ by an hourly-tick job. Counts toward Papa's non-med push cap.
- If a critical-bypass fired for Papa in the previous 2 h, the greeting is postponed to later that day.

### E9 — Mood tap (build blocked until review)

- Opt-in chips 😊😐😔 once a day on the dashboard. **No push to Papa.** Shared with guardians only if Papa turns on `shareMoodWithFamily`.
- 😔 on 3 consecutive days → one gentle guardian push: "Papa kuch dino se udaas mehsoos kar rahe hain — baat kar lein?" No diagnosis wording. Never fed into AI chat. Kept 90 days.
- **Gate:** safety + privacy review signed off in `docs/phase6-mood-review.md` before any code is written.

---

## Push budgets

### Guardian side — pure module `packages/domain-logic/src/family-push-budget/` (100% pinned)

- Per guardian, per patient, per day: max `family_push.guardian_daily_cap_per_patient` (default 4).
- **Priority when over the cap:** critical L2 (exempt from the cap) > L2 > E3 `ran_out` > E6 > E4 > E1 > E2. E5 is weekly and exempt. Anything over the cap folds into the 8 PM summary.

### Patient side

- L1: max 1 per missed dose and `family_nudge.patient_daily_cap` per day.
- Voice-note pushes: `voice_note.patient_daily_push_cap` per day; the rest stay in the in-app inbox.
- E1 and E8 pushes count toward the existing 2/day non-med cap.

---

## Schema changes

```prisma
enum VoiceNoteKind    { standing  reply  greeting }
enum MissedDoseAction { call_tapped  voice_note_sent }
enum ReactionKind     { heart  clap  voice_note }
enum ReactionContext  { milestone  voice_note  checkin }
enum MoodKind         { happy  neutral  sad }

model VoiceNote {
  id              String        @id @default(uuid()) @db.Uuid
  senderId        String        @map("sender_id") @db.Uuid        // guardian
  senderLabel     String?       @map("sender_label")              // E7, e.g. "Aarav"
  patientId       String        @map("patient_id") @db.Uuid
  kind            VoiceNoteKind
  medicationLogId String?       @map("medication_log_id") @db.Uuid // SetNull
  r2Key           String        @map("r2_key")
  mimeType        String        @map("mime_type")
  durationMs      Int           @map("duration_ms")
  sizeBytes       Int           @map("size_bytes")
  deliverOn       DateTime?     @map("deliver_on") @db.Date      // E8
  deliveredAt     DateTime?     @map("delivered_at")
  playedAt        DateTime?     @map("played_at")
  expiresAt       DateTime?     @map("expires_at")
  createdAt       DateTime      @default(now()) @map("created_at")
  @@index([patientId, createdAt(sort: Desc)])
  @@index([expiresAt])
  @@index([deliverOn])
  @@map("voice_notes")
}

model MissedDoseResponse {
  id              String           @id @default(uuid()) @db.Uuid
  medicationLogId String           @map("medication_log_id") @db.Uuid // Cascade
  guardianId      String           @map("guardian_id") @db.Uuid
  action          MissedDoseAction
  createdAt       DateTime         @default(now()) @map("created_at")
  @@unique([medicationLogId, guardianId, action])
  @@map("missed_dose_responses")
}

model FamilyReaction {
  id          String          @id @default(uuid()) @db.Uuid
  fromUserId  String          @map("from_user_id") @db.Uuid
  toUserId    String          @map("to_user_id") @db.Uuid
  patientId   String          @map("patient_id") @db.Uuid
  kind        ReactionKind
  context     ReactionContext
  contextRef  String?         @map("context_ref")   // milestone key / voiceNoteId
  voiceNoteId String?         @map("voice_note_id") @db.Uuid
  seenAt      DateTime?       @map("seen_at")
  createdAt   DateTime        @default(now()) @map("created_at")
  @@index([toUserId, createdAt(sort: Desc)])
  @@map("family_reactions")
}

model DailyCheckIn {
  id          String    @id @default(uuid()) @db.Uuid
  userId      String    @map("user_id") @db.Uuid
  date        DateTime  @db.Date
  checkedInAt DateTime? @map("checked_in_at")
  mood        MoodKind?                          // E9 only
  createdAt   DateTime  @default(now()) @map("created_at")
  @@unique([userId, date])
  @@map("daily_check_ins")
}
```

Also:

- **Standing notes:** a partial unique index (raw SQL) caps them at one per `(sender_id, patient_id)` on free tiers; the premium limit of 5 is enforced in the service.
- **`FamilyLink`:** `missedDoseAlertsEnabled Boolean @default(false)`, `remindInMyName Boolean @default(false)`, `nudgeOptInPromptedAt DateTime?`
- **`UserPreferences`:** `familyVoiceNotesEnabled` (default true), `dailyCheckInEnabled` (false), `moodCheckInEnabled` (false), `shareMoodWithFamily` (false)
- **`MedicationLog`:** `patientNudgedAt DateTime?`
- **`MedicationSchedule`:** `refillNudgedAt DateTime?`, `refillAcknowledgedAt DateTime?`
- **`skipReason`** stays a string, but the app sends fixed codes validated by Zod: `not_eating | feeling_unwell | side_effects | ran_out | doctor_said_stop | other`.

---

## Server

### Routes

| Method | Path | Who | Gate |
|---|---|---|---|
| `POST` | `/api/v1/voice-notes` | Guardian | `requireFamilyFeature("voice_notes")` (trial quota applies on free) |
| `PUT` | `/api/v1/voice-notes/standing` | Guardian | `requireFamilyFeature("family_nudges")` |
| `POST` | `/api/v1/voice-notes/greetings` | Guardian | `requireFamilyFeature("scheduled_greetings")` |
| `GET` | `/api/v1/voice-notes?patientId=` | Patient household / sender | Never tier-gated (R11) |
| `GET` | `/api/v1/voice-notes/:id` | Patient household / sender | Metadata + 1 h presigned URL |
| `POST` | `/api/v1/voice-notes/:id/played` | Patient household | — |
| `DELETE` | `/api/v1/voice-notes/:id` | Sender or patient household | — |
| `GET` | `/api/v1/family/patients/:patientId/missed-doses/:logId` | Guardian | Free for critical, premium otherwise |
| `POST` | `/api/v1/family/patients/:patientId/missed-doses/:logId/responses` | Guardian | Same |
| `PUT` | `/api/v1/family/links/:linkId/nudges` | Guardian | `{ missedDoseAlertsEnabled, remindInMyName }` |
| `POST` | `/api/v1/family/reactions` | Guardian or patient | `good_news_loop` |
| `POST` | `/api/v1/checkins` | Patient household | `daily_checkin` / `mood_checkin` |
| `GET` | `/api/v1/family/entitlements?patientId=` | Guardian | Drives badges and locks in the guardian app |

Notes:

- **Call target (A7):** dial the patient's `User.phone`; if `isSyntheticHouseholdPhone()` is true, dial the household primary's phone instead and label it "(Ghar ka phone)".
- **Revoke:** the existing `PUT /api/v1/family/links/:linkId/privacy` with `revoke: true` hard-deletes that guardian's voice notes for that patient in the same transaction.
- `POST /medications/log` gains an optional `source: "nudge" | "voice_note_screen"` for attribution and loop close.

### BullMQ

| Job | Trigger | Behaviour |
|---|---|---|
| `MED_MISSED_ALERT` (extended) | Existing, +60 min | Writes the miss, runs escalation + entitlement + budget, enqueues dispatch. |
| `FAMILY_NUDGE_DISPATCH` (new) | Enqueued | All Phase 6 pushes. Push-only (R5). Idempotent `jobId = ${kind}:${refId}:${recipientId}`. |
| `VOICE_NOTE_RETENTION_SWEEP` (new) | Daily 21:45 UTC | Deletes expired notes from R2 + DB. |
| `MEDICINE_STOCK_CHECK` (new, from phase4 spec) | Daily 09:00 patient TZ (hourly tick) | Patient warning (phase4) + E3 guardian nudge. |
| `WEEKLY_FAMILY_SUMMARY` (new) | Sunday 19:00 guardian TZ (hourly tick) | E5. |
| `DAILY_CHECKIN_WATCH` (new) | Hourly tick | E6 at 20:00 patient TZ. |
| `SCHEDULED_GREETING_DISPATCH` (new) | Hourly tick | E8 at 08:00 patient TZ. |
| `APPOINTMENT_REMINDER` (extended) | Existing | E4, 1-day window. |
| `DAILY_GUARDIAN_SUMMARY` (extended) | Existing 8 PM | Also sends for held/over-cap items and skips with reasons (today it only sends when yellow alerts exist). Max 1/day. Skip copy is informational, e.g. "Papa ne raat ki dawai skip ki — wajah: khana nahi khaya. Zarurat ho to doctor se poochein." |

---

## Mobile (Expo SDK 54)

- **New dependency:** `expo-audio` (`useAudioRecorder`, `requestRecordingPermissionsAsync`). It's a native module, so it ships in a **new EAS build**, not OTA.
- **Guardian:**
  - One-time opt-in sheet on `app/guardian/index.tsx` ("Papa dawai bhool jaayein to aapko batayein?", then the optional standing-note recording).
  - New `app/guardian/missed-dose/[logId].tsx` (modelled on `app/guardian/alert/[alertId].tsx`): 📞 Call (A7 target) + 🎙️ Voice note + other guardians' responses.
  - `src/components/voice/VoiceRecorder.tsx`: tap to start, auto-stop at `max_seconds`, preview, re-record, send; mic denied → settings link.
  - Cheer sheet (E1), weekly summary screen (E5), refill card (E3), greeting scheduler (E8).
  - "⭐ Premium" badges on locked items → Upgrade screen (A9).
- **Patient:**
  - `app/voice-note/[id].tsx`: auto-plays; big replay; "✅ Dawai le li" when linked to a miss; "❤️ Shukriya" (E2); `ActiveProfileBadge`; offline text "Internet aane par sunenge". Max 2 taps from the notification.
  - Dashboard: "Parivar ke messages" inbox card, cheers card (E1), "🙂 Main theek hoon" button (E6), mood chips (E9).
  - Skip reason chips (tap-only).
  - **No premium badges, prices or upgrade prompts anywhere** (R11).
- **Push routing** in `src/services/notifications.ts`: `missed_dose_nudge`, `guardian_missed_dose`, `voice_note_received`, `missed_dose_loop_closed`, `family_reaction`, `refill_nudge`, `appointment_headsup`, `weekly_family_summary`, `checkin_missed`, `greeting_received`.
- **Settings:** patient toggles (voice messages, daily check-in, mood + share with family); guardian toggles (missed-dose alerts, remind in my name, standing notes, greetings).

---

## PostHog events

**Ladder + voice:** `missed_dose_nudge_sent{level, schedule_critical, silent, in_name_of_guardian, with_standing_note}` · `guardian_missed_dose_alert_sent{critical, deferred_to_summary}` · `guardian_missed_dose_opened` · `guardian_call_tapped` · `voice_note_recorded{kind, duration_s, via_trial}` · `voice_note_played{kind, minutes_to_play}` · `dose_recovered{level, minutes_after_nudge, via}` · `voice_note_deleted{reason}`

**Support loops:** `family_reaction_sent{kind, context, direction}` · `refill_nudge_sent{trigger}` · `refill_acknowledged` · `appointment_headsup_sent` · `weekly_family_summary_sent{has_upsell}` · `daily_checkin{via: button|log}` · `checkin_missed_alert_sent` · `greeting_scheduled` · `greeting_delivered` · `mood_logged{mood}` (no free text)

**Opt-in + premium:** `nudge_opt_in{accepted, recorded_standing}` · `family_nudges_disabled{by}` · `premium_feature_blocked{feature, surface}` · `upgrade_cta_tapped{feature}` (joins with existing `tier_changed{reason=purchase}`)

### Success metrics (proposed thresholds — confirm before pilot)

- **Dose recovery rate:** share of `missed_no_response` doses followed by `taken` within 3 h, pilot vs. control.
- **30-day adherence change** vs. control.
- **Guardian mute rate** (alerts off within 14 days): target < 20%; redesign if > 30%.
- **Patient opt-out rate:** redesign if > 15%.
- **Premium conversion:** trial voice notes → upgrade; upgrade taps → purchases.

---

## Tests

- **Domain-logic** (all 100% pinned + property tests): `missed-dose-escalation`, `family-entitlement`, `family-push-budget`.
- **Integration (Testcontainers):**
  - Ladder: L1 on miss #1; L2 on miss #2; critical miss → free L2 even for a free guardian with gating ON; `skipped` never escalates; `taken` resets.
  - **Zero SMS:** a MSG91 spy asserts zero SMS calls across the whole suite (R5).
  - **Paywall:** free guardian with gating ON → 403 `TIER_UPGRADE_REQUIRED` on voice notes after the trial quota; allowed when in `free_access`; **gating ignored while both payment flags are OFF**; household-primary-paid patient unlocks the pair; patient routes never return `TIER_UPGRADE_REQUIRED` (R11).
  - **Downgrade:** notes and greetings retained, premium sends stop, critical alert still fires.
  - **Cohort gating:** a rollout-object flag enables only cohort users **at the API** (regression test for A4).
  - Voice-note authz (pending / revoked / other household → 403; patient opted out → rejected; wrong mime or size → 400); sweep deletes R2 + row; revoke deletes notes; call target for synthetic phones; household delivery prefix + `targetUserId`; budgets fold into the summary; each E-item happy path + cap.
  - **Admin:** entitlement endpoint output; audited takedown writes `AdminAuditLog`; registry panels never expose audio URLs.
- **Mobile (RNTL):** opt-in sheet; missed-dose screen; recorder cap + permission denied; patient voice-note screen auto-play + "Dawai le li"; **no premium UI on any patient screen**; guardian badges → upgrade.

---

## Cost model

| Item | Cost |
|---|---|
| All pushes (ladder, voice notes, E1–E9) | **Free** (Expo push has no charge; 600 notifications/s per project) |
| "Call Papa" | **₹0 to us** (child's own phone plan) |
| `expo-audio` | Free, open source |
| Voice-note storage (R2) | **≈ ₹0**: 10,000 families × 1 note/day ≈ 12 GB steady state with 30-day deletion. Free tier = 10 GB storage, 1 M writes, 10 M reads per month; egress free. |
| SMS | **Not used** (R5) |
| §6D automated call | Deferred; about ₹0.60–1.50/min plus plan fees |

Premium revenue is almost pure margin: the premium features cost essentially the same to run as the free ones.

---

## Sequencing + gates

1. **Separate PRs first (not Phase 6 code):** fix A4 (cohort-flag bug) and add the flag catalog (A5).
2. §6.0 free critical alert.
3. Entitlement resolver + `requireFamilyFeature` + premium control flags (gating **OFF**).
4. §6A ladder, §6B voice notes, §6C coordination (new EAS build).
5. §6E in the suggested order E1 → E5 → E3 → E4 → E2 → E7 → E8 → E6; E9 only after review sign-off.
6. **Pilot** ~20 families for 14 days via `family_features.free_access`, gating still OFF.
7. **Gate to general rollout:** zero SMS sent by this feature; no R1 violations in the pilot log review; mute and opt-out rates under threshold.
8. **Paywall ON** (`family_features.premium_gating_enabled`) only after the §K Upgrade screen ships and a payment flag is ON. The resolver refuses to gate otherwise.
9. §6D only if pilot data shows L2 isn't enough for critical medicines.

---

## Open decisions (product owner)

1. Default free list: keep E5 weekly summary + 3 trial voice notes/month free? (Proposed yes: they drive conversion.)
2. L2 trigger for non-critical medicines: 2nd consecutive miss (proposed) vs. 1st.
3. Budgets: guardian 4/day per patient, patient nudges 3/day.
4. Retention sweep default ON (deviation, see flags).
5. Skip-reason chips change the patient skip UI: approve?
6. Admins can't play voice notes, even for abuse reports (proposed: correct; takedown by metadata + the reporter's description).
7. §6D automated call: keep deferred or drop.
8. Price point: is this bundled in the existing premium/family plans, or a separate add-on? (Proposed: bundled; §K prices unchanged.)

---

## Sources (external facts used above)

- Expo notifications — custom sounds bundled at build time; Android channel sound immutable: https://docs.expo.dev/versions/latest/sdk/notifications/
- Expo push service — no cost, 600/s rate limit: https://docs.expo.dev/push-notifications/faq/
- `expo-audio` recording API: https://docs.expo.dev/versions/latest/sdk/audio/
- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
- TRAI — pre-declaration for automated/pre-recorded calls: https://english.punjabkesari.com/business/trai-tightens-spam-rules-mandates-pre-declaration-for-robocalls
- TRAI — 140 vs 160 series (2026): https://frejun.com/auto-dialer-robocall-140-series-trai-rules-india/
- Exotel pricing (third-party guide; Exotel doesn't publish rates): https://www.cloudtalk.io/blog/exotel-pricing/
- MSG91 SMS pricing: https://msg91.com/in/pricing/sms
- AI voice-clone scams targeting parents in India: https://the420.in/ai-voice-clone-scam-delhi-elderly-woman-kidnapping-fraud/
- Prior art — Reminder Rosie (family-recorded voice reminders; vendor pilot, not peer-reviewed): https://www.prweb.com/releases/reminder_rosie_helps_patients_with_memory_loss_achieve_80_percent_medication_compliance_in_home_care_agency_pilot_study/prweb14336334.htm
