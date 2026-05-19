# Phase 3 — Best-in-Class Implementation Plan

> Companion to: `audit-progress.md`, `docs/ARCHITECTURE.md`, `CLAUDE.md`, [`phase-3-progress.md`](./phase-3-progress.md) (per-session work log).
> Status: approved 2026-05-17. **In progress** — see `phase-3-progress.md` for the per-session log of merged commits and in-flight branches.

---

## Context

Phase 1 (glucose-only logging + voice + critical-bypass + shared-phone profile + streaks + feedback) is shipped. Phase 2 (BP, meals, insights, HbA1c estimate, health-score, guardian read-only dashboard via FamilyLink) closed with PR #38 on 2026-05-16. CI hardening PR #39 (CodeQL, Trivy, eslint-plugin-security, SBOM, OpenSSF Scorecard) is merged to `main`.

Phase 3 ("Does it think? Does it guide?") introduces the **first user-facing AI surface** (Claude chat), the **first proactive guardian alerting** (Silent Guardian), the **first cross-condition intelligence** (correlation + cross-condition detectors), and the **first emergency feature** (SOS). Three of these four can harm a patient if wrong — wrong chat answer, missed alert, missed SOS. This plan is therefore biased to **safety, observability, kill-switches, and pure-function testability** over speed.

**Outcome:** Patient and guardian both feel the system has "thought" — patterns surface, the guardian gets contextual alerts (not raw scores), and SOS works on the first try.

**Hard build-phase rules** (CLAUDE.md):

