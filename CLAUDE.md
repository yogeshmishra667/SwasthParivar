# SwasthParivar — Claude Code Instructions

> **Production audit landed (2026-05-14).** Reference docs at the repo root:
>
> - `docs/ARCHITECTURE.md` — how observability / idempotency / flag service / critical-bypass / docker fit together. Read before touching any of them.
> - `docs/SETUP.md` — every setup step still pending before prod (DSNs, secrets, branch protection, DR drill).
> - `docs/HOWTO.md` — concrete recipes: use the flag service, add a PostHog event, ship a module, rollback, etc.
> - `docs/runbooks/rollback.md` — incident response runbook (image revert / migration revert / provider kill switch / PITR).
> - `audit-progress.md` — historical roadmap + session log.
> - `scripts/preflight.sh` — wired into pre-push; simulates a fresh CI checkout locally. Override with `git push --no-verify` only in emergencies.

## Project

Chronic condition health companion for Indian families. Patients (elderly, 50-70) manage diabetes, BP, asthma, cardiac. Guardians (adult children, 25-40) monitor remotely. Hindi-first, offline-first, accuracy-first.

## ⚠️ STRICT BUILD PHASES — ENFORCE THIS

### PHASE 1 (Weeks 1-4) — "Does Papa log daily?"

GLUCOSE ONLY. No BP, no cardiac, no respiratory.
Tables: User, GlucoseReading, MedicationSchedule, MedicationLog, UserStreak, FeedbackEvent, NotificationState
Endpoints: auth, glucose logging (manual + voice), medications, dashboard, streaks
Core: frictionless logging + habit loop + medicine reminders + immediate feedback
Voice logging MUST be Phase 1
Critical-low/high bypass MUST be Phase 1 (glucose < 65 or > 315)
Shared phone profile switcher MUST be Phase 1
Success metric: Papa logs 2+ readings/day for 14 consecutive days

### PHASE 2 (Weeks 5-8) — "Does it think?"

Add: BPReading, MealLog (halka/normal/heavy), InsightEvent, HealthScore, HealthCheckSchedule, HealthCheckCompliance
Add: spike + trend detectors (with minimum data rules)
Add: dashboard Hindi summaries (natural-language summary card: "Aaj ka din: Sugar thik hai (Fasting: 118), BP thoda zyada (142/88). Kal se behtar.")
Add: HbA1c estimation: `HbA1c ≈ (avg_glucose_90d_weighted + 46.7) / 28.7`. Weight: recent 30d × 1.5, middle 30d × 1.0, oldest 30d × 0.5. Label as ESTIMATE, recommend lab confirmation
Add: guardian read-only view (FamilyLink, no alerts yet)
Only after Phase 1 retention proven

### PHASE 3 (Weeks 9-12) — "Does it guide?"

Add: ChatMessage, correlation + cross-condition detectors
Add: AI chat (Claude API) with cold start handling
Add: SilentGuardianSignal, GuardianAlert (basic: med adherence + trend only)
Add: SOS (only after 4+ weeks system stability)

### PHASE 4+ (Weeks 13+) — "Does it scale?"

Add: CardiacLog, RespiratoryLog, Prescription, PrescriptionItem, MedicinePhoto
Add: DoctorProfile, DoctorAppointment, ActivityDaily, SleepLog
Add: prescription OCR, advanced Silent Guardian, cross-condition detector
Add: regional languages, festival nudging, wearable integration

## Voice Logging (Phase 1)

**Parsing:** Input: raw transcript + confidence from expo-speech-recognition. Extract number from digits/Hindi words/Hinglish. Context keywords: "subah"/"morning" → fasting, "khana khane ke baad" → post_meal. No context → infer from clock (see Patch #8 time windows). Always allow 1-tap type toggle on confirmation screen.

**Hindi Colloquial Dictionary (run BEFORE standard parsing):**

```
"sava sau"→125  "dedh sau"→150  "paune do sau"→175  "do sau"→200
"dhai sau"→250  "sava do sau"→225  "paune teen sau"→275  "teen sau"→300
"derh sau"→150  "savaa sau"→125
"ek sau das"→110  "ek sau bees"→120  "ek sau tees"→130
"ek sau chaalees"→140  "ek sau pachaas"→150  "ek sau saath"→160
```

**Background Noise:** Prioritize numbers after intent keywords: "sugar", "aayi", "hai", "meri", "aaj". TV/radio numbers without intent → ignore.

**Uncertainty Detection:** Keywords: "shayad", "lagbhag", "approx", "hoga", "lagta hai", "around". If found → force stronger confirmation: "Aap SURE hain ki [value] sahi hai? Pehle check kar lein." Show: "✅ Haan, pakka" / "✏️ Nahi, edit karun"

**Confidence:** < 0.6 → force confirmation. Debounce: ignore duplicate mic within 2s. Timeout: 5s silence → dismiss mic, show numpad.

**Validation:** No number → "Samajh nahi aaya, dobara boliye ya numpad use karein". Multiple numbers → selection UI: tappable buttons. Out of range → "Kya [value] sahi hai?"

**Confirmation (MANDATORY):** Show: "[value] mg/dL — [type] — Save karein?" Show ACTIVE PROFILE: "👤 Ramesh ji ke liye save ho raha hai". Type toggle: 1-tap Fasting/Post-Meal/Random. Buttons: "✅ Haan, save" / "✏️ Edit"

**Fallback:** 2 failed voice → auto-show numpad. 5s silence → auto-show numpad. Voice button always visible alongside numpad.

## Critical-Low/High Bypass (Phase 1 — SAFETY)

If glucose < 65 or > 315 — ALL 4 steps execute in PARALLEL (not if-else):

1. Push notification to guardian (Expo push, primary) ← always
2. SMS to ALL emergency contacts (MSG91, only if push fails) ← fallback
3. In-app FULLSCREEN BLOCKING alert (cannot dismiss 30s) ← always
4. "📞 Call now" button → opens native dialer ← always

Thresholds HARDCODED. Not configurable. Medical safety.

- Low (< 65): "⚠️ Sugar bahut kam hai ([value]). Abhi kuch meetha khayein — juice, glucose, mithai. Agar chakkar aa rahe hain to turant [contact] ko call karein."
- High (> 315): "⚠️ Sugar bahut zyada hai ([value]). Pani peeyein. Dawai li hai check karein. [contact] ko call karein."

## Shared Phone Profile Switcher (Phase 1)

Home screen: profile avatars at top (like Netflix). Tap to switch. Each profile: separate data. Active profile shown on ALL screens: "👤 Ramesh ji". User table: household_id groups profiles. Device stores active_user_id.

**Data Corruption Prevention:** Confirmation screen ALWAYS shows: "👤 Ramesh ji ke liye save kar rahe hain — sahi hai?" Wrong profile → tap avatar to switch BEFORE saving. App open after 30+ min inactive → show profile selector.

## Habit Loop (Trigger → Action → Reward)

**NotificationState (persisted per user):** fatigue_level(0-3), consecutive_ignores, last_notification_at, best_log_time_fasting, best_log_time_post_meal, notification_history_7d(JSONB)

**Priority System:** `PRIORITY_ORDER = [1:critical_low_high, 2:streak_risk(≥7), 3:missed_day, 4:best_time, 5:generic_morning]`. Multiple triggers same time → highest priority ONLY fires. Max 1 non-med push per 30-min window. Same message_key within 24hr → skip.

**Best Time Detection:** Rolling 5-day avg of log timestamps per type. Send 10 min before avg. New user defaults: 7AM, 1:30PM, 8:30PM.

**Copy (contextual):**

- Morning: "Good morning Ramesh ji! Kal sugar [value] thi. Aaj check karein?"
- Med: "Metformin ka time — kal li thi AUR reading achchi aayi thi"
- Streak risk: "[N] din ki streak! Aaj [N+1] complete karein 🔥"
- 1 day skip: "Kal nahi hua — aaj kar lein?"
- 2 days: "Sab theek? 2 din se check nahi hua"

**Anti-Fatigue:** Max 2 push/day (med reminders excluded). 3 ignores → 1/day. 5 → every-other-day. 7 → stop. Opens from push → reset fatigue to 0.

**OTP Delivery:** Gated by `auth.otp.provider` flag (Redis-backed, default `"log"`). Three modes:

- `"firebase"` — `@react-native-firebase/auth` on mobile sends SMS; server verifies ID token via `firebase-admin` at `POST /auth/verify-firebase`. Use this while WhatsApp/MSG91 are blocked on Meta business verification + DLT registration.
- `"whatsapp"` — WhatsApp Business API primary (~₹0.05/msg). Send-side failure → MSG91 SMS fallback. Switch to this once `WHATSAPP_OTP_TEMPLATE_NAME` + `MSG91_OTP_TEMPLATE_ID` are populated and the WABA is verified.
- `"log"` — OTP only appears in server logs; dev bypass `000000` works in `verifyOtp`. Safe default for fresh boots.

Mobile reads `GET /auth/config` on the login screen to pick the flow. Flip the flag via `PUT /admin/flags/auth.otp.provider` or `redis-cli SET flag:auth.otp.provider '"firebase"'` (see `docs/HOWTO.md` "Switch OTP provider").

**Action (<3 taps, ENFORCE):** Voice: 2 taps. Numpad: 3 taps. Any flow > 4 → redesign. NO typing. Voice or tap only. 48dp touch targets.

## Streak Engine

**UserStreak:** user_id, current_streak_days, longest_streak_days, last_log_date, streak_started_at, total_log_days, broken_streak_length, milestones_reached(JSONB)

**Rules:** Count per DAY (multiple logs same day = 1). Day boundary: 3:00 AM user's ONBOARDING timezone (pinned). Grace: 6 hours (until 9 AM). Log at 7AM for yesterday = credits yesterday. Break: no log in window → reset, store broken_streak_length. streak_day = floor((measured_at_in_user_tz - 3hrs) / 24hrs).

**Medical vs Gamification Split:** GlucoseReading.measured_at = actual timestamp (doctor sees). GlucoseReading.streak_credited_to = DATE for gamification. Grace log at 7AM Tue for Mon: measured_at=Tue 7AM, streak_credited_to=Mon.

**Milestones:** 3d:"💪 Achchi shuruaat" | 7d:"🔥 1 hafta!"(confetti) | 14d:"📊 Patterns dikhenge" | 30d:"🏆 1 mahina!" | 50d:"🌟 Bahut kam log karte hain" | 100d:"💯 Inspiration". Each: haptic + animation + stored in milestones_reached.

**Anti-Cheat (flag internally, never block):** Same value 3+ consecutive days → flag. Always round 5+ days → flag. Never prevent logging.

## Feedback Engine

**FeedbackEvent:** user_id, reading_id?, feedback_type, tone(celebrate|neutral|gentle_warn|encourage), message_key, message_variant_index, message_params(JSONB), shown_at

**Post-Log Logic — CRITICAL: ALWAYS compare SAME reading type (fasting vs fasting ONLY, never mix):**

- first_ever_reading → celebrate: "🎉 Pehli reading! [value] mg/dL note ho gaya."
- user_stage < 7 days → find LAST READING of SAME TYPE. No same-type → "✅ [value] noted. [streak] din streak". delta = current - last_same_type. ≤ -10: celebrate | ≥ 10: gentle_warn | else: neutral
- user_stage ≥ 7 days → 7-CALENDAR-DAY ROLLING MEDIAN of SAME TYPE. Only readings from last 7 calendar days. If < 3 same-type → fall back to last same-type comparison. delta = current - median. ≤ -10: celebrate | ≥ 10: gentle_warn | else: neutral

**Festive Tag:** Optional "🎉 Special din?" toggle on confirmation. ON: suppress gentle_warn → "Diwali hai! Enjoy karein. Kal se phir track 🎉". MAX 2 per week per user. Stored in GlucoseReading.context: "festive"

**Message Variability:** 3-5 variants per tone. Rotate. No repeat within 3 days. Store variant_index.

**Micro-Delight:** Every save: light haptic. Celebrate: stronger haptic + sparkle. Milestones: fullscreen 1.5s. Vary animation type.

**Noise & Tone:** < 10 mg/dL → neutral always. Never "worse"/"kharab" → "thoda zyada". Critical (> 315 or < 65): "⚠️ Bahut [high/low]. Doctor se baat karein." NEVER: scary, jargon, guilt.

## Cold Start (Day 1-14)

**First 24h:** Onboarding: language → condition → name/age → FIRST READING → celebration → "Ab dawai track karein?" Medication AFTER first reading. Skip prominent. Name + time ONLY. Incomplete onboarding → resume (User.onboarding_step). No log 4hr → push. No log 24hr → push.

**Guardian-Assisted Onboarding:** Guardian sets up patient's phone via invite link. Enters: name, age, condition, meds, their phone as guardian.

**Days 1-3:** "🎉 Streak shuru!" → progress bar [3/7]
**Days 4-6:** "2 aur din! Weekly report aane wala hai"
**Day 7:** Celebrate + first weekly median + mini-chart. Spike detector activates.
**Day 14:** Full unlock. Trend + HbA1c. "📊 Real insights shuru!"

## Re-engagement

Opened but didn't log (5 min) → in-app banner "1 tap mein log karein ↓". 1/day for 5 days → suggest 2nd reading gently, once/week. 3 ignores → reduce push. 5 → every-other-day. 7 → stop. Return: "Welcome back! Naya streak 💪" — NEVER guilt.

## Fail-Safe UI States (ENFORCE)

NEVER show infinite spinner (max 10s timeout). NEVER show raw error messages. Logging ALWAYS works (WatermelonDB local-first).

| Scenario                           | Fallback                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Backend unreachable                | Save locally, "✅ Save hua. Internet aane par sync hoga." Dashboard shows cached + "Last updated: [time]" |
| Reading save fails (server reject) | "Save nahi ho paya. Retry karein?" + Retry button. Keep in local queue, auto-retry                        |
| Dashboard load fails               | Last cached dashboard + "⚠️ Purana data dikh raha hai". Never empty screen                                |
| Voice parsing crashes              | Auto-show numpad + "Voice mein dikkat hai, numpad use karein"                                             |
| Push service down                  | Local notifications for med reminders (expo-notifications scheduled locally)                              |
| Any unhandled error                | Sentry capture + "Kuch gadbad hui. App restart karein." Never stack trace                                 |

## UX Constraints (ENFORCE)

**<3 Taps:** Voice: 2. Numpad: 3. Any flow > 4 → redesign.
**Undo/Edit:** After save: "Undo" toast 5s. Dashboard: tap last reading → numpad pre-filled for edit.
**Elderly Accessibility:** Min font: 14px body, 16px important, 20px+ numbers. 48dp touch targets. High contrast toggle (WCAG AAA). Large text toggle (1.3x). No swipe/long-press for core flows. Haptic on every save.
**Offline:** WatermelonDB local-first. Sync silently when connected. Med reminders: local notifications fallback.

**Sync Conflict Resolution:** Every reading: client_uuid + updated_at + version(int). Server: idempotent insert by client_uuid. UUID exists AND incoming version > stored → update. Else reject 409. Same UUID edited offline → last-write-wins by version. Guardian config → guardian backend timestamp wins. Patient medical logs → patient local timestamp wins. Soft delete syncs. Never lose data.

## Medication (Phase 1 — Minimal)

In onboarding: AFTER first reading celebration. Skip prominent. Name + time ONLY. No dosage/frequency/condition fields. Guardian can set up remotely → syncs to patient.

## Metrics

**Raw Events (PostHog):** notification_sent, notification_opened, notification_ignored, app_opened{source}, reading_logged{type,source(voice|numpad),time_to_log_seconds,user_stage}, voice_attempt{success,fallback,confidence,colloquial_match,uncertainty_detected}, streak_milestone, medicine_taken, medicine_missed, profile_switched, festive_tag_used, critical_bypass_triggered{value,sms_success,push_success}, undo_used, fail_safe_triggered{scenario}

**Derived (daily):** notification_to_open_rate(>30%), open_to_log_rate(>60%), voice_success_rate(>80%), voice_vs_manual_ratio, day_1/3/7/14/30 retention, time_to_first_log, time_to_second_log, drop_off_day, streak_distribution, reminder_vs_organic_ratio, critical_bypass_sms_success_rate(MUST >95%)

**Developer Alerts:** day_1→3 retention <50% → onboarding problem | voice_success <70% → parsing problem | time_to_first_log >24hr for 30% → friction | time_to_second_log >48hr for 40% → reward problem | critical_bypass_sms_success <95% → SMS provider issue, URGENT

## Stack

Runtime: Node.js + Express + TypeScript (strict, no `any`) | ORM: Prisma | DB: PostgreSQL 16 + TimescaleDB | Cache: Redis (ioredis) | Queue: BullMQ | Auth: Phone OTP (JWT). WhatsApp Business API primary, SMS fallback | AI: Claude Sonnet (chat), Claude Vision (OCR) | Validation: Zod | Logging: Winston | Storage: Cloudflare R2 | PDF: Puppeteer | Voice: expo-speech-recognition | Analytics: PostHog | Errors: Sentry | Uptime: Betterstack

## Project Structure (pnpm workspace)

```
swasth-parivar/
├── pnpm-workspace.yaml
├── CLAUDE.md
├── apps/
│   ├── server/src/
│   │   ├── app.ts
│   │   ├── modules/ (auth, readings, medications, meals, insights/detectors, chat, prescriptions, family, silent-guardian, reports, appointments, activity, sos, health-score, streaks, feedback, sync)
│   │   ├── shared/ (database, middleware, queue, notifications, ai, storage, utils)
│   │   └── config/
│   └── mobile/
├── packages/
│   ├── shared-types/
│   ├── domain-logic/        ← pure functions (voice, streak, feedback, notifications)
│   └── test-factories/      ← shared test data
└── package.json
```

**Module Pattern:** Each module: `module-name.controller.ts`, `module-name.service.ts`, `module-name.routes.ts`, `module-name.validation.ts`, `module-name.jobs.ts`, `module-name.types.ts`

## Database Schema

### Users

- **User:** id, name, age, gender, preferred_language, conditions[], timezone(pinned at onboarding), household_id, onboarding_complete, onboarding_step, tier(free|premium|family), time_anomaly_count(int default 0), created_at
- **FamilyLink:** patient_id, guardian_id, relationship, alert_enabled, visible_conditions[], alert_sensitivity, status
- **EmergencyContact:** user_id, name, phone, relationship, priority, is_guardian

### Streaks & Retention

- **UserStreak:** user_id, current_streak_days, longest_streak_days, last_log_date, streak_started_at, total_log_days, broken_streak_length, grace_used_this_week(int default 0), milestones_reached(JSONB)
- **FeedbackEvent:** user_id, reading_id?, feedback_type, tone, message_key, message_variant_index, message_params(JSONB), shown_at
- **NotificationState:** user_id, fatigue_level(0-3), consecutive_ignores, last_notification_at, best_log_time_fasting, best_log_time_post_meal, notification_history_7d(JSONB), last_3_variant_ids(JSONB)

### Health Readings (TimescaleDB hypertables)

- **GlucoseReading:** id, client_uuid, user_id, value_mg_dl, reading_type(fasting|pre_meal|post_meal|random|bedtime), meal_log_id?, context?(normal|festive), notes?, source(manual|voice|device), measured_at, streak_credited_to(DATE), updated_at, version(int default 1), synced_at — PK: @@id([id, measuredAt]) for TimescaleDB hypertable; uniqueness: @@unique([clientUuid, measuredAt]) (standalone @unique on clientUuid is incompatible with hypertable composite PK)
- **BPReading:** id, client_uuid, user_id, systolic, diastolic, pulse?, context, measured_at, streak_credited_to, updated_at, version, synced_at
- **CardiacLog:** user_id, heart_rate, rhythm_status, chest_pain, pain_severity?, exercise_tolerance, measured_at
- **RespiratoryLog:** user_id, peak_flow?, inhaler_used, inhaler_type?, puffs?, trigger_note?, symptom_severity, measured_at

### Context

- **MealLog:** user_id, meal_type, meal_category(light|normal|heavy_fried), food_description?, logged_at, synced_at
- **MedicationSchedule:** user_id, medicine_name, dosage?, time_slots(JSONB), condition?, is_critical?, photo_url?, quantity_remaining?, active, started_at
- **MedicationLog:** schedule_id, user_id, status(taken|skipped|missed_no_response|delayed), scheduled_for, responded_at?, skip_reason?, reminder_count, guardian_alerted
- **ActivityDaily:** user_id, date, steps, distance_meters, active_minutes, source
- **SleepLog:** user_id, date, sleep_start, sleep_end, duration_minutes, quality, source

### Scheduling

- **HealthCheckSchedule:** user_id, check_type, frequency, scheduled_times(JSONB), reminder_enabled, active
- **HealthCheckCompliance:** schedule_id, user_id, expected_at, completed_at?, reading_id?, status, reminder_count, guardian_notified

### Intelligence

- **InsightEvent:** user_id, pattern_type, conditions_involved[], severity_score, severity_level, message_key, message_params(JSONB), trigger_readings(JSONB), evidence(JSONB), acknowledged, helpful?, created_at, expires_at
- **ChatMessage:** user_id, session_id, role, content, language, referenced_readings(JSONB)?, tokens_used, response_tier, flagged, flag_reason?
- **SilentGuardianSignal:** user_id, signal_source, signal_type, raw_evidence(JSONB), risk_contribution, decay_factor, detected_at, consumed_by_alert?
- **GuardianAlert:** patient_id, guardian_id, alert_type, risk_score, title, summary, details(JSONB), explanation, suggested_action, read_at?, action_taken?, sent_via[]
- **HealthScore:** user_id, score, components(JSONB), computed_for(DATE)

### Medical

- **Prescription:** user_id, doctor_id?, original_photo_urls[], ocr_raw_result(JSONB), status, approved_by?, prescribed_date?
- **PrescriptionItem:** prescription_id, ocr_medicine_name, ocr_dosage, ocr_frequency, ocr_confidence, ocr_alternatives(JSONB)?, verified_medicine_name?, medication_schedule_id?, status
- **MedicinePhoto:** medication_schedule_id, photo_url, ai_read_name?, match_status, match_confidence, verified
- **DoctorProfile:** user_id, name, specialty, clinic_name?, phone?
- **DoctorAppointment:** user_id, doctor_id, scheduled_at, purpose, status, pre_visit_report_id?, reminder_sent_7d, reminder_sent_1d, reminder_sent_2h

### Emergency

- **SOSEvent:** user_id, triggered_at, location_lat, location_lng, last_readings(JSONB), contacts_called(JSONB), resolved_at?, false_alarm
- **IndianFoodItem:** name_en, name_hi, name_regional(JSONB), category, glycemic_index, glycemic_load, common_in_regions[]

## API Routes

### Auth

POST /api/v1/auth/send-otp | POST /api/v1/auth/verify-otp | POST /api/v1/auth/refresh

### Readings

POST /api/v1/readings/glucose | POST /api/v1/readings/glucose/voice | POST /api/v1/readings/bp | POST /api/v1/readings/cardiac | POST /api/v1/readings/respiratory | GET /api/v1/readings/:type?from=&to=&limit=&cursor= | PUT /api/v1/readings/:type/:id | DELETE /api/v1/readings/:type/:id

### Medications

GET /api/v1/medications/schedule | POST /api/v1/medications/schedule | PUT /api/v1/medications/schedule/:id | POST /api/v1/medications/log | GET /api/v1/medications/adherence?days=

### Meals

POST /api/v1/meals | GET /api/v1/meals?from=&to= | GET /api/v1/foods/search?q=&lang=

### Insights

GET /api/v1/insights?severity=&limit=&cursor= | POST /api/v1/insights/:id/acknowledge | GET /api/v1/hba1c/estimate | GET /api/v1/health-score

### Chat

POST /api/v1/chat/message | GET /api/v1/chat/sessions | GET /api/v1/chat/sessions/:id

### Streaks & Feedback

GET /api/v1/streaks/current | GET /api/v1/streaks/milestones | POST /api/v1/feedback/insight/:id | POST /api/v1/feedback/chat/:id

### Prescriptions

POST /api/v1/prescriptions/upload | GET /api/v1/prescriptions/:id | POST /api/v1/prescriptions/:id/approve | POST /api/v1/prescriptions/:id/reject | POST /api/v1/medicines/:id/photo

### Family & Profiles

POST /api/v1/family/invite | POST /api/v1/family/accept | GET /api/v1/family/patients | GET /api/v1/family/patients/:id/dashboard | GET /api/v1/family/patients/:id/alerts | PUT /api/v1/family/privacy | GET /api/v1/household/profiles | POST /api/v1/household/switch/:userId

### Silent Guardian

GET /api/v1/guardian/alerts?patient_id=&type= | POST /api/v1/guardian/alerts/:id/read | GET /api/v1/guardian/daily-summary/:patient_id

### Reports

POST /api/v1/reports/generate | GET /api/v1/reports/:id/status | GET /api/v1/reports/:id/download

### Appointments

POST /api/v1/appointments | GET /api/v1/appointments | PUT /api/v1/appointments/:id | POST /api/v1/appointments/:id/complete

### Activity

POST /api/v1/activity/daily | GET /api/v1/activity?from=&to=

### SOS

POST /api/v1/sos/trigger | POST /api/v1/sos/cancel | POST /api/v1/sos/resolve

### Sync

POST /api/v1/sync/push | GET /api/v1/sync/pull?last_synced_at=

### Schedules

GET /api/v1/schedules | POST /api/v1/schedules | PUT /api/v1/schedules/:id

### Dashboard & Health

GET /api/v1/dashboard | GET /health | GET /health/deep

## BullMQ Jobs

- **ANALYZE_READING:** on new reading → detectors parallel. 3 retries.
- **UPDATE_STREAK:** on new reading → 3AM boundary, grace, timezone. Milestones. FeedbackEvent.
- **TRIGGER_NOTIFICATION:** cron 15min → best_log_time users → contextual push (explicit priority resolver)
- **DAILY_HEALTH_SCORE:** midnight → logging 20%, stability 25%, trend 25%, med 20%, streak 10%
- **MED_REMINDER:** delayed per med time. Contextual copy. No retry.
- **MED_MISSED_ALERT:** 1hr after → guardian if critical
- **DAILY_GUARDIAN_SUMMARY:** 8PM → per guardian across all patients
- **WEEKLY_REPORT:** Sunday
- **SILENT_GUARDIAN_ANALYZE:** after AI chat → sentiment
- **GENERATE_PDF:** on-demand. Include AI summary paragraph: Claude API call to generate executive summary of health trajectory + key discussion points for doctor
- **APPOINTMENT_REMINDER:** 7d, 1d, 2hr
- **PRESCRIPTION_OCR:** after upload → claude vision
- **SCHEDULE_COMPLIANCE_CHECK:** hourly
- **MEDICINE_STOCK_CHECK:** daily → warn < 5 days
- **RE_ENGAGEMENT:** on 1/2/3/5 day skip → nudge
- **SOS:** highest priority. Failed → Sentry.

## Insight Engine

**Minimum Data (not met → SILENT):** Spike: 7d. Trend: 5 points + R² > 0.5. Meal: 5 category instances. Cross-condition: 30d. Anomaly: 21d. Confidence < 70% → stored only.

**ALWAYS compare same reading type. Fasting baseline vs fasting only. Never mix types.**

- **Spike:** 14-day rolling median. mild > 1.5σ, significant > 2σ, severe > 3σ or > 315
- **Trend:** regression 5/14/30 day windows
- **Correlation:** meal CATEGORY. 7-calendar-day window (not "last 7 readings"). Min 5 instances
- **Cross-Condition:** t-test, p < 0.05, min 30 days
- **Anomaly:** median + IQR (not mean + σ)

## AI Chat Safety

1. NEVER medication changes. 2. NEVER diagnose. 3. Only patterns ≥ 70% confidence. 4. Uncertain → "Doctor se poochein". 5. Not enough data → general education (not dead-end). 6. Emergency → skip chat, trigger SOS guidance. 7. Day 1-14: education + available readings.

**Post-Response Safety Filter (AFTER Claude response):** Reject if contains dosage numbers, "start/stop taking", "increase/decrease dose", "you have [condition]", "diagnosed with". Replace: "Yeh sawaal doctor se poochna best rahega." Log to Sentry. "🚩 Flag" button on every AI message.

**Cost:** Tier 1 template ~60%, Tier 2 cached ~20%, Tier 3 Sonnet ~20%

## Prescription OCR

< 60%: RED. 60-85%: YELLOW. > 85%: GREEN. All require human approval. Photo cross-check: mismatch = RED.

## Reading Validation (Zod)

glucose: 20-600. systolic: 60-250. diastolic: 40-150. HR: 30-250. systolic < diastolic → reject. 0 or 999 → confirm.

## Silent Guardian

Signals: chat_sentiment, data_anomaly, med_adherence, schedule_miss, activity_drop, cross_signal
Scoring: 0-30 weekly. 31-60 daily note. 61-80 push max 2/week. 81-100 immediate.
Stacking: need ≥ 1 signal > 40 for ORANGE. Decay: 7d old = 50%.
Every alert: explanation + action. Never just score. Never verbatim chat.

## Multi-Patient Guardian

Multiple patients per guardian. Sorted by urgency. Combined alerts. SOS overrides all.

## Alert Fatigue

Orange max 2/week. Yellow summary only. Guardian ignores 3 → reduce + ask.

## Observability

Health: GET /health, /health/deep. Winston: requestId, method, path, status, duration. Sensitive NEVER logged.

## Rate Limiting

Free: 3 chats/day, 20 readings/day, 100 req/min. Premium: unlimited. Family: premium × patients.

## Caching (Redis)

dashboard 15min. health-score 24hr. hba1c 1hr. food:search 7d. insights 30min. streak 1hr.

## Error Codes

AUTH_OTP_EXPIRED(401), AUTH_OTP_INVALID(401), AUTH_TOKEN_EXPIRED(401), AUTH_UNAUTHORIZED(403), READING_INVALID_VALUE(400), READING_CONFIRMATION_NEEDED(400), MED_SCHEDULE_NOT_FOUND(404), RX_PENDING_APPROVAL(400), FAMILY_LINK_EXISTS(409), FAMILY_NO_ACCESS(403), CHAT_RATE_LIMITED(429), SOS_ALREADY_ACTIVE(409), REPORT_GENERATING(202), INTERNAL_ERROR(500)

## File Upload

multer → sharp → R2. Rx 10MB, strips 5MB. jpeg/png/webp.

## Fallback Mechanisms

Redis down → bypass. BullMQ stuck → cron fallback for critical. Push fails → SMS fallback. SMS fails → retry 3x. Claude down → "available nahi hai". DB slow → stale cache. R2 down → queue retry.

## CORS

dev: localhost:8081, localhost:3000. prod: app origins + admin.

## DB

Prisma pool min 2 max 10. Redis maxRetries 3.

## Payment (Phase 4)

Razorpay webhooks. subscription.activated → tier up. cancelled → downgrade. Apple IAP for iOS.

## Env Vars (zod at startup)

DATABASE_URL, REDIS_URL, JWT_SECRET, JWT_REFRESH_SECRET, OTP_SECRET, CLAUDE_API_KEY, R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET, WHATSAPP_BUSINESS_API_TOKEN, WHATSAPP_PHONE_NUMBER_ID, MSG91_API_KEY, MSG91_SENDER_ID, EXPO_ACCESS_TOKEN, SENTRY_DSN, POSTHOG_API_KEY, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET, NODE_ENV, PORT

## Coding Rules

- async/await, no promise chains
- every service: try/catch with typed errors
- every controller: zod → service
- every detector: pure function → DetectorResult | null
- Prisma for all, raw SQL only for TimescaleDB
- Response: { success, data?, error?: { code, message } }
- Pagination: cursor-based { data, cursor?, hasMore }
- /api/v1/ versioning
- requestId per request → logger + X-Request-Id
- Graceful shutdown: SIGTERM → drain BullMQ → close DB → exit
- Express 5: async errors propagate natively — do NOT add express-async-errors

---

# Edge Case Fixes

## 1. Critical Alert Cooldown + Escalation

critical_alert_cooldown = 30 min per user. If glucose < 65 or > 315:

- **Outside cooldown:** full chain: push(primary) + SMS if push fails + fullscreen + call button. Start escalation timers.
- **Within cooldown:** skip SMS/push. STILL show fullscreen + call button.

**Escalation chain:** 0s: fullscreen alert + call button → 60s: if patient hasn't tapped screen → auto-open dialer to priority_1 contact (any tap cancels) → 5min: if no guardian opened app AND no call connected → auto-trigger IVR call to priority_1 contact (server-side)

## 3. Multiple Emergency Contacts

On critical bypass: contacts = EmergencyContact.where(user_id).orderBy(priority). Push to ALL guardian contacts (who have app). SMS only to contacts where push failed. Track per contact: {contact_id, push_sent, push_delivered, sms_sent, sms_delivered}. If ALL push+SMS fail → show full contact list with call buttons.

## 4. Double Confirmation for Extreme Values

If value > 315 or < 65: RED screen: "⚠️ [value] — yeh bahut [high/low] hai. KYA SAHI HAI?" 3-second delay before confirm button activates. "Haan, sahi hai" / "Nahi, edit karun"

## 5. Voice: Past-Tense Intent Rejection

past_indicators = ["thi","tha","kal","pichle","last"]. present_indicators = ["hai","aayi","abhi","aaj","check ki"]. negated_intent = ["nahi ki","nahi hua","nahi li","check nahi"]. IF present_indicators BUT also negated_intent → NO present intent. IF past_indicators AND no valid present_indicators → reject: "Yeh kal ki reading lag rahi hai. Aaj ki bataiye." Examples: "Kal sugar 140 thi, aaj check nahi ki" → rejected. "Aaj sugar 140 aayi" → accepted. "Sugar 140 hai" → accepted.

## 6. Multiple Number Ranking

IF 2+ numbers extracted: rank by (1) proximity to intent keyword, (2) speech confidence. Show: "[145] (recommended)" highlighted + "[150]" normal. User taps to select.

## 7. Voice Uncertainty Detection (expanded)

uncertainty_words = ["shayad","lagbhag","approx","hoga","lagta hai","around","kareeban"]. If found → "Aap SURE hain? Pehle check kar lein." "Haan, pakka" / "Nahi, edit karun"

## 8. Type Inference Uncertain Windows

Unified time windows (single source of truth):
6-9AM → fasting(confident) | 10-11AM → UNCERTAIN(ask) | 12-2PM → post_meal(confident) | 3-5PM → UNCERTAIN(ask) | 6-7PM → UNCERTAIN(ask) | 7-9PM → post_meal(confident) | 10PM-5AM → UNCERTAIN(ask)

IF uncertain: do NOT auto-select. Highlight toggle yellow: "Fasting ya post-meal? Tap karein". Require explicit selection before save.

## 9. Voice + Profile Switch Lock

onMicActivated(): locked_user_id = active_user_id, disable profile switcher. onConfirmationComplete() OR onMicDismissed(): unlock. Reading saved to locked_user_id always.

## 10. Shared Phone: Recent Switch Extra Friction

If profile_switched_within_last_30_seconds → explicit confirm: "Yeh [name] ke liye hai — sahi hai?" Require tap "Haan". Else: show profile name in confirmation (standard). If app inactive > 30 min → show profile selector.

## 11. Streak Grace Limit

max_grace_per_week = 3. grace_count = readings where streak_credited_to != date(measured_at) in last 7 days. If grace_count >= 3 → log counts for today only, no retroactive credit. Show (encouraging): "Aaj ka log aaj ke liye count hoga — kal thoda jaldi karein 🙂" NOT punishing tone.

## 12. Medication Reminder: No Causal Claims

❌ "Metformin lene ke BAAD sugar kam aayi thi" (implies causation)
✅ "Kal Metformin li thi AUR reading achchi aayi thi" (correlation only)
Rule: never use "ke baad" linking medicine to outcome. Use "aur".

## 13. Offline Sync: Strict Versioning

Every reading: client_uuid + version(int, starts 1). On edit: version++. Server: uuid not exists → insert. uuid exists AND incoming.version > stored → update. uuid exists AND incoming.version <= stored → reject (stale). Server NEVER accepts lower/equal version.

## 14. Push vs SMS Channel Priority

Critical: Push = primary (faster, free). SMS = fallback (only if push fails). Saves ~80% SMS costs. Non-critical: Push only. Never SMS.

## 15. Notification Fatigue Recovery

If fatigue_level > 0 AND user logs 2 consecutive days → reset fatigue_level = 0, reset consecutive_ignores = 0. Prevents: user ignores 7 → stops → comes back → still throttled.

## 16. Festive Tag: Disable After Limit

max_festive_per_week = 2. If >= 2: disable toggle (gray out). "Is hafte 2 baar use ho chuka. Kal se phir available hoga." Show normal feedback.

## 17. Medication Setup Recovery

Wrong medicine → "🗑️ Hatao" button per card, one tap, no confirmation. Skipped in onboarding → after 3 days gentle prompt, if dismissed → don't show for 7 days. Disabled all reminders → respect, show option in settings only.

## 18. Device Time Manipulation Detection

threshold = 2 hours (not 1 — poor network causes 1hr drift). Require 2+ occurrences. If abs(device_timestamp - server_received_at) > 2hr → increment time_anomaly_count. If count >= 2 → flag possible_time_manipulation, use server_received_at for streak, log to PostHog. Else → allow device time.

## 19. Data Loss Perception Fix

Every locally saved reading: "💾 Saved locally" badge (green, small). Synced → "☁️ Synced" for 3s then disappears. Offline > 1hr → top banner: "📵 Offline mode — readings safe hain, sync baad mein hoga". Stale dashboard: "Last updated: [time]" footer. NEVER blank screen.

## 20. First Failure Guided Recovery

2 voice fails → numpad + example phrase. 3 numpad errors → range hint. Network fail → "💾 Locally save hua. Koi dikkat nahi." Never show "Error"/"Failed"/technical text.

## 21. Notification Message Pool

5 variants per trigger type. Selection: random, no repeat within last 3. Store last_3_variant_ids in NotificationState. Morning examples: "Kal [value] thi. Aaj check karein?", "Sugar check ka time 🙏", "[streak] din ka streak! Aaj bhi log karein 🔥"

## 22. Additional PostHog Events

critical_alert_cooldown_hit{value,minutes_since_last}, critical_alert_escalation_triggered{minutes_no_response}, critical_alert_auto_call_triggered{contact_id}, critical_sms_per_contact{contact_id,delivered}, extreme_value_double_confirm{value,confirmed}, voice_past_tense_rejected{transcript}, voice_uncertainty_detected{keyword,value}, type_inference_uncertain{time,user_changed}, profile_switch_recent_confirm{correct}, grace_limit_reached{used_this_week}, offline_banner_shown{duration_offline}, festive_tag_disabled{used_this_week}, med_setup_removed{medicine_name}, time_manipulation_detected{device_time,server_time,delta}, first_failure_help_shown{type:voice|numpad|network}, notification_variant_sent{trigger_type,variant_id}

---

# Testing Strategy

## Philosophy

**Rule 1:** Safety-critical = 100% branch coverage (critical bypass chain). **Rule 2:** Domain logic = pure functions, no DB/side effects, tested exhaustively. **Rule 3:** Real containers (Testcontainers) for DB/Redis/BullMQ. Mocks only for external HTTP APIs (MSG91, Expo Push, Claude).

## Stack

Unit: Vitest | Property: fast-check | HTTP integration: Supertest | Real DB/Redis: Testcontainers | External API mocks: msw | Test data: @faker-js/faker + custom factories | Mobile: RNTL | Mobile E2E: Detox (Phase 2+ only) | Coverage: Vitest v8

## Package Structure

```
packages/domain-logic/ (ZERO db/network imports, enforced via tsconfig path blocks)
  src/: voice-parser.ts, streak-engine.ts, feedback-engine.ts, notification-resolver.ts, critical-bypass.ts
  tests/: *.test.ts + *.property.test.ts

packages/test-factories/
  src/: user.factory.ts, glucose-reading.factory.ts, streak.factory.ts, notification-state.factory.ts, voice-transcript.fixtures.ts
```

## Required Test Cases — Voice Parser

**Colloquial Hindi:** Test all dictionary mappings: sava sau→125, dedh sau→150, sava do sau→225, dhai sau→250, do sau→200, teen sau→300, paune do sau→175, paune teen sau→275. Plus Devanagari variants (सवा सौ→125, डेढ़ सौ→150) and digit forms (140, "ek sau chaalees"→140, "ek sau bees"→120).

**Type inference from clock:** 6:30AM→fasting, 1:30PM→post_meal, 3PM→uncertain(requiresTypeConfirmation), keyword "subah" at noon→fasting(keyword wins).

**Past-tense rejection:** "kal sugar 140 thi" → null. "aaj sugar 140 aayi" → 140. "sugar 140 hai" → 140. "kal 140 thi aaj check nahi ki" → null.

**Uncertainty detection:** All uncertainty_words trigger uncertaintyDetected=true.

**Confidence:** < 0.6 → requiresStrongConfirmation. >= 0.6 → normal.

**Multiple numbers:** Returns ranked list with recommended=true for closest to intent keyword.

**Range validation:** Below 20 → null. 600+ → requiresDoubleConfirmation.

**Property tests (fast-check):** (1) Parsed value always 20-600 or null. (2) Uncertainty detection is idempotent. (3) Past-tense-only transcripts never produce a reading.

## Required Test Cases — Streak Engine

**Day boundary (3AM):** 2:59AM IST → credits previous day. 3:01AM IST → credits current day.

**Grace period:** 7AM Tue log with no Mon log → credits Monday (within grace). 4th grace in 7 days → credits today only, grace_limit_reached=true.

**Double-logging:** Two logs same streak_day → streak unchanged.

**Anti-cheat:** Same value 3+ days → flagged. Always round 5+ days → flagged. Flag does NOT prevent save.

## Required Test Cases — Feedback Engine

**CRITICAL same-type comparison:** Fasting compares to last FASTING only (not post-meal). Falls back to last-same-type if < 3 in rolling window.

**First reading:** Always celebrate regardless of value.

**Festive tag:** gentle_warn → neutral when festive. Critical values ALWAYS warn regardless of festive.

**Noise floor:** Delta < 10 → always neutral.

**Message variability:** No variant repeats within 3 consecutive feedbacks.

## Required Test Cases — Notification Resolver

**Priority:** critical_low_high fires even at max fatigue(3). Multiple triggers → only highest priority. Duplicate message_key within 24hr → suppressed.

**Anti-fatigue:** 3 ignores → max 1/day. 7 ignores → stop all non-critical.

**Fatigue recovery:** 2 consecutive log days → reset fatigue=0, ignores=0.

## Required Test Cases — Critical Bypass (Safety-Critical, 100% branch)

**Full chain:** All 4 steps execute in parallel for critical low (<65) and high (>315).

**Failure resilience:** SMS fails → push+fullscreen still execute. SMS+push both fail → fullscreen ALWAYS shows. SMS to ALL contacts in parallel.

**Cooldown:** Within 30min cooldown → skip SMS+push but ALWAYS show fullscreen.

**Hardcoded thresholds:** 64→critical, 65→normal, 315→normal, 316→critical.

## Required Test Cases — Integration (HTTP + Real DB)

**POST /api/readings/glucose:** Saves reading, returns streak+feedback. Idempotent: same client_uuid twice → 200 not 500. Critical value <65 → response has critical=true.

**Sync conflict:** Server rejects stale version (version <= stored) with 409.

## Required Test Cases — BullMQ Jobs

**Med reminder:** Sends push when due. Push service down → local notification fallback.

## Required Test Cases — Mobile Components (RNTL)

**VoiceConfirmation:** Shows active profile name. Type toggle works with 1 tap. 3-second delay on extreme values before confirm activates.

**ProfileSwitcher:** Mic locks profile switcher. Recent switch → extra friction confirm.

**FailSafe UI:** Spinner never shows >10s. Backend down → cached data + stale warning.

## Required Test Cases — PostHog Events

critical_bypass_triggered fires with correct shape {value, sms_success, push_success}. voice_attempt fires on successful parse with {success, fallback, confidence, colloquial_match, uncertainty_detected}. Important: developer alerts depend on correct event field names.

## Test Data Factories

`makeReading(overrides)` → GlucoseReading with faker defaults (value 70-300, random type, recent date). `makeStreak(overrides)` → UserStreak with defaults. `VOICE_FIXTURES` → real transcripts: colloquial (with device/lang), devanagari, noisy (with/without intent), edge cases (empty, past-tense, uncertain).

## Coverage Targets

| Path                          | Target              |
| ----------------------------- | ------------------- |
| packages/domain-logic/        | 100% lines+branches |
| critical-bypass.service.ts    | 100% branches       |
| streak-engine.ts              | 100%                |
| voice-parser.ts               | 95%+                |
| feedback-engine.ts            | 95%+                |
| notification-resolver.ts      | 90%+                |
| apps/server/modules/readings/ | 80%+                |
| apps/server/modules/auth/     | 80%+                |
| apps/mobile/components/       | 70%+                |

Vitest: v8 coverage, thresholds per path, reporters: text+lcov+html.

## CI Pipeline

**unit-tests** (domain-logic, no Docker: `pnpm test:unit`+`pnpm test:coverage`), **integration-tests** (Testcontainers: `pnpm test:integration`), **mobile-tests** (RNTL). Unit <5s, integration 60-90s.

## What NOT to Test

- Don't test Prisma types or third-party internals (BullMQ retry etc.)
- Don't mock own domain logic — let pure functions run
- No E2E in Phase 1 (Detox Phase 2+). No snapshot tests.