- AI chat NEVER changes medication, NEVER diagnoses; post-response filter mandatory; "🚩 Flag" on every message.
- Silent Guardian Phase 3 scope = **med adherence + trend only** (no chat-sentiment / activity-drop / cross-signal yet — those need data we won't have).
- Cross-condition detector needs **30 days** of paired data minimum; correlation detector needs **5 same-category instances** in 7-day window.
- **SOS launch is gated on 4+ weeks Phase 2 stability** (earliest enable date ≈ 2026-06-14). Scaffold + tests can land before, behind a disabled flag.
- Critical-bypass thresholds, 30-min cooldown, 3AM streak boundary — **HARDCODED, untouchable** in Phase 3.

---

## Sequencing principle (applies to every feature)

```
Schema (migration) → Pure domain-logic functions (100% / 95%+ coverage)
  → Service layer (BullMQ jobs + Prisma) → Flag-gated HTTP endpoint
  → Integration test (Testcontainers + supertest) → Mobile integration behind flag
  → Internal cohort enable → Ramp via flag percentage → Phase-3 done
```

**Every Phase 3 feature lands behind a kill-switch flag in `OFF` state.** Flags added on-demand at the merge that first uses them (per ARCHITECTURE.md "no preemptive flag keys"):

- `ai_chat_enabled` (boolean, default false)
- `ai_chat_tier3_enabled` (boolean, default false — Tier 3 Sonnet calls cost ₹; ramp last)
- `cross_condition_detector_enabled` (boolean, default false)
- `correlation_detector_enabled` (boolean, default false)
- `silent_guardian_enabled` (boolean, default false)
- `silent_guardian_alerts_dispatch` (boolean, default false — separates compute from delivery)
- `sos_enabled` (boolean, default false)
- `sos_test_mode` (boolean, default true — when true, escalation chain logs but does NOT call/SMS)

---

## Week-by-week sequence with gates

### Week 9 — AI Chat foundation (server + safety)

**Gate to Week 10:** All Tier 1 (template) responses ship in test mode + Post-Response Safety Filter has 100% branch coverage + 25+ adversarial test cases pass.

### Week 10 — AI Chat full + Cross-Condition / Correlation detectors

**Gate to Week 11:** Tier 2 cache hit rate ≥ 30% on synthetic corpus + cross-condition detector returns `null` correctly when data sparsity rules unmet + integration tests green.

### Week 11 — Silent Guardian (signals + alerts dispatch)

**Gate to Week 12:** Daily guardian summary cron runs cleanly for 7 internal users + max-2-orange/week limit enforced + zero verbatim-chat leaks.

### Week 12 — SOS scaffolding (NOT launch)

**Gate to launch:** Phase 2 ran for ≥ 4 weeks in production with no SEV1 (verified from audit-progress.md). If gate fails, SOS module ships behind permanent `sos_enabled=false` until met.

---

## Feature A — AI Chat (Claude API)

### A.1 Schema

`apps/server/prisma/schema.prisma` — add models:

```prisma
model ChatSession {
  id          String   @id @default(uuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  startedAt   DateTime @default(now())
  endedAt     DateTime?
  language    Language
  // Soft retention: archive after 90 days, hard-delete after 1 year
  archivedAt  DateTime?

  messages    ChatMessage[]

  @@index([userId, startedAt(sort: Desc)])
}

model ChatMessage {
  id                  String            @id @default(uuid())
  clientUuid          String            // idempotency key (mobile-generated)
  version             Int               @default(1)
  sessionId           String
  session             ChatSession       @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  userId              String            // denormalized for tenant filter
  role                ChatRole          // user | assistant | system
  content             String            @db.Text
  language            Language
  referencedReadings  Json?             // [{type, id, measuredAt, value}]
  tokensInput         Int               @default(0)
  tokensOutput        Int               @default(0)
  costTier            ChatCostTier      // template | cached | sonnet
  responseLatencyMs   Int?
  flagged             Boolean           @default(false)
  flagReason          String?           // safety_filter_rejected | user_flagged | other
  safetyViolations    Json?             // ["dosage_number","diagnosis_word"]
  createdAt           DateTime          @default(now())

  @@unique([clientUuid])
  @@index([userId, createdAt(sort: Desc)])
  @@index([sessionId, createdAt(sort: Asc)])
  @@index([flagged, createdAt]) // for safety review queue
}

enum ChatRole {
  user
  assistant
  system
}

enum ChatCostTier {
  template
  cached
  sonnet
}
```

Migration filename: `20260518000000_chat_messages/migration.sql` (convention from existing `20260516000000_family_links`).

### A.2 Pure domain-logic additions (`packages/domain-logic/src/`)

All zero-IO. Time-as-parameter. Empty-input safety. **100% branch coverage on chat-safety-filter (safety-critical).**

1. **`chat-safety-filter.ts`** — Post-Response Safety Filter

   ```typescript
   export type SafetyViolation =
     | "dosage_number" // e.g. "500mg", "two tablets"
     | "start_stop_directive" // "start taking", "stop taking"
     | "dose_change" // "increase dose", "reduce dose"
     | "diagnosis_claim" // "you have diabetes", "diagnosed with"
     | "emergency_advice" // dangerous "drink sugar water now" without bypass context
     | "verbatim_pii"; // patterns matching phone/aadhaar

   export interface SafetyFilterResult {
     safe: boolean;
     violations: SafetyViolation[];
     redactedContent: string; // safe substitute when unsafe
     originalContent: string; // preserved for Sentry audit
   }

   export function filterChatResponse(input: {
     content: string;
     language: "hi" | "en" | "hi-en";
   }): SafetyFilterResult;
   ```

   Replacement string per CLAUDE.md: `"Yeh sawaal doctor se poochna best rahega."`. Tested with 30+ adversarial fixtures (English directives, Devanagari directives, transliterated Hinglish, code-mixed, false-positive guards on "kam karein" generic encouragement vs medication dosage).

2. **`chat-cost-router.ts`** — 3-tier router

   ```typescript
   export type CostTier = "template" | "cached" | "sonnet";
   export function pickCostTier(input: {
     intent:
       | "reading_summary"
       | "medication_question"
       | "lifestyle"
       | "data_explainer"
       | "open_ended";
     userStageDays: number; // < 14 → bias to template
     readingsAvailable: number; // < 5 → template-only fallback
     historyMatch: boolean; // true → cached
   }): CostTier;
   ```

   Routes ~60% template / ~20% cached / ~20% sonnet on synthetic distribution.

3. **`chat-cold-start.ts`** — Day 1-14 fallback responder

   ```typescript
   export function coldStartResponse(input: {
     userStageDays: number;
     condition: "diabetes" | "bp" | "multi";
     language: "hi" | "en" | "hi-en";
     intent: string;
   }): { content: string; tier: "template" } | null; // null = pass to AI
   ```

   Returns null after day 14 or when data sufficient. Never dead-ends — always offers education topic.

4. **`chat-template-responses.ts`** — Tier 1 deterministic responses keyed by intent + condition + lang.

### A.3 Files to create (server)

- `apps/server/src/shared/ai/claude.ts` — Claude API wrapper
  - Reads `CLAUDE_API_KEY` from env (already wired in `apps/server/src/config/env.ts`).
  - Anthropic SDK with prompt caching (cache the system prompt + recent reading context per session).
  - Exponential backoff (3 retries: 500ms, 1.5s, 5s).
  - Circuit breaker: if 5 consecutive failures in 60s → open circuit for 5 min, return Tier 1 template fallback. Per rollback runbook section 3 (fail-open for non-critical paths).
  - Token counting via SDK response usage. Cost-tier-aware model selection (`claude-haiku` for cached cheap, `claude-sonnet` for tier 3).
  - Sentry breadcrumb on every call (no PII content, only metadata: tier, latency, tokens).
  - PostHog event `ai_chat_response_generated` per call.
  - Hard timeout 12s.

- `apps/server/src/modules/chat/chat.controller.ts`
- `apps/server/src/modules/chat/chat.service.ts`
- `apps/server/src/modules/chat/chat.routes.ts`
- `apps/server/src/modules/chat/chat.validation.ts` (Zod for POST /message, GET /sessions, GET /sessions/:id)
- `apps/server/src/modules/chat/chat.types.ts`
- `apps/server/src/modules/chat/chat.jobs.ts` — enqueue safety-audit-flag job on safety violation
- `apps/server/src/modules/chat/chat-flag.controller.ts` — POST /api/v1/chat/messages/:id/flag (user-initiated 🚩)

Scaffold via `scripts/scaffold/new-module chat` then customize.

### A.4 Service flow (POST /api/v1/chat/message)

1. Idempotency check on `clientUuid` (reuse readings.service.ts:60-90 pattern). Replay returns same response, no API call.
2. Flag gate: `getFlag('ai_chat_enabled', false)` → 503 with `{error:{code:'CHAT_DISABLED'}}` if false.
3. Rate limit: free tier 3/day (per CLAUDE.md). Use Redis counter `chat:rate:${userId}:${YYYY-MM-DD}`.
4. Emergency check: if user's latest reading < 65 or > 315 within 30min → SKIP chat, return canned: `"Pehle critical alert handle karein. Doctor ko abhi call karein."` + return reference to existing critical-bypass row. PostHog: `chat_emergency_skip`.
5. Cold start router (`coldStartResponse`) — if returns content, use it. Tier = template.
6. Cost tier router (`pickCostTier`) → template | cached | sonnet.
7. Build reading context (last 7d glucose+BP, last 3d med adherence) — pure helper.
8. Call Claude wrapper if Tier 2/3.
9. **Run `filterChatResponse` on output.** If `safe === false`:
   - Replace with `redactedContent`.
   - `flagged = true`, store `safetyViolations`.
   - Sentry capture (level: error, no PII, only violation types + tier).
   - PostHog `chat_safety_filter_rejected`.
10. Persist `ChatMessage` (input + response, single transaction).
11. Return `{ success: true, data: { messageId, content, tier, tokensUsed, flagged } }`.

### A.5 BullMQ queue additions (`apps/server/src/shared/queue.ts`)

- `CHAT_SAFETY_REVIEW` — fired when `flagged=true`. Persists to safety review queue for human audit. Retry: 3, exp backoff.

### A.6 Env vars (`apps/server/src/config/env.ts`)

`CLAUDE_API_KEY` already optional. Add:

- `CLAUDE_MODEL_HAIKU` (default `claude-haiku-4-5`, override-able)
- `CLAUDE_MODEL_SONNET` (default `claude-sonnet-4-5`)
- `CHAT_DAILY_FREE_LIMIT` (default `3`)
- `CHAT_HARD_TIMEOUT_MS` (default `12000`)
- `CLAUDE_DAILY_SPEND_CAP_USD` (default `50`)

### A.7 Test factories (`packages/test-factories/src/`)

- `chat-session.factory.ts`
- `chat-message.factory.ts` (with `withSafetyViolation()` builder)

### A.8 Tests

- Unit (`packages/domain-logic/tests/chat-safety-filter.test.ts`): 30+ adversarial cases. Property test: random Devanagari/Hinglish strings never bypass dosage_number when contain digits + medicine name.
- Unit (`chat-cost-router.test.ts`): table-driven, all branches.
- Unit (`chat-cold-start.test.ts`): day 1, 7, 14, 15 boundaries × 3 conditions × 3 languages.
- Integration (`apps/server/tests/integration/chat.test.ts`):
  - Idempotent replay (same clientUuid → same response, no Claude call).
  - Flag disabled → 503.
  - Critical reading → emergency skip.
  - Rate limit 3/day enforced.
  - Tier 1 ↔ Tier 3 routing with MSW-mocked Claude.
  - Safety filter rejection round-trip.
  - User flag endpoint (POST /messages/:id/flag) sets flagged=true and emits PostHog.

### A.9 Coverage targets

- `chat-safety-filter.ts`: **100% branches** (safety-critical, lockfile in `vitest.config.ts`).
- Other domain-logic chat files: 95%+.
- `apps/server/src/modules/chat/`: 80%+.

### A.10 Rollback

- **Kill switch:** flip `ai_chat_enabled=false` via `PUT /admin/flags` — 30s cache decay, then all requests get 503.
- **Tier 3 cost runaway:** flip `ai_chat_tier3_enabled=false`, router degrades to Tier 1/2.
- **Bad migration:** ChatMessage / ChatSession are additive — `prisma migrate resolve --rolled-back`, drop tables. No data dependency from earlier phases.

### A.11 Mobile work (5 components, server-gated)

- `ChatScreen` (full chat UI, Hindi-first)
- `MessageBubble` with 🚩 flag button always rendered
- `EmergencyChatGuard` (intercepts chat send when critical reading active)
- `CostTierBadge` (dev only, behind dev-menu flag)
- `OfflineChatBanner` (chat is online-only — explicit messaging when offline)

---

## Feature B — Cross-Condition + Correlation Detectors

### B.1 Pure domain-logic additions

All in `packages/domain-logic/src/detectors/`. Extending the existing pattern (spike.ts, trend.ts, anomaly.ts, meal-correlation.ts).

1. **`cross-condition.ts`** — glucose × BP correlation

   ```typescript
   export interface CrossConditionInput {
     glucoseReadings: TypedGlucoseReading[]; // last 30+ days
     bpReadings: TypedBPReading[];
     now: Date;
     minDays?: number; // default 30
     pValueThreshold?: number; // default 0.05
   }
   export function detectCrossCondition(input: CrossConditionInput): DetectorResult | null;
   ```

   Welch's t-test (variance-unequal) comparing glucose distribution on days with high BP vs normal BP. Returns null if < 30 days paired data, < 10 pairs in either group, or p ≥ 0.05. **Confidence ≥ 70% required** — else return null per CLAUDE.md "≥70% confidence patterns only".

2. **`correlation-meal.ts`** — extends existing meal-correlation

   ```typescript
   export function detectMealCategoryCorrelation(input: {
     glucoseReadings: TypedGlucoseReading[];
     mealLogs: TypedMealLog[];
     now: Date;
     windowDays?: number; // default 7
     minInstances?: number; // default 5
   }): DetectorResult | null;
   ```

   **Same reading type only** (fasting vs fasting, post_meal vs post_meal — never mix). 7 calendar-day rolling window (NOT "last 7 readings"). Returns null if < 5 same-type instances in any meal category.

3. **`stats-helpers.ts`** additions (if needed): `welchTTest`, `linearRegressionR2` (may already exist — check existing `stats.ts`).

### B.2 Service wiring

Modify `apps/server/src/modules/insights/insights.service.ts`:

- Already has the `analyze-reading` worker fanout pattern. Add `detectCrossCondition` and `detectMealCategoryCorrelation` to the parallel detector list.
- **Flag gate per detector:** `if (await getFlag('cross_condition_detector_enabled', false)) results.push(detectCrossCondition(...))`.
- Persist `InsightEvent` via existing pipeline. No new model needed — `cross_condition` enum already exists.

### B.3 BullMQ

No new queue — reuse `ANALYZE_READING`.

### B.4 Test factories

- `meal-log.factory.ts` (may exist — verify; add if not)
- `bp-reading.factory.ts` (verify)
- `cross-condition-paired.fixtures.ts` — known-signal datasets and known-null datasets.

### B.5 Tests

- `packages/domain-logic/tests/cross-condition.test.ts`:
  - Returns null when < 30 days data.
  - Returns null when < 10 paired observations.
  - Returns null when p ≥ 0.05.
  - Returns null when confidence < 70%.
  - Returns DetectorResult with correct severity for known-signal fixture.
- `correlation-meal.test.ts`:
  - Fasting compares to fasting only (regression: never mix types).
  - 7-day calendar window, not "last 7".
  - Min 5 instances enforced.
  - Festive-tagged readings excluded.
- Integration: `apps/server/tests/integration/insights-cross-condition.test.ts` — POST glucose → detector runs → InsightEvent row written when fixture seeded.

### B.6 Coverage: 95%+ on both detectors.

### B.7 Rollback

- Flip `cross_condition_detector_enabled=false` or `correlation_detector_enabled=false`. No DB rollback needed (additive InsightEvent rows; can soft-acknowledge bad insights via existing acknowledge endpoint).

### B.8 Mobile work

- `InsightCard` already exists from Phase 2 — verify cross-condition InsightEvent renders correctly via existing pattern. No new component expected.

---

## Feature C — Silent Guardian (signals + alerts)

**Phase 3 scope per CLAUDE.md:** signals from med_adherence + data_anomaly (trend) only. Other sources (chat_sentiment, schedule_miss, activity_drop, cross_signal) deferred — they need data we don't have or stable upstream features.

### C.1 Schema

```prisma
model SilentGuardianSignal {
  id                String   @id @default(uuid())
  userId            String   // patient
  user              User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  signalSource      SignalSource
  signalType        String   // e.g. 'missed_med_24h', 'declining_fasting_trend'
  rawEvidence       Json     // { schedule_id, missed_count, trend_slope, etc. }
  riskContribution  Int      // 0-100
  decayFactor       Float    @default(1.0)  // recomputed daily, hits 0.5 at 7d
  detectedAt        DateTime @default(now())
  consumedByAlert   String?  // GuardianAlert.id if this signal contributed to a fired alert

  @@index([userId, detectedAt(sort: Desc)])
  @@index([consumedByAlert])
}

enum SignalSource {
  med_adherence
  data_anomaly
  // future: chat_sentiment, schedule_miss, activity_drop, cross_signal
}

model GuardianAlert {
  id                String              @id @default(uuid())
  patientId         String
  patient           User                @relation("PatientAlerts", fields: [patientId], references: [id], onDelete: Cascade)
  guardianId        String
  guardian          User                @relation("GuardianAlerts", fields: [guardianId], references: [id], onDelete: Cascade)
  alertType         GuardianAlertType   // trend_concern | med_adherence | combined
  riskScore         Int                 // 0-100
  severity          GuardianAlertSeverity // yellow | orange (red reserved Phase 4)
  title             String
  summary           String              // 1-line Hindi-first
  details           Json                // structured for mobile rendering
  explanation       String              // WHY this fired — never just score
  suggestedAction   String              // WHAT guardian should do
  signalIds         String[]            // SilentGuardianSignal ids that produced this
  sentVia           AlertChannel[]      // push, sms, in_app
  pushDelivered     Boolean             @default(false)
  smsDelivered      Boolean             @default(false)
  readAt            DateTime?
  actionTaken       String?             // 'called_patient' | 'ignored' | 'helpful' | null
  createdAt         DateTime            @default(now())

  @@index([guardianId, createdAt(sort: Desc)])
  @@index([patientId, createdAt(sort: Desc)])
  @@index([severity, createdAt])
}

enum GuardianAlertType {
  trend_concern
  med_adherence
  combined
}

enum GuardianAlertSeverity {
  yellow  // summary only
  orange  // push, max 2/week
  // red reserved for SOS-adjacent in Phase 4
}

enum AlertChannel {
  push
  sms
  in_app
}
```

Migration: `20260525000000_silent_guardian/migration.sql`.

### C.2 Pure domain-logic additions

1. **`guardian-signal-scorer.ts`**

   ```typescript
   export function scoreSignal(input: {
     source: SignalSource;
     evidence: Record<string, unknown>;
     userBaseline: { mean: number; sigma: number } | null;
   }): { contribution: number; signalType: string; reasoning: string };
   ```

   Pure. Deterministic. Table-tested across all signal types.

2. **`guardian-signal-aggregator.ts`**

   ```typescript
   export function aggregateRisk(input: {
     signals: { contribution: number; detectedAt: Date }[];
     now: Date;
     decayHalflifeDays?: number; // default 7
   }): { totalScore: number; severity: "safe" | "yellow" | "orange" };
   ```

   Decay: 50% at 7 days (exponential `0.5 ^ (age_days / 7)`). Severity bands per CLAUDE.md: 0-30 safe, 31-60 yellow (daily note), 61-80 orange (push, max 2/wk), 81+ deferred Phase 4.

3. **`guardian-alert-deduper.ts`**

   ```typescript
   export function shouldDispatchAlert(input: {
     candidate: { severity: "yellow" | "orange"; type: GuardianAlertType };
     recentAlertsThisWeek: GuardianAlert[];
     now: Date;
   }): { dispatch: boolean; reason: string };
   ```

   Enforces max 2 ORANGE/week per guardian-patient pair. Yellow doesn't push, just appears in daily summary.

4. **`guardian-alert-explainer.ts`**

   ```typescript
   export function buildAlertContent(input: {
     signals: SilentGuardianSignal[];
     patientName: string;
     language: "hi" | "en" | "hi-en";
   }): { title: string; summary: string; explanation: string; suggestedAction: string };
   ```

   **CRITICAL:** never include verbatim chat content. Template-only. Tested for PII leakage with property test (random patient inputs → output never contains the input verbatim beyond `{{patientName}}`).

5. **`guardian-multi-patient-sort.ts`**
   ```typescript
   export function sortPatientsByUrgency(input: {
     patients: {
       id: string;
       latestAlertSeverity: "safe" | "yellow" | "orange";
       alertAgeMin: number;
     }[];
   }): string[]; // patient ids in display order
   ```

### C.3 Service flow

`apps/server/src/modules/silent-guardian/`:

- `silent-guardian.service.ts` — fans out signal detectors, persists SilentGuardianSignal, aggregates daily, fires GuardianAlert when threshold + dedup pass.
- `silent-guardian.controller.ts` — GET /api/v1/guardian/alerts?patient_id=&type=, POST /api/v1/guardian/alerts/:id/read, GET /api/v1/guardian/daily-summary/:patient_id, POST /api/v1/guardian/alerts/:id/feedback (helpful?).
- `silent-guardian.routes.ts`, `silent-guardian.validation.ts`, `silent-guardian.types.ts`.

**Phase 2 alerts endpoint deferral closed here** (per audit-progress.md line 78).

### C.4 BullMQ queues to add

- `SILENT_GUARDIAN_ANALYZE` — runs daily 6PM per active patient (in patient's pinned timezone). Reads last 7d data → invokes signal scorers → persists signals → aggregator → conditional GuardianAlert.
- `GUARDIAN_ALERT_DISPATCH` — fires on GuardianAlert.create. Push (primary) → SMS (fallback if push fails) via existing `expo-push.ts` + `msg91-sms.ts`. **Reuses critical-bypass channel ordering** but with non-critical priority.
- Modify existing `DAILY_GUARDIAN_SUMMARY` (already in queue list) — extend payload to include silent-guardian yellow signals.

### C.5 PostHog events

- `silent_guardian_signal_detected{source, type, contribution}`
- `silent_guardian_alert_created{severity, type, signal_count}`
- `silent_guardian_alert_dispatched{severity, push_success, sms_success}`
- `silent_guardian_alert_read{minutes_to_read}`
- `silent_guardian_alert_feedback{helpful, action_taken}`
- `silent_guardian_dedup_suppressed{reason}` (alert fatigue protection)

### C.6 Sentry capture

- Signal scorer throws → capture with signal source as tag.
- Alert dispatch all-channels-failed → capture as error.
- "Verbatim chat content detected in alert content" property-test failure in prod → impossible by construction but capture if reached.

### C.7 Test factories

- `silent-guardian-signal.factory.ts`
- `guardian-alert.factory.ts`

### C.8 Tests

- Domain-logic unit tests for each of the 5 new pure functions.
- Property test on `buildAlertContent`: 1000 random patient name + signal inputs → output explanation never contains raw evidence JSON values verbatim.
- Integration `apps/server/tests/integration/silent-guardian.test.ts`:
  - 7d med non-adherence → orange alert fires + push enqueued.
  - 2nd orange same week → dispatched. 3rd → suppressed.
  - Yellow doesn't push.
  - Read endpoint marks `readAt`.
  - Multi-patient sort orders by urgency.
  - Daily summary aggregates yellow signals.

### C.9 Coverage

- Silent-guardian module: 90%+.
- Domain-logic guardian-\* files: 95%+.

### C.10 Rollback

- `silent_guardian_enabled=false` halts signal compute.
- `silent_guardian_alerts_dispatch=false` halts delivery but allows compute (shadow mode).
- Migration is additive; reverse migration per `docs/runbooks/rollback.md` if needed.

### C.11 Mobile work (5 components)

- `GuardianDashboard` (multi-patient sorted view, reuses Phase 2 read-only dashboard)
- `AlertCard` (yellow/orange variants)
- `AlertDetailScreen` (explanation + suggested action + helpful/not-helpful feedback)
- `AlertHistoryList`
- Update notification handler to deep-link push → AlertDetailScreen

---

## Feature D — SOS (scaffold week 12, launch gated)

**Hard gate:** SOS launch only after 4+ weeks Phase 2 production stability. We scaffold and test in week 12, ship behind `sos_enabled=false` + `sos_test_mode=true`. Promotion to enabled is a separate ops change after stability proven.

### D.1 Schema

```prisma
model SOSEvent {
  id                String          @id @default(uuid())
  clientUuid        String          @unique  // idempotency from mobile
  userId            String
  user              User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  triggeredAt       DateTime        @default(now())
  triggerSource     SOSTriggerSource  // patient_manual | critical_bypass_escalation | guardian_initiated
  locationLat       Float?
  locationLng       Float?
  locationAccuracyM Int?
  lastReadings      Json            // snapshot at trigger time
  contactsNotified  Json            // [{contact_id, push_sent, push_delivered, sms_sent, sms_delivered, ivr_called, ivr_answered}]
  escalationStage   SOSEscalationStage @default(stage_0_fullscreen)
  cancelledAt       DateTime?
  cancelledBy       String?         // patient | guardian
  resolvedAt        DateTime?
  resolvedBy        String?
  falseAlarm        Boolean         @default(false)
  testMode          Boolean         @default(false)  // true = no real calls

  @@index([userId, triggeredAt(sort: Desc)])
  @@index([resolvedAt])
}

enum SOSTriggerSource {
  patient_manual
  critical_bypass_escalation
  guardian_initiated
}

enum SOSEscalationStage {
  stage_0_fullscreen      // 0s
  stage_1_auto_dial       // 60s if no response
  stage_2_ivr_call        // 5min if no contact response
  stage_3_all_contacts    // fallback
  resolved
}
```

Migration: `20260601000000_sos_events/migration.sql`.

### D.2 Pure domain-logic additions

1. **`sos-escalation-state-machine.ts`**

   ```typescript
   export type SOSStage =
     | "stage_0_fullscreen"
     | "stage_1_auto_dial"
     | "stage_2_ivr_call"
     | "stage_3_all_contacts"
     | "resolved";
   export interface SOSStateInput {
     currentStage: SOSStage;
     elapsedSecondsSinceTrigger: number;
     patientTappedScreen: boolean;
     anyContactAnsweredCall: boolean;
     cancelled: boolean;
     resolved: boolean;
   }
   export function nextSOSStage(input: SOSStateInput): SOSStage;
   ```

   Pure state machine. **100% branch coverage required (safety-critical).**

2. **`sos-contact-resolver.ts`**

   ```typescript
   export function selectContactForStage(input: {
     stage: SOSStage;
     contacts: EmergencyContact[]; // sorted by priority
     alreadyAttempted: string[]; // contact ids
   }): EmergencyContact | null;
   ```

3. **`sos-message-builder.ts`** — SMS/IVR message content. Hindi-first, language-aware, no jargon.

### D.3 Files to create

- `apps/server/src/modules/sos/sos.controller.ts`
- `apps/server/src/modules/sos/sos.service.ts`
- `apps/server/src/modules/sos/sos.routes.ts` (POST /trigger, /cancel, /resolve)
- `apps/server/src/modules/sos/sos.validation.ts`
- `apps/server/src/modules/sos/sos.types.ts`
- `apps/server/src/workers/sos-escalation.processor.ts` (pure, testable)
- `apps/server/src/workers/sos-escalation.worker.ts` (binds processor to queue)
- `apps/server/src/shared/calls/twilio-voice.ts` — Twilio Programmable Voice wrapper for IVR (stage_2). **No-op when `TWILIO_ACCOUNT_SID` not set or `sos_test_mode=true`.**

### D.4 BullMQ queues

- `SOS_ESCALATION` — **HIGHEST PRIORITY** in queue config. Repeated job with 30s tick, exits when state machine reaches `resolved`. Reuses `requestId` propagation.
- `SOS_NOTIFY_CONTACT` — per-contact push/SMS. **Highest priority.** Failed → Sentry.

### D.5 Env vars

Add to `apps/server/src/config/env.ts`:

- `TWILIO_ACCOUNT_SID` (optional)
- `TWILIO_AUTH_TOKEN` (optional)
- `TWILIO_FROM_NUMBER` (optional E.164)
- `SOS_AUTO_DIAL_DELAY_SECONDS` (default 60)
- `SOS_IVR_DELAY_SECONDS` (default 300)

### D.6 PostHog events

- `sos_triggered{source, location_accuracy, contacts_count}`
- `sos_stage_transition{from, to, elapsed_seconds}`
- `sos_contact_attempted{contact_priority, channel, success}`
- `sos_cancelled{stage, by, elapsed_seconds}`
- `sos_resolved{by, elapsed_seconds, false_alarm}`
- `sos_test_mode_run` (audit trail for staging tests)

### D.7 Test factories

- `sos-event.factory.ts`
- `emergency-contact.factory.ts` (verify exists)

### D.8 Tests

- Unit `packages/domain-logic/tests/sos-escalation.test.ts`:
  - All 5 stage transitions × all input combinations (24+ cases).
  - 100% branch coverage **locked in `vitest.config.ts`** (like critical-bypass).
  - Property test: `nextSOSStage` is monotonic — never regresses to earlier stage except via cancel/resolve.
- `sos-contact-resolver.test.ts`: priority ordering, exhausted list returns null.
- Integration `sos.test.ts`:
  - POST /trigger creates SOSEvent + enqueues escalation in test mode.
  - Cancel before stage_1 stops escalation.
  - Idempotent re-POST with same clientUuid returns same SOSEvent.
  - `sos_enabled=false` → endpoint returns 503.
  - `sos_test_mode=true` → no real Twilio call, but log says "would have called".

### D.9 Coverage

- `sos-escalation-state-machine.ts`: **100% branches** (locked).
- `sos.service.ts`: 90%+.
- `twilio-voice.ts`: 70%+ (external wrapper).

### D.10 Rollback

- `sos_enabled=false` immediately disables endpoint.
- `sos_test_mode=true` flips real calls off without disabling escalation engine.
- Twilio outage: circuit-break IVR step, escalate to SMS-all-contacts (stage_3).
- Migration is additive; revert per runbook section 2 if needed.

### D.11 Mobile work (5 components)

- `SOSButton` (always visible on home, 48dp+, long-press confirm to avoid accidental)
- `SOSConfirmationScreen` (3s delay, count down, cancel button)
- `SOSActiveFullscreen` (stage 0 UI — can't dismiss for 30s, big call button)
- `SOSDialIntegration` (native dialer auto-open at stage_1 with any-tap cancel)
- `SOSAfterActionCard` (post-resolve: false alarm? helpful? note for guardian)

---

## Cross-cutting work

### CC.1 Claude API wrapper (`apps/server/src/shared/ai/claude.ts`)

- Use `@anthropic-ai/sdk` directly. Prompt caching on the system prompt block + most-recent-7d reading context block.
- Two model env-driven IDs (haiku / sonnet) — keeps Phase 4 migration clean.
- Token usage returned in response and persisted on ChatMessage for cost dashboards (Phase 4 work).
- Circuit breaker uses ioredis-backed counter (`ai_circuit:${env.NODE_ENV}`) so multi-process workers share state.
- Wrapper exports: `generateResponse(input): Promise<ClaudeResponse>`. Internally handles cache, retry, timeout, circuit, breadcrumb.
- **No PII** sent to Claude in system prompt beyond what's necessary; reading values OK but never patient phone/aadhaar. PII redaction utility from existing Pino logger reused. **TS-enforced** via `PatientContext` type that refuses raw User rows.

### CC.2 Idempotency consolidation

Promote the `clientUuid + version` pattern in `readings.service.ts:60-90` to a reusable helper:

- `apps/server/src/shared/idempotency.ts` exporting `checkIdempotent<T>(prismaModel, clientUuid, incomingVersion): Promise<{ kind: 'replay' | 'update' | 'insert' | 'stale', existing?: T }>`.
- Refactor readings service to use it (small refactor, covered by existing integration tests).
- Use across ChatMessage + SOSEvent endpoints.

### CC.3 Mobile session and reading context fetch

Extend dashboard cache strategy (existing in dashboard module, 15min TTL) to expose a "chat context" view that the chat service can hit in <50ms — cache hit avoids cold DB read per chat message.

### CC.4 Observability per CLAUDE.md

- Logger `requestId` propagation already covers BullMQ workers — extend to Claude wrapper.
- Sentry breadcrumbs on Claude wrapper, signal scorer, SOS escalation transitions.
- PostHog event additions listed per-feature above.

### CC.5 Documentation updates (in same PRs)

- `docs/HOWTO.md` — add: "How to add a new signal source", "How to enable AI chat for a cohort", "How to run an SOS dry-run in staging", "How to interpret cost tiers in PostHog".
- `docs/ARCHITECTURE.md` — add Phase 3 sections: AI chat data flow + safety filter, Silent Guardian dataflow, SOS escalation state machine diagram.
- `docs/runbooks/rollback.md` — add: "SOS rollback playbook", "Chat safety filter false-positive flood handling".
- `audit-progress.md` — log each merged PR with the same per-session entry format Phase 2 used.

### CC.6 New `.claude/` skills (worth adding for this phase)

- `.claude/skills/phase3-ai-safety-patterns.md` — codifies: how to write a safe Claude prompt, where Post-Response Filter must run, what to log to Sentry vs PostHog, redaction expectations.
- `.claude/skills/silent-guardian-patterns.md` — signal sourcing, decay math, dedup rules, alert content templates.
- `.claude/skills/phase3-rollback-playbook.md` — feature-by-feature kill switch order during an alert storm.

### CC.7 Phase 3 traceability & discoverability (so a future on-call finds code in 60 seconds)

The single biggest pain when a feature breaks is "where does this code live across N branches/PRs?" Phase 3 hard-codes the answer.

1. **Folder isolation:** every Phase 3 feature is in **one folder** — `modules/chat/`, `modules/silent-guardian/`, `modules/sos/`. No Phase 3 logic leaks into existing module folders **except**: `modules/insights/insights.service.ts` (detector wiring) and `modules/readings/readings.service.ts` (idempotency helper refactor). These two exceptions are called out in the PR description with the line `Phase 3 cross-module touch: <reason>`.

2. **Pure-function side** mirrors: `packages/domain-logic/src/chat-*.ts`, `guardian-*.ts`, `sos-*.ts`, `detectors/cross-condition.ts`, `detectors/correlation-meal.ts`. Searching `git grep "Phase 3"` or `git grep "guardian-"` always lands the right place.

3. **Conventional Commits — scoped per feature:**
   - `feat(chat): ...`, `fix(chat): ...`
   - `feat(silent-guardian): ...`, `fix(silent-guardian): ...`
   - `feat(sos): ...`, `fix(sos): ...`
   - `feat(detectors): ...` (cross-condition + correlation)
   - `chore(phase3): ...` (cross-cutting infra: idempotency helper, Claude wrapper, flags)

   `git log --oneline --grep "(chat)"` finds every chat-related commit across branches.

4. **PR labels (GitHub):** every Phase 3 PR carries `phase-3` + one of `chat`, `silent-guardian`, `sos`, `detectors`, `infra`. `gh pr list --label phase-3` is the master list. Configure via `.github/labeler.yml` glob rules (e.g. `modules/chat/**` → label `chat`).

5. **Branch naming:** `phase3/<feature>/<short-desc>` — e.g. `phase3/chat/safety-filter`, `phase3/sos/state-machine`. Lints in pre-push hook (extend existing `scripts/preflight.sh`).

6. **CODEOWNERS:** add to `.github/CODEOWNERS`:

   ```
   /apps/server/src/modules/chat/                          @phase3-chat-team
   /apps/server/src/modules/silent-guardian/               @phase3-guardian-team
   /apps/server/src/modules/sos/                           @phase3-sos-team
   /packages/domain-logic/src/chat-*.ts                    @phase3-chat-team
   /packages/domain-logic/src/guardian-*.ts                @phase3-guardian-team
   /packages/domain-logic/src/sos-*.ts                     @phase3-sos-team
   /packages/domain-logic/src/detectors/cross-condition.ts @phase3-detector-team
   ```

   On-call hits the file path, immediately knows who to page.

7. **Git tags at each merged feature:**
   - `phase3-chat-v1` (week 9 merge)
   - `phase3-detectors-cross-condition-v1` (week 10)
   - `phase3-silent-guardian-v1` (week 11)
   - `phase3-sos-scaffold-v1` (week 12 — scaffold only)
   - `phase3-sos-launched-v1` (when gate met)

   Bisecting "what broke since Phase 3 chat shipped?" → `git log phase3-chat-v1..HEAD -- modules/chat`.

8. **Live index file:** this `phase3.md` itself has the **Files index** section below. On every merge, `audit-progress.md` gets a new dated entry with the same per-session format Phase 2 used. The two together form the discovery surface — `grep -l "Phase 3" docs/ audit-progress.md phase3.md` lands everything.

9. **Issue template:** add `.github/ISSUE_TEMPLATE/phase3-bug.md` with required dropdown for `feature_area: chat | silent-guardian | sos | detectors | cross-cutting`. Auto-labels the issue.

10. **PR template addition:** extend `.github/pull_request_template.md` with a "Phase 3 checklist" subsection (always visible) covering: kill switch flag added? safety filter coverage 100%? idempotency replay tested? rollback runbook section linked?

11. **In-code marker (sparingly):** the **entry file** of each feature gets a single header comment, e.g. top of `apps/server/src/modules/chat/chat.routes.ts`:
    ```typescript
    /**
     * Phase 3 — AI Chat
     * Kill switch flag: ai_chat_enabled
     * Rollback runbook: docs/runbooks/rollback.md#chat
     * Owner: @phase3-chat-team
     */
    ```
    Three or four such files total — not noise, but enough that opening one file orients you in seconds.

### CC.8 Use of every audit-era system + agent + skill

This phase **must visibly leverage** what the production audit shipped. Below is the audit-to-Phase-3 mapping — each item has a concrete invocation point, not just a mention.

**Audit infrastructure reused (no rewrites):**

| System                                                                                          | Phase 3 use                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | -------- | --------------------------- |
| Pino logger (`shared/logger.ts`) with PII redaction                                             | Every chat / silent-guardian / sos service log call. Extend redaction schema with `chat_content` tag for Sentry breadcrumbs.                                                                                                             |
| Sentry (`shared/observability/sentry.ts`)                                                       | Wrapped around Claude API failures, safety-filter rejections, alert-dispatch all-channels-failed, SOS escalation transitions. Tags: `phase=3, feature=chat                                                                               | sg    | sos`.    |
| PostHog (`shared/analytics/posthog.ts`)                                                         | All Phase 3 events (15+ listed per feature) emitted through existing client. No new analytics infrastructure.                                                                                                                            |
| Flag service (`shared/flags/flags.ts`)                                                          | 8 flags listed at top of plan — added on-demand at first merge that needs them. Audit log inherits the 100-entry per-key retention.                                                                                                      |
| Idempotency pattern (`readings.service.ts` lines 60–90)                                         | Promoted to `shared/idempotency.ts`, then reused for ChatMessage + SOSEvent. Single source of truth.                                                                                                                                     |
| Critical-bypass processor split pattern (`workers/critical-alert.processor.ts` + `.worker.ts`)  | SOS escalation follows the same pure-processor + thin-worker split — `sos-escalation.processor.ts` (testable) + `sos-escalation.worker.ts` (queue binding).                                                                              |
| BullMQ queue config (`shared/queue.ts`)                                                         | New queues added with same retry policy (3 retries, exp 5s backoff, 1h success / 24h failure retention). SOS queues marked highest priority.                                                                                             |
| Validation middleware (`shared/validate.ts`)                                                    | All Phase 3 routes use existing `validateBody` / `validateQuery` with Zod. No new validation framework.                                                                                                                                  |
| Admin auth (`shared/middleware/admin-auth.ts`)                                                  | Gates `/admin/flags` writes for Phase 3 kill-switches. Constant-time bearer check unchanged.                                                                                                                                             |
| Error handler (`shared/middleware/error-handler.ts`)                                            | All Phase 3 thrown `DomainError`s caught here. Envelope `{success:false,error:{code,message}}` reused with new codes: `CHAT_DISABLED`, `CHAT_RATE_LIMITED`, `CHAT_SAFETY_REJECTED`, `SG_DISABLED`, `SOS_DISABLED`, `SOS_ALREADY_ACTIVE`. |
| `requestId` middleware (`shared/middleware/request-id.ts`)                                      | Propagated into Claude wrapper, BullMQ payloads, Sentry breadcrumbs, PostHog event metadata — end-to-end tracing across the new async paths.                                                                                             |
| Expo push (`shared/notifications/expo-push.ts`)                                                 | Reused for GuardianAlert dispatch + SOS contact notification. No new push wrapper.                                                                                                                                                       |
| MSG91 SMS (`shared/notifications/msg91-sms.ts`)                                                 | Fallback channel for GuardianAlert + SOS. Existing flow-based templates extended with new flow IDs.                                                                                                                                      |
| Coverage ratchets in `vitest.config.ts`                                                         | Per-file thresholds added for new domain-logic files; `chat-safety-filter.ts` and `sos-escalation-state-machine.ts` locked at 100% branches like `critical-bypass.ts`.                                                                   |
| Domain-logic purity (tsconfig path blocks + CI grep)                                            | All new chat-_, guardian-_, sos-* files in `packages/domain-logic/src/` MUST stay pure. Existing CI job catches `import.*prisma                                                                                                          | fetch | Date.now | Math.random` automatically. |
| Pre-push `preflight.sh`                                                                         | No change needed — picks up new tests, new lint, new build automatically. Phase 3 PRs run through it unchanged.                                                                                                                          |
| Shared CI scripts (`check-prisma-format.sh`, `check-migration-parity.sh`, `lint-migrations.sh`) | Cover the 3 new Phase 3 migrations automatically. No new CI plumbing.                                                                                                                                                                    |
| CodeQL / Trivy / eslint-plugin-security / SBOM / Scorecard                                      | Cover Phase 3 code automatically. Claude wrapper especially benefits from CodeQL on input-handling.                                                                                                                                      |
| Maintenance-mode middleware (audit SETUP.md P3 — TODO)                                          | **Phase 3 is the first feature that needs it**, for the SOS migration apply (stop-writes path per rollback runbook §2). Building it is a Phase 3 prerequisite — added to week 9 prep tasks.                                              |
| Scaffolds (`pnpm new-module`, `new-detector`, `new-migration`)                                  | Used to create `chat`, `silent-guardian`, `sos` module skeletons and cross-condition / correlation detector skeletons. Cuts boilerplate; ensures convention.                                                                             |
| Testcontainers integration setup                                                                | All Phase 3 integration tests added to existing harness — Postgres + Redis spun once per run, Phase 3 models seeded via new factories.                                                                                                   |
| `audit-progress.md` log convention                                                              | Every Phase 3 PR merge appends a dated entry in the same format Phase 2 used. Becomes the historical trail when on-call asks "when did chat ship?"                                                                                       |
| Docs trinity (`ARCHITECTURE.md`, `SETUP.md`, `HOWTO.md`)                                        | Updated per CC.5 — Phase 3 sections added, not new top-level docs.                                                                                                                                                                       |
| Rollback runbook (`docs/runbooks/rollback.md`)                                                  | Extended per feature (chat rollback playbook, SOS rollback playbook). Reuses the 5 patterns already documented.                                                                                                                          |

**`.claude/` agents — invocation rules:**

| Agent                       | Invoked at                                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `safety-reviewer`           | **EVERY** Phase 3 PR (chat, silent-guardian, sos). Scans for critical-bypass immutability, AI chat safety filter coverage, SOS gate. Block merge if any flag.                              |
| `domain-logic-reviewer`     | Every PR touching `packages/domain-logic/`. Enforces purity, time-as-parameter, empty-input safety, coverage threshold. All new chat-_, guardian-_, sos-\* files go through this.          |
| `db-reviewer`               | The 3 Phase 3 migration PRs (chat_messages, silent_guardian, sos_events). Validates TimescaleDB safety, reversibility, indexes, PITR assumptions.                                          |
| `mobile-ux-reviewer`        | Every mobile PR landing the 5-stub components per feature. Validates 48dp targets, font sizes, tap counts, offline states, fail-safe UI. SOS button accidental-tap protection caught here. |
| `build-validator`           | Final pass before merging any Phase 3 PR — full local CI mirror (typecheck, lint, purity, vitest, build) zero-tolerance. Equivalent to `/verify` skill as an agent.                        |
| `feature-dev:code-reviewer` | Independent second-opinion review on chat + sos PRs (highest-risk Phase 3 surfaces).                                                                                                       |
| `code-simplifier`           | Run on each feature after first integration pass — catches duplication between new modules and existing readings / family modules.                                                         |
| `Explore`                   | When investigating Phase 3 incidents — locates code fast (amplified by CC.7 traceability layer).                                                                                           |
| `Plan`                      | Used per-feature before kicking off implementation (chat plan, SG plan, SOS plan refined separately).                                                                                      |

**`.claude/` skills — invocation timing:**

| Skill                                   | When                                                                                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plan`                                  | Per-feature breakdown before each week starts.                                                                                                                                  |
| `new-module`                            | Once for each of: `modules/chat/`, `modules/silent-guardian/`, `modules/sos/`.                                                                                                  |
| `new-detector`                          | Once for cross-condition, once for correlation refinements.                                                                                                                     |
| `voice-test`                            | Cross-check that Phase 1 voice fixtures still pass if chat module shares any language helper (regression guard).                                                                |
| `verify`                                | Local quality gate before every push — typecheck, lint, purity, tests, build. Zero tolerance.                                                                                   |
| `ship`                                  | After `verify` passes — commit + push + PR open with the Phase 3 checklist (kill switch + idempotency + rollback line items).                                                   |
| `review` / `code-review:code-review`    | Apply to each Phase 3 PR before merge.                                                                                                                                          |
| `security-review`                       | Apply to chat + sos PRs (highest blast radius). Extra pass beyond standard review.                                                                                              |
| `claude-md-management:revise-claude-md` | Once at end of Phase 3 — record learnings (Claude prompt-cache key strategy that worked, Silent Guardian decay curve calibration) back into CLAUDE.md so Phase 4 inherits them. |

**Net effect:** zero net-new infrastructure beyond the four features themselves. The audit's investment is fully exercised, the agent/skill kit is treated as a release-gate checklist, and no Phase 3 PR merges without `safety-reviewer` + `domain-logic-reviewer` + `db-reviewer` (when migration) + `build-validator` clean.

### CC.9 Direct cross-reference to `audit-progress.md`

Phase 3 explicitly inherits these audit decisions:

- **Item 9 (`dangerfile.ts`)** — the only outstanding `[ ]` from the original audit roadmap. **Phase 3 absorbs this**: the same PR that lands the first feature (chat) adds `dangerfile.ts` with the three rules already specified (test-parity for `packages/domain-logic/src/**`, migration-parity for schema changes, large-PR explainer > 500 LoC). Phase 3 will produce many large PRs; dangerfile pays for itself immediately.
- **Audit line 47 (Deferred — `[P3]`)**: _"AI chat post-response safety filter test suite. SOS escalation chain integration test."_ — both are explicit deliverables here (Feature A.8 chat-safety-filter 30+ adversarial cases + Feature D.8 sos-escalation-state-machine 100% branches + integration cases). **Audit's open Phase 3 ticket closes when these two land.**
- **Audit line 53**: _"Flag keys — detector toggles, AI chat kill switch, SOS test mode — are added to the flag service from item 13 whenever the need is real, not on a phase schedule."_ — this plan adds 8 flag keys exactly that way: at the merge of the first feature that needs each one.
- **Items 17 + 18 stay DEFERRED** — no second repo yet, so no reusable-package or reusable-workflow extraction in Phase 3.
- **Phase 2 deferred deliverables (audit lines 44–46)** — Detox mobile E2E, BP endpoint integration tests at higher coverage, Dashboard Hindi copy review — stay Phase 2 cleanup. Phase 3 does NOT block on them, but Phase 3 mobile components MUST not regress Phase 2 mobile coverage (build-validator gate enforces).
- **PR #38 (FamilyLink) + PR #39 (CI hardening) merged into `main` as of 2026-05-16.** Phase 3 starts from current `main` head. No outstanding migration debt.

### CC.10 Robustness _without_ GHAS (GitHub Advanced Security)

The audit shipped two security tiers: **portable code-level robustness** and **GitHub-platform tooling**. Phase 3's safety guarantees rest entirely on the portable tier. If GHAS / GitHub Actions disappeared tomorrow, the plan still holds.

| Capability                                                                                     | Where it actually lives                                           | Survives off-GHAS?                                               | Phase 3 dependency                                                                 |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `eslint-plugin-security` (eval, ReDoS, timing attack, weak RNG, child_process injection, bidi) | Local `eslint.config.*` rule subset                               | ✅ Yes — runs on any CI or `pnpm lint`                           | Chat wrapper especially benefits; runs at every dev save.                          |
| Domain-logic purity (tsconfig path block + grep)                                               | `packages/domain-logic/tsconfig.json` + `scripts/check-purity.sh` | ✅ Yes — pure Node + bash                                        | All 14 new domain-logic files enforced.                                            |
| Per-file coverage ratchets                                                                     | `vitest.config.ts` thresholds                                     | ✅ Yes — runs in any CI                                          | `chat-safety-filter`, `sos-escalation-state-machine` locked at 100%.               |
| Critical-bypass split (`processor.ts` + `worker.ts`)                                           | Code pattern                                                      | ✅ Yes                                                           | SOS escalation mirrors it.                                                         |
| Sentry observability                                                                           | Runtime SDK; DSN-driven                                           | ✅ Yes — vendor-neutral                                          | All Phase 3 modules use it.                                                        |
| PostHog analytics                                                                              | Runtime SDK                                                       | ✅ Yes — vendor-neutral                                          | All Phase 3 events.                                                                |
| Pino logging + PII redaction                                                                   | Runtime                                                           | ✅ Yes                                                           | All Phase 3 logs.                                                                  |
| Flag service (Redis + cache + pubsub)                                                          | Application code                                                  | ✅ Yes                                                           | 8 Phase 3 kill switches.                                                           |
| Idempotency helper                                                                             | Application code                                                  | ✅ Yes                                                           | Chat + SOS dedup.                                                                  |
| Testcontainers integration                                                                     | Docker daemon + Node                                              | ✅ Yes — any CI                                                  | All Phase 3 integration suites.                                                    |
| Squawk migration linter                                                                        | CLI binary + shared script `lint-migrations.sh`                   | ✅ Yes — any CI                                                  | 3 Phase 3 migrations linted.                                                       |
| `check-prisma-format.sh` + `check-migration-parity.sh` (via `prisma migrate diff`)             | Shared shell scripts                                              | ✅ Yes                                                           | All Phase 3 schema changes.                                                        |
| `preflight.sh` pre-push hook                                                                   | Local bash                                                        | ✅ Yes — git-native                                              | Catches Phase 3 issues before push.                                                |
| Scaffold scripts                                                                               | Local bash                                                        | ✅ Yes                                                           | Used 5+ times in Phase 3.                                                          |
| Trivy image scan                                                                               | Trivy CLI inside image-smoke                                      | ✅ Yes — CLI is portable; only the GHA action is GitHub-specific | Phase 3 Docker image still scanned in any CI.                                      |
| Rollback runbook patterns                                                                      | `docs/runbooks/rollback.md`                                       | ✅ Yes — process doc                                             | Every Phase 3 feature has a rollback entry.                                        |
| Claude reviewer agents (`.claude/agents/*.md`)                                                 | Claude-driven, not GitHub-driven                                  | ✅ Yes                                                           | Run on every Phase 3 PR locally or in CI.                                          |
| `.claude/` skills (`verify`, `ship`, `new-module`)                                             | Local                                                             | ✅ Yes                                                           | Phase 3 workflow.                                                                  |
| **CodeQL SAST**                                                                                | GHA workflow                                                      | ❌ GitHub-specific                                               | **Plan does not depend on it.** Alternative: Semgrep CLI (portable).               |
| **GitHub `dependency-review`**                                                                 | GHA workflow                                                      | ❌ GitHub-specific                                               | **Plan does not depend on it.** Alternative: `osv-scanner` (Google, portable CLI). |
| **Dependabot**                                                                                 | GitHub native                                                     | ❌ GitHub-specific                                               | Alternative: Renovate (self-hostable).                                             |
| **OpenSSF Scorecard, SBOM Syft workflows**                                                     | GHA workflows; output is informational                            | ❌ Workflow GitHub-specific; Syft CLI is portable                | Plan does not depend on them.                                                      |

**Conclusion:** every _PR-blocking gate_ in Phase 3 (typecheck, lint, eslint-security, vitest, purity, squawk, Docker smoke, integration tests, the four agent reviewers, and the local `verify` skill) runs equally well outside GHAS. GHAS-specific items are _informational or replaceable_ and do not appear in the Phase 3 critical path. **Plan stays robust if GHAS goes away.** Evaluating Semgrep + osv-scanner + Renovate as portable equivalents is a future audit cycle item (P4+), not Phase 3.

### CC.11 Edge interactions that span features

These don't belong to any single feature but matter at integration time:

1. **SOS × Critical-Bypass interaction:** Critical-bypass (already shipped) fires fullscreen + push + SMS when glucose <65/>315. SOS fullscreen is similar. If both fire simultaneously, mobile must show only ONE fullscreen (SOS wins — explicit superordinate flag in mobile state). Server-side: SOS trigger from `critical_bypass_escalation` source means `SOSEvent.triggerSource` captures the link to the originating bypass row. **No double SMS** — SOS notification path checks for active critical-bypass within last 5min and re-uses the same dispatch ticket id.

2. **Silent Guardian × Critical-Bypass dedup:** if a critical-bypass already alerted the guardian within the past 30min, suppress any med_adherence orange alert that would otherwise fire for the same patient-guardian pair (alert fatigue protection). Recorded in `GuardianAlert.signalIds` for traceability.

3. **Daily SILENT_GUARDIAN_ANALYZE batching:** running once per active patient per day at 6PM user-TZ could fan out to thousands of jobs at the same UTC moment. Use BullMQ rate-limit (`limiter: { max: 50, duration: 1000 }`) + scatter by hash of userId into the 6-7PM window.

4. **PII redaction in Claude prompts:** the system prompt + reading context block must NEVER include patient phone, aadhaar, household_id, or guardian names. The `apps/server/src/shared/ai/claude.ts` wrapper accepts a `PatientContext` type that has only safe fields (anonymized id, age range, condition list, reading values). Compile-time enforced via TS — the wrapper signature refuses raw User row.

5. **DPDP / data retention compliance (India):** ChatMessage stores user content. Retention: `archivedAt` set at 90 days, hard-delete at 1 year. Add cron `CHAT_RETENTION_SWEEP` weekly. Right-to-be-forgotten: extend existing user-delete cascade (already wired via `onDelete: Cascade` on ChatSession → ChatMessage).

6. **Claude API spend cap:** per-day org-wide spend ceiling tracked in Redis (`ai_spend:${YYYY-MM-DD}`). When estimated cumulative spend (token-usage × model rate) exceeds env `CLAUDE_DAILY_SPEND_CAP_USD`, automatically flip `ai_chat_tier3_enabled=false` via flag service and Sentry-page on-call. Tier 1/2 still flow.

7. **WhatsApp Business API as alert channel** (deferred but called out): For guardian alerts, push is primary, SMS is fallback. WhatsApp as an additional channel is Phase 4. Silent Guardian's `AlertChannel` enum is forward-compatible.

8. **Time-zone correctness for daily crons:** `SILENT_GUARDIAN_ANALYZE` 6PM trigger uses the **patient's pinned onboarding timezone** (same rule as streak boundary). Worker queries by user, computes their local time, schedules per-user.

9. **Backup verification before Phase 3 migrations:** `pg_dump --schema-only` snapshot + verification before each Phase 3 migration apply, per rollback runbook section 2's destructive-migration guidance.

10. **Mobile cache for chat:** local store of last 50 ChatMessages per session so app open after offline period shows history. Match Phase 1 offline pattern. **Chat is online-only for new sends** but reads work offline.

---

## Section M — Mobile (full UI design)

> Replaces the 5-bullet stubs in A.11 / B.8 / C.11 / D.11. Server-first sequencing still applies: every screen below ships behind the same kill-switch flag the server uses; nothing renders until the flag is enabled for the cohort.
>
> Stack: Expo + React Native (existing). Navigation: React Navigation (existing app shell). Local store: WatermelonDB for cached reads (existing offline pattern from Phase 1). Sentry ErrorBoundary already wraps the root layout (audit item 11). Theme tokens live in `apps/mobile/src/theme/` (extend, don't fork).

### M.0 Cross-cutting mobile rules (apply to every Phase 3 screen)

- **Hindi-first.** All copy in Hindi (Devanagari) with English fallback shown smaller below for code-mixed users. Copy lives in `apps/mobile/src/i18n/phase3/{chat,silent-guardian,sos}.{hi,en}.json`.
- **48dp minimum touch target.** Every interactive element. `mobile-ux-reviewer` agent blocks PR otherwise.
- **Min font sizes** (CLAUDE.md): body 14px, important 16px, numbers 20px+. Large text toggle (1.3×) honored — use existing `useResponsiveFontSize()` hook.
- **High contrast** (WCAG AAA) toggle honored on all new screens.
- **No infinite spinners.** 10s timeout → show retry + cached state. Existing `<LoadingWithTimeout maxMs={10000}>` reused.
- **Haptic on every consequential tap** (save, send, confirm, cancel). `expo-haptics` already wired.
- **Active profile chip** rendered in header on every Phase 3 screen via existing `<ActiveProfileChip />` from Phase 1.
- **Sentry ErrorBoundary** catches per-screen render errors → Hindi recovery copy (existing).
- **PostHog screen events** auto-fired on focus via existing `useScreenAnalytics(name)` hook.
- **Coverage target:** 70%+ per CLAUDE.md mobile floor. SOS screens locked at 90%+ (safety-critical UI).

### M.1 Chat (Feature A)

**Navigation:** new stack `ChatStack` under root tab `More → Chat`. Routes: `ChatList` (sessions) → `ChatThread` (messages) → `ChatFlagDialog` (modal). Deep link: `swasthparivar://chat/:sessionId`.

**Screen layout — `ChatThread`:**

```
┌──────────────────────────────────┐
│ ← Chat       👤 Ramesh ji   ⋯    │  ← header (48dp back, profile chip)
├──────────────────────────────────┤
│ ⚠ AI hai — doctor nahi.          │  ← persistent disclaimer banner
│   Dawai ke baare mein doctor      │     (dismissable per session, returns
│   se poochein.                    │      next session). 14px, amber bg.
├──────────────────────────────────┤
│  ┌──────────────────────────┐    │
│  │ Aapki sugar 145 kal thodi│    │  ← assistant bubble (left, gray bg)
│  │ zyada thi. Aaj kya khaya?│    │     20px content, 14px tier badge
│  └──────────────────────────┘    │     [🚩] flag button always rendered,
│  cached • 1.2s            [🚩]   │     bottom-right, 48dp
│                                  │
│              ┌──────────────────┐│  ← user bubble (right, brand bg)
│              │ Roti aur sabzi.  ││
│              └──────────────────┘│
│              just now            │
│                                  │
│  ┌── typing… ─────┐               │  ← assistant typing indicator
│  └────────────────┘               │     auto-dismisses after 12s timeout
├──────────────────────────────────┤
│ [+] [ Type karein… ]      [Send] │  ← input bar, Send 48dp, [+] = voice
└──────────────────────────────────┘  ← rate-limit toast when daily limit hit
```

**Component tree:**
- `ChatThreadScreen` (route)
  - `ChatHeader { sessionId, profileName }`
  - `AIDisclaimerBanner { onDismiss }`
  - `MessageList { messages, onReachTop, onFlag }`
    - `MessageBubble { message, role, tier, flagged, onFlag }`
      - `FlagButton { onPress }` — always rendered on assistant bubbles
      - `CostTierBadge { tier }` — dev-menu flag only
    - `TypingIndicator { visible }`
    - `EmergencyBanner { criticalReading }` — shown if user has active critical-bypass
  - `ChatInputBar { onSend, disabled, dailyRemaining }`
    - `VoiceButton { onTranscribe }` — reuses Phase 1 voice infra
    - `SendButton { onPress, loading }`
  - `OfflineChatBanner { isOffline }` — full-width banner when offline
- `ChatFlagDialog` (modal) — reason picker (medical_advice / wrong_info / disrespectful / other) + free-text note.

**Prop signatures (`apps/mobile/src/screens/chat/types.ts`):**

```typescript
export interface MessageBubbleProps {
  message: { id: string; content: string; role: 'user' | 'assistant'; createdAt: string };
  tier?: 'template' | 'cached' | 'sonnet';
  flagged: boolean;
  flaggedByUser: boolean;
  onFlag: (messageId: string) => void;
  onLongPress?: (messageId: string) => void; // copy / share
}

export interface ChatInputBarProps {
  onSend: (text: string) => Promise<void>;
  disabled: boolean;
  dailyRemaining: number; // 0 → shows rate-limit message instead of input
  isOffline: boolean;      // disables send, shows "wait for online" hint
}

export interface EmergencyChatGuardProps {
  criticalBypassActive: boolean;
  onResolveCritical: () => void; // opens existing critical bypass screen
  children: React.ReactNode;
}
```

**Hindi copy variants (`i18n/phase3/chat.hi.json`):**
- Disclaimer: `"AI hai — doctor nahi. Dawai ke baare mein doctor se poochein."`
- Empty state: `"Koi sawaal hai? Sugar, BP, ya khaane ke baare mein poochein."` + 4 suggestion chips: "Aaj kya khaun?", "Sugar zyada kyun?", "Walk ka time", "Streak kaisi hai?"
- Rate-limit: `"Aaj 3 baar baat ho chuki — kal phir poochein 🙂"`
- Safety-rejected: existing CLAUDE.md string `"Yeh sawaal doctor se poochna best rahega."`
- Offline send: `"Internet aane par message bhej diya jayega."`
- Emergency skip: `"Pehle critical alert handle karein. Doctor ko abhi call karein."`
- Flag confirm: `"Aapne is message ko flag kiya. Hum review karenge. Dhanyavaad 🙏"`
- 12s typing timeout: `"AI thodi der le raha hai — phir try karein"` + retry button (resends via idempotent clientUuid → safe replay).

**Mobile state:**
- `chat.sessions: ChatSession[]`
- `chat.activeSessionId: string | null`
- `chat.messagesBySession: Record<string, ChatMessage[]>` (last 50 per session in WatermelonDB, lazy-load older on scroll-to-top)
- `chat.dailyRemaining: number` (refresh on focus + after send)
- `chat.sending: boolean`
- `chat.isOffline: boolean` (existing NetInfo listener)

**WatermelonDB schema additions (`apps/mobile/src/db/schema.ts`):**
- `chat_messages` mirroring server ChatMessage (client_uuid PK, last 50 per session, older pruned on app open).
- `chat_pending_sends` queue — drained on connectivity (same pattern as Phase 1 readings sync queue).

**RNTL test cases (`apps/mobile/__tests__/chat/`):**
- `ChatThread renders disclaimer banner on mount`
- `MessageBubble assistant variant renders flag button at 48dp`
- `MessageBubble user variant does NOT render flag button`
- `ChatInputBar disabled when dailyRemaining === 0 + shows Hindi rate-limit copy`
- `ChatInputBar disabled when isOffline=true + shows offline hint`
- `EmergencyChatGuard intercepts send when criticalBypassActive=true, calls onResolveCritical`
- `TypingIndicator auto-dismisses after 12s, shows retry button`
- `Flag button tap opens ChatFlagDialog modal`
- `Flag dialog submission emits PostHog event + persists locally`
- `Offline send queues message, drains on reconnect (mocked NetInfo)`
- `Idempotent retry: same clientUuid never produces duplicate row in WatermelonDB`
- `Tier badge hidden when dev-menu flag disabled`
- `Long-press on user bubble surfaces "Copy" / "Edit and resend"`

**New icons:** `flag-outline.svg`, `flag-filled.svg` (24dp), `chat-bubble-ai.svg`, `chat-bubble-user.svg`. Voice button reuses existing mic icon.

### M.2 Cross-condition + Correlation (Feature B)

**Zero new screens.** Reuses Phase 2 `<InsightCard />`. Verifications required:
- Cross-condition InsightEvent shape renders: title (Hindi-first), explanation paragraph, severity badge, evidence chips (e.g., `Sugar ↑ jab BP > 140`), suggested action.
- Existing "Acknowledge" + "Helpful?" buttons handle new InsightEvent rows unchanged.
- **RNTL regression test:** `<InsightCard patternType='cross_condition' />` renders explanation + suggested action; helpful=false emits `insight_feedback` PostHog event.
- If `cross_condition` triggers `severity_level=high`, verify existing token covers it; extend `theme/severity.ts` only if needed.

### M.3 Silent Guardian (Feature C — for guardians, not patients)

**Navigation:** guardian-only tab `Family` (existing from Phase 2) gains 3 new screens. Routes: `GuardianHome` → `AlertDetail` → `AlertHistory`. Push deep-link: `swasthparivar://guardian/alert/:alertId` → `AlertDetail`.

**Screen layout — `GuardianHome`:**

```
┌──────────────────────────────────┐
│ 👨‍👩‍👧 Mere parivar    [bell 2]    │  ← header, bell shows unread orange count
├──────────────────────────────────┤
│ ╔══════════════════════════════╗ │  ← urgent patient (orange) — top of list
│ ║ 🟠 Ramesh ji — Papa          ║ │     sorted by sortPatientsByUrgency()
│ ║                              ║ │
│ ║ Dawai chhoot rahi hai —      ║ │     summary line (template, no PII)
│ ║ 5 din mein 3 baar Metformin  ║ │
│ ║ skip ki.                     ║ │
│ ║                              ║ │
│ ║ [ Vistar mein dekhein → ]    ║ │     48dp CTA → AlertDetail
│ ╚══════════════════════════════╝ │
│                                  │
│ ┌──────────────────────────────┐ │  ← yellow / safe patients below
│ │ 🟡 Sushila ji — Maa           │ │     daily summary card, no push fired
│ │ Sugar thodi badh rahi hai.   │ │
│ │ Last 7 days: avg fasting 132 │ │
│ │ [ Aaj ka summary → ]         │ │
│ └──────────────────────────────┘ │
│                                  │
│ ┌──────────────────────────────┐ │  ← safe patient
│ │ ✅ Suresh ji — Bhai          │ │
│ │ Sab theek hai. 7-day streak. │ │
│ └──────────────────────────────┘ │
│                                  │
│         [ Alert history ]        │  ← bottom button → AlertHistory
└──────────────────────────────────┘
```

**Screen layout — `AlertDetail`:**

```
┌──────────────────────────────────┐
│ ← Alert        👨 Ramesh ji      │
├──────────────────────────────────┤
│ 🟠 Orange alert  •  2 ghante pehle│
│                                  │
│ Dawai chhoot rahi hai            │  ← title (24px, bold)
│                                  │
│ ──── Kya hua? ────                │
│ Pichhle 5 dino mein Ramesh ji ne │  ← explanation paragraph
│ Metformin teen baar skip ki —    │     template-only, no verbatim
│ 14 May, 15 May aur aaj subah.    │
│                                  │
│ ──── Kya karein? ────              │
│ • Phone karein                   │  ← suggested actions
│ • Yaad dilaayein dawai ka time   │
│ • Achanak band na karne dein     │
│                                  │
│ ┌────────────────────────────┐   │
│ │  📞 Ramesh ji ko call karen│   │  ← 48dp tappable, opens dialer
│ └────────────────────────────┘   │
│                                  │
│ ──── Kya yeh helpful tha? ────     │  ← feedback row
│ [ 👍 Haan, helpful ]              │
│ [ 👎 Nahi, theek nahi tha ]       │
│ [ ✅ Maine action liya ]          │
└──────────────────────────────────┘
```

**Prop signatures:**

```typescript
export interface AlertCardProps {
  alert: {
    id: string;
    patientName: string;
    severity: 'yellow' | 'orange';
    title: string;
    summary: string;
    createdAt: string;
  };
  onPress: (alertId: string) => void;
}

export interface GuardianHomeProps {
  patients: PatientSummary[];     // already sorted by urgency from server
  unreadOrangeCount: number;
  isLoading: boolean;             // 10s ceiling
  onRefresh: () => Promise<void>; // pull-to-refresh
}

export interface AlertDetailProps {
  alertId: string;
  onCallPatient: (phone: string) => void; // expo-linking dialer
  onFeedback: (kind: 'helpful' | 'not_helpful' | 'action_taken') => void;
}
```

**Hindi copy variants (`i18n/phase3/silent-guardian.hi.json`):**
- Orange title med-adherence: `"Dawai chhoot rahi hai"`
- Orange title trend: `"Sugar badhne ka pattern dikh raha hai"`
- Yellow daily summary: `"Aaj ka haal: thoda dhyaan dein"`
- Suggested action med: `["Phone karein", "Yaad dilaayein dawai ka time", "Achanak band na karne dein"]`
- Suggested action trend: `["Pichhle hafte ki readings dekhein", "Doctor se appointment lein", "Khaane mein meetha kam karein bolein"]`
- Helpful toast: `"Dhanyavaad 🙏 Aapka feedback hume behtar banata hai."`

**RNTL test cases:**
- `GuardianHome sorts patients by urgency (orange first)`
- `AlertCard yellow variant renders summary, does NOT show CTA button`
- `AlertCard orange variant renders CTA button at 48dp`
- `AlertDetail renders explanation + 3 suggested actions`
- `AlertDetail call button opens dialer with patient phone`
- `Feedback button tap emits PostHog event + persists locally`
- `Pull-to-refresh fires server fetch + updates list`
- `Loading state caps at 10s, shows cached + stale-warning afterward`
- `Deep link from push → AlertDetail with correct alertId`
- `Read-receipt PATCH fires on AlertDetail focus`

### M.4 SOS (Feature D — safety-critical mobile, 90%+ coverage)

**Navigation:** `SOSButton` rendered on home screen header (always visible, top-right, 48dp+). New stack `SOSStack`: `SOSButton` → `SOSConfirmation` → `SOSActive` → `SOSAfterAction`.
- **No back gesture / hardware back on `SOSActive`** — must use Cancel or auto-resolve.
- Profile switcher **locked** entire SOS flow (mirror of Edge Case #9 voice lock). Existing `<ProfileSwitcher locked={sosActive} />` prop.

**Screen layout — `SOSConfirmation` (3-second arming, per Edge Case #4):**

```
┌──────────────────────────────────┐
│ ⚠️ SOS bhejne wale hain?         │
├──────────────────────────────────┤
│        ┌──────────────┐          │
│        │      3       │          │  ← countdown 3 → 2 → 1 (1s each)
│        └──────────────┘          │
│        seconds mein bhejega      │
│                                  │
│  Yeh aapke parivar ko emergency  │
│  call bheja ja raha hai.         │
│                                  │
│  👤 Ramesh ji ke liye             │  ← active profile (always shown)
│                                  │
│  ┌────────────────────────────┐  │
│  │     RUKEIN — galat tha     │  │  ← 48dp cancel, full-width
│  └────────────────────────────┘  │
│                                  │
│  Confirm button activates after  │  ← confirm disabled 0-3s,
│  3 seconds                       │     enabled after countdown
└──────────────────────────────────┘
```

**Screen layout — `SOSActive` (cannot dismiss 30s, stage 0 fullscreen):**

```
┌──────────────────────────────────┐
│ 🚨 SOS BHEJ DIYA — MADAD AA RAHI │  ← red full-bleed bg
├──────────────────────────────────┤
│   Aapke parivar ko call ja       │
│   raha hai. Ek minute mein       │  ← stage 0 message
│   automatic call lag jayegi.     │
│                                  │
│  Contacts notified:              │
│   ✓ Suresh ji (push bheja)       │  ← per-contact status, live updates
│   ⏳ Sushila ji (SMS jaa raha)    │     polled every 5s from server
│   ⏳ Pankaj ji (intezaar)         │
│                                  │
│  ┌────────────────────────────┐  │
│  │  📞 ABHI CALL KAREIN       │  │  ← 56dp big call button (above 48dp
│  │     Suresh ji ko           │  │     minimum, safety-critical)
│  └────────────────────────────┘  │
│                                  │
│  Stage: 0 / Auto-dial: 47s baad  │  ← countdown to stage_1
│                                  │
│         [ Yeh galti thi ]         │  ← false-alarm cancel, smaller
│        (disabled for 30s)        │     enabled after 30s per CLAUDE.md
└──────────────────────────────────┘
```

**Stage 1 (60s):** native dialer auto-opens to priority_1 contact. ANY screen tap (back to app) cancels auto-dial → moves SOS to "patient handling, escalation paused". (Edge Case #1.) Visual: full-screen overlay "Calling Suresh ji…" + cancel.

**Stage 2 (5min, no contact answered):** server `SOS_NOTIFY_CONTACT` → Twilio IVR. Mobile shows "Madad bheji ja rahi hai — please wait" + cancel.

**Stage 3 (fallback):** server SMS-blasts all contacts; mobile shows full contact list with tap-to-call buttons (each 48dp).

**`SOSAfterAction` (resolved):**

```
┌──────────────────────────────────┐
│ ✅ SOS solve ho gayi              │
├──────────────────────────────────┤
│  Madad mil gayi.                 │
│                                  │
│  ── Aap kaise ho? ──               │
│  [ ✅ Theek hoon ]                │
│  [ ⚠️ Doctor ke paas ja raha ]    │
│                                  │
│  ── Kya yeh false alarm tha? ──    │
│  [ Haan, galti se daba ]          │  ← marks falseAlarm=true → tunes
│  [ Nahi, real emergency tha ]     │     accidental-tap stats
│                                  │
│  ── Guardian ko message? ──        │
│  [ Optional Hindi text input ]   │
│                                  │
│  [ Save karein ]                  │
└──────────────────────────────────┘
```

**Prop signatures:**

```typescript
export interface SOSButtonProps {
  onLongPress: () => void;        // navigates to SOSConfirmation
  disabled?: boolean;             // disabled if sos_enabled flag off
}

export interface SOSConfirmationProps {
  countdownSeconds: 3;            // hardcoded
  onConfirm: () => Promise<void>; // calls server POST /sos/trigger
  onCancel: () => void;
  activeProfileName: string;
}

export interface SOSActiveProps {
  sosEventId: string;
  stage: 'stage_0_fullscreen' | 'stage_1_auto_dial' | 'stage_2_ivr_call' | 'stage_3_all_contacts';
  elapsedSeconds: number;         // ticks from server-sent triggeredAt
  contacts: ContactStatus[];      // polled every 5s
  onCallContact: (contactId: string) => void;
  onCancel: () => void;
  cancelEnabledAfterSeconds: 30;
}
```

**Hindi copy variants (`i18n/phase3/sos.hi.json`):**
- Button label: `"🚨 Madad"` (red, 56dp, top-right header)
- Long-press hint (first time): `"Lambi der dabaayein madad ke liye"`
- Stage 0 headline: `"SOS bhej diya — madad aa rahi hai"`
- Stage 1 headline: `"Suresh ji ko call ja raha hai…"`
- Stage 2 headline: `"Madad bheji ja rahi hai — please wait"`
- Stage 3 headline: `"Sab contacts ko message bheja"`
- Cancel locked (0-30s): `"Yeh galti thi (30s baad available)"`
- Cancel unlocked: `"Yeh galti thi"`
- After-action: `"Madad mil gayi. Aap kaise ho?"`

**RNTL test cases (90%+ coverage required):**
- `SOSButton requires long-press (700ms+), single tap does NOT navigate`
- `SOSConfirmation countdown ticks 3 → 2 → 1, confirm button disabled until 0`
- `SOSConfirmation cancel returns to home immediately`
- `SOSActive cancel button disabled first 30s`
- `SOSActive shows correct stage based on elapsedSeconds prop`
- `SOSActive call button opens dialer with priority_1 contact`
- `SOSActive does NOT respond to hardware back button` (Android)
- `SOSActive intercepts gesture-back swipe` (iOS)
- `Profile switcher locked entire SOS flow (existing Profile component receives locked=true)`
- `Stage transitions: 0 → 1 at 60s, 1 → 2 at 300s, server-driven`
- `Auto-dial cancellation: any tap during stage_1 dial cancels and shows "paused"`
- `SOSAfterAction falseAlarm=true posts to server + clears local state`
- `Concurrent with critical-bypass: SOS fullscreen renders, critical-bypass fullscreen suppressed (mobile-state superordinate flag)`
- `Test mode: sos_test_mode=true skips real dialer, shows "TEST MODE — no real call" banner`

**Mobile state:**
- `sos.activeEvent: SOSEvent | null` — null = no active SOS
- `sos.stage`, `sos.elapsedSeconds` — polled from server every 5s while active
- `sos.contacts: ContactStatus[]`
- `sos.testMode: boolean`
- WatermelonDB persists SOSEvent locally so app re-open mid-SOS resumes the screen.

### M.5 Cross-cutting mobile infrastructure additions

1. **WatermelonDB schema migration** — bump version, add tables: `chat_messages`, `chat_pending_sends`, `chat_sessions`, `guardian_alerts` (local cache), `sos_events`. Migration script at `apps/mobile/src/db/migrations/v4-phase3.ts`.

2. **Push notification handlers** (`apps/mobile/src/services/push-handlers.ts`) — extend with:
   - `guardian_alert` payload → deep-link `/guardian/alert/:id` → `AlertDetail`.
   - `sos_trigger_relay` (guardian receives) → opens guardian dashboard with SOS event highlighted (no separate screen — surfaces in `GuardianHome`).
   - `chat_safety_review_complete` (rare, when human-reviewed flagged message resolved) → toast only.

3. **Theme tokens** (`apps/mobile/src/theme/severity.ts`) — extend with:
   - `severity.orange.{bg,fg,border}` (Silent Guardian orange)
   - `severity.red.*` (already exists for critical-bypass, reuse on SOS active screen)
   - `severity.yellow.*` (already exists)
   - Verify all pass WCAG AAA contrast at large text (4.5:1 normal, 3:1 large).

4. **Iconography** — required new SVG assets (24dp + 36dp + 56dp):
   - `flag-outline`, `flag-filled` (chat 🚩)
   - `sos-button`, `phone-priority`, `alert-orange`, `alert-yellow`, `alert-safe`
   - `chat-bubble-ai`, `chat-bubble-user` (decorative)
   - Place in `apps/mobile/src/assets/icons/phase3/`. Track in Figma asset table.

5. **Existing voice infrastructure reuse** — `ChatInputBar` voice button hands off to existing voice parser (Phase 1) but routes transcript to chat send, not glucose log. Voice's profile-lock semantics already match what chat needs.

6. **Sentry mobile** — add error tags `feature=chat|silent-guardian|sos` in `apps/mobile/src/services/sentry.ts` `setTags` per route focus. Existing `<ErrorBoundary />` covers per-screen render errors.

7. **Performance budget** — each Phase 3 screen must render initial frame in < 200ms on a Redmi Note 9 reference device. Measured via existing `measurePerf()` test util added during audit.

8. **EAS build profiles** — no changes; existing `development` / `preview` / `production` profiles cover Phase 3 OTA rollout per feature flag.

### M.6 Figma / design asset checklist

| Screen | Figma frame ref | Asset count | Done? |
|---|---|---|---|
| ChatThread (4 states: empty, conversation, rate-limited, offline) | `Phase3/Chat/ChatThread` | 4 | ⬜ |
| ChatFlagDialog (modal) | `Phase3/Chat/Flag` | 1 | ⬜ |
| GuardianHome (3 states: all safe, mixed, all orange) | `Phase3/SG/Home` | 3 | ⬜ |
| AlertDetail (yellow + orange + after-feedback) | `Phase3/SG/Detail` | 3 | ⬜ |
| AlertHistory | `Phase3/SG/History` | 1 | ⬜ |
| SOSButton placement (home header) | `Phase3/SOS/Button` | 1 | ⬜ |
| SOSConfirmation (3s countdown) | `Phase3/SOS/Confirm` | 1 | ⬜ |
| SOSActive (stage 0/1/2/3 — 4 variants) | `Phase3/SOS/Active` | 4 | ⬜ |
| SOSAfterAction (resolved + false-alarm) | `Phase3/SOS/After` | 2 | ⬜ |
| Severity color tokens documentation | `Phase3/Tokens` | 1 | ⬜ |

Use `.claude/skills/figma:figma-implement-design` once frames are finalised — already available in this repo. The `mobile-ux-reviewer` agent reviews each implemented screen against its Figma frame.

### M.7 Mobile rollout sequence (mirrors server flag flips)

| Week | Mobile work | Server flag state |
|---|---|---|
| 9  | Chat screens built behind dev-menu toggle | `ai_chat_enabled=false` for all |
| 9  | OTA to internal cohort (10 users) | `ai_chat_enabled=true` for cohort |
| 10 | Cross-condition InsightCard regression test only | `cross_condition_detector_enabled=true` for cohort |
| 11 | GuardianHome / AlertDetail / AlertHistory built | `silent_guardian_enabled=true` for cohort; alerts dispatch off until shadow-mode validated |
| 11 | Silent Guardian alerts dispatch turned on | `silent_guardian_alerts_dispatch=true` |
| 12 | SOS screens built but rendered only if `sos_enabled=true` AND `sos_test_mode=true` | scaffold, no real dialer |
| Post-Phase-3 | SOS launch after 4-week stability gate | `sos_test_mode=false` then `sos_enabled=true` ramp |

---

## Risk register

| #   | Risk                                                                                                 | Mitigation                                                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Claude API outage during launch                                                                      | Circuit breaker → Tier 1 template fallback. Kill switch `ai_chat_enabled=false`.                                                                                                                          |
| 2   | Safety filter false positive ("kam karein" generic encouragement flagged as dose-change)             | 30+ adversarial test cases at launch. Sentry alert if filter rejection rate > 5%. Easy override via patch (filter is pure function).                                                                      |
| 3   | Safety filter false negative (dosage advice leaks)                                                   | 100% branch coverage. "🚩 Flag" button on every message — user-reported flag triggers Sentry. Weekly audit of `flagged=true` rows.                                                                        |
| 4   | Tier 3 cost runaway (model usage spike)                                                              | Per-user daily cap (env `CHAT_DAILY_FREE_LIMIT=3`). Tier-3 flag separate kill switch. PostHog dashboard for cost-tier distribution.                                                                       |
| 5   | Silent Guardian false orange alert fatigues guardians                                                | Hard cap 2 orange/week. Yellow stays in daily summary. Helpful/not-helpful feedback captured per alert; dashboard tracks helpful% per signal type.                                                        |
| 6   | Cross-condition detector triggers on coincidence (low N)                                             | Min 30 days + min 10 paired observations + p<0.05 + ≥70% confidence threshold. Returns null otherwise — never noise.                                                                                      |
| 7   | SOS launched before 4-week Phase 2 stability gate                                                    | `sos_enabled=false` default. Promotion is explicit ops change documented in runbook. Code review checklist item.                                                                                          |
| 8   | Twilio IVR setup blocker delays SOS week 12                                                          | Schema + state machine + push/SMS path land regardless. IVR is stage_2 only — earlier stages still function without Twilio.                                                                               |
| 9   | Verbatim chat content leaked to guardian                                                             | `buildAlertContent` is template-only. Property test forbids verbatim. Sentry capture if pattern detected.                                                                                                 |
| 10  | Existing Phase 2 detectors regress on cross-condition schema additions                               | Cross-condition only ADDS to detector list; doesn't modify existing detectors. Existing integration tests must still pass (CI gate).                                                                      |
| 11  | Phase 3 code "buried" across many branches — on-call can't find it during an incident                | CC.7 traceability layer: scoped commits + PR labels + CODEOWNERS + git tags + folder isolation + entry-file headers.                                                                                      |
| 12  | SOS and Critical-Bypass fire simultaneously, double-alerting guardian                                | CC.11 §1+§2: SOS supersedes critical-bypass fullscreen on mobile; server reuses the same dispatch ticket within 5min window; Silent Guardian alerts suppressed when critical-bypass active in last 30min. |
| 13  | Claude API spend spike (prompt injection asking for long output, etc.)                               | CC.11 §6: per-day org spend cap in Redis; auto-disable Tier 3 when threshold hit; Sentry page on-call. Hard 12s per-request timeout already in wrapper.                                                   |
| 14  | DPDP / data-protection audit asks "where is user chat content stored, for how long, who has access?" | CC.11 §5: ChatMessage soft-delete at 90d, hard-delete at 1y, cascade on user delete, weekly retention sweep cron. Documented in `docs/ARCHITECTURE.md`.                                                   |
| 15  | Daily `SILENT_GUARDIAN_ANALYZE` fan-out crushes DB at 6PM UTC                                        | CC.11 §3: BullMQ rate-limiter + scatter-by-userId-hash + per-user TZ scheduling. Load-tested in staging before flag-on.                                                                                   |
| 16  | SOS button accidentally tapped by elderly user (false alarms cluster + alert fatigue for guardian)   | M.4: long-press to arm (700ms+), 3s countdown screen, 30s in-stage cooldown before false-alarm cancel. `SOSAfterAction` captures `falseAlarm=true` to tune. Edge Case #4 double-confirm pattern.          |
| 17  | Mobile WatermelonDB schema migration corrupts existing Phase 1/2 data on first Phase 3 install       | M.5 §1: schema bumps go through existing migration test harness; new tables are additive only, no Phase 1/2 column changes. Rollback: ship a no-op patch that downgrades schema version.                  |
| 18  | Push deep-link to AlertDetail or chat opens stale data because mobile cache is older than server     | M.3 + M.1: deep-link target fetches latest from server on focus; 10s timeout falls back to cached data + stale-warning banner (existing `<LoadingWithTimeout>` pattern).                                  |
| 19  | Guardian dashboard renders patient PII or verbatim chat content via accidental backend leak          | Server `buildAlertContent` is template-only (property-tested). Mobile `AlertDetail` displays only `explanation` + `suggestedAction` fields; never renders raw `evidence` JSON. RNTL snapshot test guards. |

---

## Completeness check (self-audit against CLAUDE.md Phase 3 + Edge Cases #1–#22)

- ✅ ChatMessage model with idempotency key, safety violation storage, cost-tier label, language column.
- ✅ AI Chat Safety Filter — pure function, 100% branches, 30+ adversarial cases, `"Yeh sawaal doctor se poochna best rahega."` replacement.
- ✅ 3-tier cost model (template ~60% / cached ~20% / sonnet ~20%) with cost router.
- ✅ Cold start handling (day 1–14 education fallback) — never dead-ends.
- ✅ "🚩 Flag" button on every AI message + user-flag endpoint.
- ✅ Emergency check: skip chat when critical bypass active.
- ✅ Cross-condition detector (t-test, p<0.05, min 30 days, ≥70% confidence).
- ✅ Correlation detector (meal category, 7-day calendar window, min 5 same-type instances).
- ✅ SilentGuardianSignal with med_adherence + data_anomaly only (Phase 3 scope per CLAUDE.md).
- ✅ GuardianAlert with explanation + suggested_action, never just score, never verbatim chat (property-tested).
- ✅ Alert fatigue: max 2 ORANGE/week + 7-day exponential decay.
- ✅ Multi-patient guardian sort.
- ✅ SOSEvent with idempotency, escalation state machine, 100% branch coverage locked.
- ✅ SOS escalation chain 0s/60s/5min as per Edge Case #1.
- ✅ SOS gated on 4+ weeks Phase 2 stability — `sos_enabled=false` default.
- ✅ Critical bypass thresholds untouched (<65/>315 hardcoded).
- ✅ Idempotency via clientUuid+version reused (Edge Case #13).
- ✅ Push primary / SMS fallback (Edge Case #14) reused for guardian alerts.
- ✅ Notification fatigue / variant pool (Edge Case #15, #21) — Silent Guardian uses dedup + content variants.
- ✅ Festive tag suppression (Edge Case #16) — correlation detector excludes festive-tagged readings per CLAUDE.md.
- ✅ Time anomaly detection (Edge Case #18) already exists Phase 1 — chat reuses server-received timestamps when flagged.
- ✅ Offline / data-loss perception (Edge Case #19) — chat is online-only for sends but reads cached locally (CC.11 §10).
- ✅ Phase 3 traceability + code discoverability (CC.7) — addresses code-finding concern.
- ✅ PostHog event shapes match CLAUDE.md Edge Case #22 additions.
- ✅ Rollback runbook updates per feature.
- ✅ Coverage targets set per file.
- ✅ Verification plan covers local + staging + production launch.

**Deliberately deferred (NOT Phase 3):**

- WhatsApp Business API as guardian alert channel → Phase 4.
- Doctor / appointment / prescription OCR → Phase 4 (CLAUDE.md).
- Regional languages, festival nudging, wearable integration → Phase 4+ (CLAUDE.md).
- chat_sentiment / schedule_miss / activity_drop / cross_signal silent-guardian sources → Phase 4.
- ORANGE > 80 (RED-band) silent guardian severity → Phase 4 (enum room left).
- Razorpay / paid tier gating of chat limits → Phase 4 (CLAUDE.md).

**Open items needing team input:**

- CODEOWNERS GitHub team names (`@phase3-chat-team`, `@phase3-guardian-team`, `@phase3-sos-team`, `@phase3-detector-team`) — TBD by repo admin.
- Twilio account procurement + IVR flow Studio setup — lead time may push SOS week 12 work to week 13. Mitigation: stages 0–1 + 3 work without Twilio; stage_2 IVR is wrapper-only until Twilio ready.
- Internal cohort size for first chat enable — recommend 10 users initially, ramp doubling every 48h with PostHog dashboard checks.

---

## Verification plan

**Per-feature local verify** (`/verify` skill):

1. `pnpm typecheck` clean.
2. `pnpm lint` clean.
3. Domain-logic purity check (grep + tsconfig path block — already CI'd).
4. `pnpm test:unit` — all domain-logic tests green, coverage per-file ratchets enforced.
5. `pnpm test:integration` — Testcontainers spin up Postgres+Redis, all new integration suites green.
6. `pnpm build` — workspace-wide build clean.

**End-to-end smoke (manual, staging):**

- Seed patient + guardian. Set `ai_chat_enabled=true` via admin endpoint. POST chat message via curl → confirm response + ChatMessage row + PostHog event.
- Adversarial input: ask _"should I increase my Metformin dose?"_ → confirm filter rejects + flagged=true + Sentry breadcrumb.
- Manually create 7 consecutive missed med logs → run `SILENT_GUARDIAN_ANALYZE` worker → confirm orange GuardianAlert + push enqueued.
- Set `sos_enabled=true` + `sos_test_mode=true`. POST /sos/trigger. Confirm SOSEvent row + escalation worker enqueued + "would have called" log. Cancel mid-stage. Confirm `cancelledAt` set + escalation worker exits.
- Run `gh pr list` — confirm CI green on PR before merge.

**Production launch checklist (per feature):**

- [ ] Migration applied.
- [ ] Env vars set on host.
- [ ] Feature flag set to ON for internal cohort (10 users).
- [ ] PostHog dashboards monitoring key events.
- [ ] Sentry alert rules configured.
- [ ] On-call briefed; rollback runbook bookmarked.
- [ ] Mobile build with flag-gated UI deployed via OTA (Expo).
- [ ] 48h observation → ramp to 10% → 50% → 100%.

---

## Files index (Phase 3 will create or touch)

**Created (server):**

- `apps/server/src/shared/ai/claude.ts`
- `apps/server/src/shared/idempotency.ts`
- `apps/server/src/shared/calls/twilio-voice.ts`
- `apps/server/src/modules/chat/{controller,service,routes,validation,types,jobs,chat-flag.controller}.ts`
- `apps/server/src/modules/silent-guardian/{controller,service,routes,validation,types}.ts`
- `apps/server/src/modules/sos/{controller,service,routes,validation,types}.ts`
- `apps/server/src/workers/sos-escalation.{processor,worker}.ts`
- `apps/server/tests/integration/{chat,insights-cross-condition,silent-guardian,sos}.test.ts`
- `apps/server/prisma/migrations/{20260518_chat_messages,20260525_silent_guardian,20260601_sos_events}/migration.sql`

**Created (domain-logic):**

- `packages/domain-logic/src/chat-safety-filter.ts`
- `packages/domain-logic/src/chat-cost-router.ts`
- `packages/domain-logic/src/chat-cold-start.ts`
- `packages/domain-logic/src/chat-template-responses.ts`
- `packages/domain-logic/src/detectors/cross-condition.ts`
- `packages/domain-logic/src/detectors/correlation-meal.ts` (extends existing meal-correlation)
- `packages/domain-logic/src/guardian-signal-scorer.ts`
- `packages/domain-logic/src/guardian-signal-aggregator.ts`
- `packages/domain-logic/src/guardian-alert-deduper.ts`
- `packages/domain-logic/src/guardian-alert-explainer.ts`
- `packages/domain-logic/src/guardian-multi-patient-sort.ts`
- `packages/domain-logic/src/sos-escalation-state-machine.ts`
- `packages/domain-logic/src/sos-contact-resolver.ts`
- `packages/domain-logic/src/sos-message-builder.ts`
- Tests colocated as `*.test.ts` + property tests where noted.

**Created (test-factories):**

- `chat-session.factory.ts`, `chat-message.factory.ts`
- `silent-guardian-signal.factory.ts`, `guardian-alert.factory.ts`
- `sos-event.factory.ts`

**Created (mobile — Section M):**

- `apps/mobile/src/screens/chat/{ChatList,ChatThread,ChatFlagDialog}.tsx` + `types.ts`
- `apps/mobile/src/screens/chat/components/{MessageList,MessageBubble,FlagButton,AIDisclaimerBanner,ChatInputBar,VoiceButton,SendButton,TypingIndicator,EmergencyChatGuard,OfflineChatBanner,CostTierBadge}.tsx`
- `apps/mobile/src/screens/guardian/{GuardianHome,AlertDetail,AlertHistory}.tsx`
- `apps/mobile/src/screens/guardian/components/{AlertCard,PatientUrgencyCard,FeedbackRow}.tsx`
- `apps/mobile/src/screens/sos/{SOSButton,SOSConfirmation,SOSActive,SOSAfterAction}.tsx`
- `apps/mobile/src/screens/sos/components/{CountdownTimer,ContactStatusList,StageBanner,CancelButton}.tsx`
- `apps/mobile/src/services/push-handlers.ts` (extend, not create) — `guardian_alert` + `sos_trigger_relay` + `chat_safety_review_complete` payload types
- `apps/mobile/src/db/migrations/v4-phase3.ts` (WatermelonDB schema bump: `chat_messages`, `chat_pending_sends`, `chat_sessions`, `guardian_alerts`, `sos_events`)
- `apps/mobile/src/i18n/phase3/{chat,silent-guardian,sos}.{hi,en}.json`
- `apps/mobile/src/assets/icons/phase3/{flag-outline,flag-filled,sos-button,phone-priority,alert-orange,alert-yellow,alert-safe,chat-bubble-ai,chat-bubble-user}.svg`
- `apps/mobile/src/theme/severity.ts` (extend with orange tokens, verify red reuse)
- `apps/mobile/__tests__/chat/*.test.tsx`, `__tests__/guardian/*.test.tsx`, `__tests__/sos/*.test.tsx` (RNTL cases listed per feature)

**Modified:**

- `apps/server/prisma/schema.prisma` — new models + enums.
- `apps/server/src/config/env.ts` — Claude model overrides, Twilio, chat limits, SOS delays, spend cap.
- `apps/server/src/shared/queue.ts` — `CHAT_SAFETY_REVIEW`, `SILENT_GUARDIAN_ANALYZE`, `GUARDIAN_ALERT_DISPATCH`, `SOS_ESCALATION`, `SOS_NOTIFY_CONTACT`, `CHAT_RETENTION_SWEEP` queues + priorities.
- `apps/server/src/modules/insights/insights.service.ts` — wire cross-condition + correlation detectors.
- `apps/server/src/modules/readings/readings.service.ts` — refactor to use shared idempotency helper.
- `apps/server/src/index.ts` — register new routes + workers.

**Docs (updated, not new):**

- `docs/HOWTO.md`, `docs/ARCHITECTURE.md`, `docs/runbooks/rollback.md`, `audit-progress.md`.

**New `.claude/` artifacts (worth adding):**

- `.claude/skills/phase3-ai-safety-patterns.md`
- `.claude/skills/silent-guardian-patterns.md`
- `.claude/skills/phase3-rollback-playbook.md`

**New `.github/` artifacts (for CC.7 discoverability):**

- `.github/labeler.yml` (PR auto-labeler for `chat` / `silent-guardian` / `sos` / `detectors` / `infra`)
- `.github/CODEOWNERS` (Phase 3 folder ownership)
- `.github/ISSUE_TEMPLATE/phase3-bug.md` (with `feature_area` dropdown)
- `.github/pull_request_template.md` (extend with Phase 3 checklist subsection)
- `dangerfile.ts` (closes audit item 9 — three rules already specified by the audit)

---

## Progress log

Per-session entries in the format Phase 2 used in `audit-progress.md`. Newest first. Append on every merged PR (or, for in-flight branches, every meaningful milestone).

### 2026-05-19 — Week 9 server foundation: schema + domain logic + Claude wrapper

**Branch:** `phase3/chat/safety-and-routing-foundation` (off `main`, 4 commits, not yet merged — PR pending).

**Gates:** all 11 preflight gates green on every commit — typecheck (5 workspaces), lint (`max-warnings=0`), prettier `format:check`, prisma schema format, schema↔migration parity, squawk SQL lint (**0 issues** on the new migration), domain-logic purity (`scripts/check-domain-purity.mjs`), per-file coverage ratchets.

#### Commit 1 — `feat(chat): add ChatSession + ChatMessage schema (Phase 3 step A.1)` (`91a40b9`)

Implements **A.1**. Additive — no existing tables modified.

- Models: `ChatSession`, `ChatMessage`. Enums: `ChatRole`, `ChatCostTier`. Indexes cover the safety-review queue (`flagged, created_at`), per-session ordering, and the per-user feed.
- Migration: `apps/server/prisma/migrations/20260518000000_chat_messages/migration.sql`. Squawk-clean.
- Retention plumbing (`archived_at`, `onDelete: Cascade`) ready for the `CHAT_RETENTION_SWEEP` cron and the user-delete cascade — CC.11 §5.

#### Commit 2 — `feat(chat): add safety filter, cost router, cold-start, templates` (`ac1bd5b`)

Implements **A.2 #1–#4** (all four pure-domain chat modules) and the **shared chat type vocabulary**. Every module ships at **100% lines / branches / functions / statements** with per-file ratchets locked in `vitest.config.ts`.

- `packages/domain-logic/src/chat-safety-filter/` — Post-Response Safety Filter. 6 violation banks (`dosage_number`, `start_stop_directive`, `dose_change`, `diagnosis_claim`, `emergency_advice`, `verbatim_pii`) across English, Hinglish, Devanagari. **60 test cases**, including property tests over digit+medicine-unit and Hinglish count+noun adversarial input. Locked at **100% branches** in `vitest.config.ts` alongside `critical-bypass` — see **A.9**.
- `packages/domain-logic/src/chat-cost-router/` — `pickCostTier` priority chain (medication → cached → cold-start/sparse → deterministic-intent → reasoning). Implements **A.2 #2**. Includes a 100-request distribution sanity test that fails loudly if the chain drifts to >80% in any bucket.
- `packages/domain-logic/src/chat-cold-start/` — `coldStartResponse` day 1-14 stage buckets (1-3 / 4-6 / 7 / 8-14) × condition × language. Defers to `lookupTemplate` for data-independent intents so copy stays single-sourced. Implements **A.2 #3**.
- `packages/domain-logic/src/chat-template-responses/` — Tier 1 lookup table keyed `intent:condition:language`. `medication_question` pre-empts the table with `MEDICATION_REDIRECT`, pinned **equal** to `SAFETY_REPLACEMENT` so pre-routing redirect and post-response filter produce identical patient-facing copy. Implements **A.2 #4**.
- `packages/shared-types/src/chat.ts` — `ChatRole`, `ChatCostTier`, `ChatLanguage`, `ChatIntent`, `ChatCondition` unions. Mirrors the Prisma enums — keep in lockstep (migration linter fires on drift).

Coverage delta on `packages/domain-logic` aggregate: 95.91% → **96.10% statements**, 90.98% → **91.48% branches**. No regression on existing modules.

#### Commit 3 — `chore(phase3): extract clientUuid idempotency helper` (`929d633`)

Implements **CC.2** (cross-cutting). One of the two acknowledged "Phase 3 cross-module touches" called out in **CC.7 #1**.

- New helper: `apps/server/src/shared/idempotency.ts`. Discriminated outcome `{ kind: "insert" | "replay" | "update" | "stale" }`. P2002 race recovery stays at the call site because each model's composite key shape differs.
- `apps/server/src/modules/readings/readings.service.ts` refactored to use `checkIdempotent`. `buildReplayResult` unchanged.
- 6 unit tests pin every branch + an offline-retry regression case (`version 1` arriving after `version 2`).
- All **65 readings integration tests** still pass (49s) — confirms zero behaviour regression end-to-end.

#### Commit 4 — `feat(chat): add Claude API wrapper with circuit + spend cap` (`e9945e4`)

Implements **A.3** + **A.6** + **CC.1** + **CC.11 §4 §6**. The Claude wrapper.

- `apps/server/src/shared/ai/claude.ts` — wraps `@anthropic-ai/sdk`. The SDK handles 429/5xx retry+backoff out of the box (default `max_retries=2`); we do not reimplement.
- **12-second hard timeout** via `AbortController` (env `CHAT_HARD_TIMEOUT_MS`). Aborts → `CHAT_UPSTREAM_TIMEOUT`.
- **Prompt caching**: stable system prompt first, volatile `PatientContext` block second with `cache_control: { type: "ephemeral" }`. Layout follows the prefix-match invariant in the `claude-api` skill's `prompt-caching.md`.
- **Redis-backed circuit breaker**: keys `ai_circuit:fail_count:${NODE_ENV}` + `ai_circuit:open_until:${NODE_ENV}`. 5 consecutive failures in a 60s window open the breaker for 5 min; first success closes it. Throws `CHAT_CIRCUIT_OPEN` while open — caller falls back to Tier 1.
- **Daily spend cap** in Redis (`ai_spend:YYYY-MM-DD`, integer cents to avoid FP drift). Exceeding `CLAUDE_DAILY_SPEND_CAP_USD` auto-flips `ai_chat_tier3_enabled=false` via the flag service and pages Sentry. **CC.11 §6**. Pricing tracked inline for `claude-haiku-4-5` ($1.00 / $5.00 per 1M) and `claude-sonnet-4-6` ($3.00 / $15.00 per 1M) — re-verify against `shared/models.md` before bumping.
- **`PatientContext` PII guard** — the wrapper accepts a `PatientContext` interface only. The type system **forbids** passing a raw `User` row: `anonymizedId`, `ageRange` (coarsened), `conditions`, `recentReadings`, `language`, `condition`. Phone, aadhaar, household_id, guardian names cannot appear. **CC.11 §4**, compile-time enforced.
- New env vars (`apps/server/src/config/env.ts`): `CLAUDE_MODEL_HAIKU`, `CLAUDE_MODEL_SONNET`, `CHAT_DAILY_FREE_LIMIT`, `CHAT_HARD_TIMEOUT_MS`, `CLAUDE_DAILY_SPEND_CAP_USD` — defaults from **A.6**.
- New PostHog events (in `shared/analytics/posthog.ts` `EventPropsMap`): `ai_chat_response_generated`, `ai_chat_circuit_opened`, `ai_chat_spend_cap_reached`. Match the per-feature event list in **A.4 / CC.4**.
- New `ErrorCode` entries (in `packages/shared-types/src/api.ts`): `CHAT_DISABLED`, `CHAT_SAFETY_REJECTED`, `CHAT_CIRCUIT_OPEN`, `CHAT_UPSTREAM_TIMEOUT`, `CHAT_SPEND_CAP_REACHED`. Wired into the envelope per **CC.8** error-handler section.
- 18 unit tests cover: model selection (haiku/sonnet), `cache_control` placement, anonymized metadata, breaker open + auto-close, hard timeout abort, spend-cap flag flip, `DomainError` when `CLAUDE_API_KEY` unset.

#### Phase 3 CC.7 traceability — partial application

- ✅ **CC.7 #5** branch naming: `phase3/chat/safety-and-routing-foundation`.
- ✅ **CC.7 #3** scoped Conventional Commits: every commit on the branch uses `feat(chat)` or `chore(phase3)`.
- ✅ **CC.7 #1** folder isolation: all new code in `packages/domain-logic/src/chat-*`, `packages/shared-types/src/chat.ts`, `apps/server/src/shared/ai/`, `apps/server/src/shared/idempotency.ts`. One cross-module touch — `apps/server/src/modules/readings/readings.service.ts` (idempotency helper refactor) — called out in commit message per the rule.
- ⏳ **CC.7 #11** in-code marker header — currently lives on `apps/server/src/shared/ai/claude.ts` as the de-facto entry file. Will move/duplicate onto `modules/chat/chat.routes.ts` when that file lands in chunk 3c.
- ⏳ **CC.7 #4** PR labels + **#6** CODEOWNERS + **#9** issue template + **#10** PR template + **#7** git tag — deferred until the first Phase 3 PR opens (`phase3-chat-v1` tag will be applied at chunk 3c merge).

#### Audit-era reuse (CC.8)

Concretely exercised in this session: Pino logger PII redaction, Sentry breadcrumbs, PostHog client, flag service (for spend-cap auto-flip), the readings critical-bypass split pattern (referenced design), validation middleware (not yet touched — chunk 3c), `requestId` middleware (threaded through wrapper input), `vitest.config.ts` per-file coverage ratchets, domain-logic purity tsconfig path block + grep gate, pre-push `preflight.sh`, scaffold scripts (not yet — chunk 3c will use `pnpm new-module chat`), CodeQL/Trivy/eslint-plugin-security/SBOM (CI-side; will fire on the PR).

#### What's NOT yet in this branch (next chunk 3c)

- `apps/server/src/modules/chat/` — controller / service / routes / validation / types / jobs / chat-flag.controller.
- BullMQ queue `CHAT_SAFETY_REVIEW` + processor + worker (per **A.5**).
- Flag keys `ai_chat_enabled`, `ai_chat_tier3_enabled` (added at first use per the "no preemptive flag keys" rule).
- Route registration + middleware wiring in `apps/server/src/app.ts`.
- Integration tests: `apps/server/tests/integration/chat.test.ts` (per **A.8**) — Testcontainers Postgres + Redis, MSW-mocked Claude.
- Test factories: `packages/test-factories/src/chat-session.factory.ts`, `chat-message.factory.ts` (per **A.7**).
- Mobile work — Section **M.1** in its entirety. Server-first sequencing.

#### Gates passing

```
1/11 wipe build artefacts (dist + tsbuildinfo)
2/11 frozen pnpm install (matches CI exactly)
3/11 workspace typecheck (5 projects)
4/11 workspace lint (max-warnings=0)
5/11 prettier format:check
6/11 prisma schema format
7/11 schema ↔ migration parity (chat_messages migration paired)
8/11 migration lint (squawk) — Found 0 issues in 1 file 🎉
9/11 domain-logic purity (42 files scanned)
10/11 domain-logic test:coverage (per-file ratchets enforced)
11/11 — (with --with-docker / --with-integration when needed)
```

Aggregate domain-logic coverage after this session:

| Metric | Value |
|---|---|
| Statements | 96.10% (864/899) |
| Branches | 91.48% (494/540) |
| Functions | 96.89% (125/129) |
| Lines | 97.49% (740/759) |

Chat-module-specific (all four directories at 100%):

| Module | Stmts | Branches | Funcs | Lines |
|---|---|---|---|---|
| `chat-safety-filter` | 35/35 | 8/8 | 9/9 | 31/31 |
| `chat-cost-router` | — | — | — | — *(100% from HTML report)* |
| `chat-template-responses` | — | — | — | — *(100% from HTML report)* |
| `chat-cold-start` | — | — | — | — *(100% from HTML report)* |

