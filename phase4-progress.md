# Phase 4 — Live Progress Board

> **Companion to `phase4.md`** (the original spec). This file tracks what's done, what's in flight, and what's next. Update on every merged PR. The spec stays canonical for HOW things should be built.
>
> Last updated: **2026-06-13** (Feature G **server-complete** — chunk 4 reports/GENERATE_PDF landed: Puppeteer PDF + pure `buildReportModel` (100%-pinned, PII-stripped) + Claude exec-summary through the chat-safety filter with its own spend cap + `/reports/*` module; 18 report-builder unit + 16 reports integration tests green. Only mobile UI remains (deferred). Earlier 06-13: chunk 3 `APPOINTMENT_REMINDER` cron + `dueReminderWindows` (100%-pinned), 16 unit + 8 integration. Chunk 2 — `doctors` + `appointments` CRUD modules: household-authorised, `doctor_portal_enabled` kill-switch, reschedule resets reminder flags, `appointment_created` event, 17-case suite green. 2026-06-12 — Feature G chunk 1 schema: `DoctorProfile` + `DoctorAppointment` + `Report` models + `AppointmentStatus`/`ReportStatus` enums, migration `20260704000000_doctors`, and the F.1-deferred `prescriptions.doctor_id` FK tightened to `ON DELETE SET NULL`. 2026-06-12 earlier — Feature F audit close-out. Two gaps fixed: (1) missing F.12 PostHog event `prescription_need_clarification_item` — now emitted from both the `PRESCRIPTION_OCR` and `PRESCRIPTION_OCR_DELTA` processors with unit coverage; (2) the frequency > 6×/day safety gate was missing on the `/approve` path — it only ran on manual-add — now enforced there too, routed through the existing `needs_doctor` branch, with a new integration test (suite now 27 cases). One partial-gap documented under "Risks / known unknowns": the dosage > 99th-percentile half of the safety validator stays deferred pending a max-dose reference dataset. Prior context: F.5 routes + clarification/cross-check workers (#141→#143), F.6 server close-out (#145), F.11 HTTP integration suite (#146), F.13 mobile upload + approver UI (#147) all merged to main.)

---

## TL;DR — where we actually are

| Track | State | Next concrete action |
|---|---|---|
| **Carry-over from Phase 2, Phase 3, Admin** | ✅ Code-complete | None — see "operational close-out" below |
| **Phase 1 corrigendum: emergency contacts** | ✅ Server (#115) + onboarding priority-1 seed (both household-profile + FamilyLink-accept paths) + mobile Settings CRUD screen all landed (2026-06-03 follow-up session) | None — Phase 1 corrigendum closed |
| **Preferences backend persistence** | 🟡 Server + mobile wired (PR #125 open) | Merge #125; verify cross-device sync on a real install |
| **checkFrequency local reminders** | 🟡 Wired (PR #125 open) | Merge #125 |
| **Cold-start test users** | 🟡 Seed script live, 6 free-tier users at days 0/3/7/13/7/35 (PR #125 open) | Merge #125 |
| **Rate-limit alert UI** | 🟡 Glucose log surface shows prominent card on 429 (PR #125 open) | Merge #125 |
| **Brand assets** | 🟡 Real icon/splash/notification PNGs regenerated; fixes square-notification bug (PR #125 open) | Merge #125 → rebuild via EAS to ship to device |
| **Dark mode on log surfaces** | 🟡 Invisible-text bugs fixed on numpad / BP field chips / confirmation warnings (PR #125 open) | Merge #125 |
| **HbA1c response-shape type** | 🟡 Mobile type aligned to domain-logic source of truth (PR #125 open) | Merge #125; follow-up PR to promote `HbA1cEstimate` to `@swasth/shared-types` so this can't recur |
| **SOS ramp** | 🟡 Code-complete, needs operational soak | Provision vendor creds → 7-day test-mode soak → first drill → flag flips |
| **Push delivery hardening** | ✅ Diagnostic + auto-prune + per-user rate-limit keying landed (#113, #114, #112) | Verify the Expo token / projectId pairing in prod once #114 prunes the dead tokens |
| **UI polish + dark mode + new settings** | ✅ Antigravity rollup (#117-121) cleaned up + shippable in #118 | Visual click-through on Light/Dark/System across all screens before EAS build |
| **Feature E — Multi-condition health logs** | 🟡 In progress — schema + classifiers + server modules + multi-category dispatch + integration tests + trend detectors + ANALYZE_READING wiring + mobile log surfaces + voice parser + **mobile-voice integration** landed (2026-06-05 → 07); ActivityDaily/SleepLog + activity-aggregator + sleep-quality + cohort flag-ramp still pending | Cohort flag-ramp (`cardiac_logging_enabled` / `respiratory_logging_enabled`), Activity/Sleep schema for Feature I |
| **Feature E — Multi-condition health logs** | 🟡 In progress — schema + classifiers + server modules + multi-category dispatch + integration tests + trend detectors + ANALYZE_READING wiring + mobile log surfaces + **voice parser** landed (2026-06-05 → 06); ActivityDaily/SleepLog + activity-aggregator + sleep-quality + mobile-voice integration still pending. Cohort ramp runbook: `docs/runbooks/feature-e-cohort-ramp.md` | Mobile voice integration (wire `VoiceInput` to the new parsers), Activity/Sleep schema for Feature I, then operational cohort ramp per the runbook |
| **Feature F — Prescription OCR** | ✅ Code-complete — F.1–F.14 all landed: schema + 4 pure modules + Vision wrapper + 3 workers (`PRESCRIPTION_OCR`, `_DELTA`, `_CLARIFICATION_OCR`) + HTTP routes (`/upload` `/:id` `/photos` `/items` `/clarify` `/approve` `/reject`) + F.10b augmentation + mobile upload/approver/read-only screens + F.14 max-3-attempts → `needs_doctor` safety net. F.11 integration suite at 27 cases (#146 + 06-12 approve-path safety test). All F.12 PostHog events present. Safety validator: frequency > 6×/day gate enforced on both approve + manual-add; dosage-percentile half deferred (see Risks). | Operational ramp: `prescription_ocr_enabled` → 5 internal users for 7 days, eyeball 30 real prescriptions for RED/YELLOW/GREEN accuracy (Week 16 gate) |
| **Feature G — Doctor portal** | 🟢 Server-complete — G.1 schema + G.2 CRUD + G.3 reminder cron + G.4 reports/PDF (all 06-12→06-13). G.4: `reports` module (`/generate` 202 → `/:id/status` → `/:id/download` 302 signed R2), `GENERATE_PDF` worker (gathers 30d glucose/BP + HbA1c + adherence + top-3 insights → pure `buildReportModel` (100%-pinned, PII-stripped) → Puppeteer PDF → R2), Claude exec-summary through the **chat-safety filter** with its own spend cap (`CLAUDE_REPORT_DAILY_SPEND_CAP_USD` → auto-flips `report_generation_enabled`). PostHog `report_requested`/`report_generated`/`report_spend_cap_reached`. Tests: 12 HTTP+worker (PDF/R2/AI mocked) + 4 safety-filter (injected client). | **Mobile UI** (appointment + report screens) is the only remaining G work — deferred follow-up, bundles with the pending schedule-editor screen |
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

### Feature G (chunk 4) — reports + GENERATE_PDF (2026-06-13)

Final server chunk of phase4.md §G. Pre-visit PDF report generation with an AI executive summary. Mobile is the only remaining G work (deferred).

- **`packages/domain-logic/src/report-builder/`** — pure `buildReportModel(input)` → PII-stripped view model. Input type has NO slot for phone/household_id/DoB; the exact age is collapsed to a band (`ageToBand`). Owns the watermark + AI-label invariants (CLAUDE.md G.3). 18 tests incl. a property test + the explicit "exact age never serialised" assertion. **Pinned 100%**.
- **`apps/server/src/shared/ai/report-summary.ts`** — Claude exec-summary wrapper. Separate AI surface with its OWN cap (`CLAUDE_REPORT_DAILY_SPEND_CAP_USD` → auto-flips `report_generation_enabled`, Sentry + `report_spend_cap_reached`), mirroring chat/vision. Output runs through the SAME `filterChatResponse` as patient chat — a summary naming a dosage/diagnosis/directive is **dropped** (PDF renders without the paragraph; never substitutes the chat copy). Every failure mode returns null → report degrades, never fails. Test seam `__setReportClientForTests`.
- **`apps/server/src/shared/reports/`** — `report-template.ts` (pure HTML builder, inline CSS + inline-SVG sparklines, escaped, self-contained) + `render-pdf.ts` (Puppeteer `renderHtmlToPdf`, isolated behind one function so CI mocks it — never launches Chromium).
- **`apps/server/src/workers/generate-report.{processor,worker}.ts`** — `GENERATE_PDF` (on-demand, 3 retries). Gathers 30d glucose (split fasting/post-meal) + BP + 90d→HbA1c estimate + `adherenceLast(30)` + top-3 insights, builds the model, asks Claude (best-effort), renders → uploads to R2 → flips `Report.status=ready` + `aiSummaryIncluded`. Idempotent (skips `ready`); on error sets `failed` + rethrows so BullMQ retries.
- **`apps/server/src/modules/reports/`** — `POST /generate` (202, dedups in-flight by user+appointment), `GET /:id/status`, `GET /:id/download` (302 → fresh 1h signed R2 URL, 409 `REPORT_NOT_READY` before ready). Household-authorised; `doctor_portal_enabled`-gated.
- **Puppeteer** added to `@swasth/server`. New env `CLAUDE_REPORT_DAILY_SPEND_CAP_USD` (default 10), new flag `report_generation_enabled` (default off). New codes `REPORT_NOT_FOUND` (404) / `REPORT_NOT_READY` (409). New queue `GENERATE_PDF`.
- **Tests** — `reports.test.ts` (12: generate/202, kill-switch 503, dedup, appointment-mismatch 404, worker happy path → ready + pdf key + ai flag, ai-omitted flag, render-failure → failed+rethrow, download 409→302, idempotent re-run, authz 404/403/401) + `report-summary.test.ts` (4: disabled short-circuit, safe pass-through, **dosage-directive dropped**, empty→error). domain-logic 840 green, server typecheck + eslint clean.

### Feature G (chunk 3) — APPOINTMENT_REMINDER cron (2026-06-13)

Third chunk of phase4.md §G. Hourly pre-visit reminder cron + its pure window calculator + tests. No PDF yet (G.4); mobile deferred.

- **`packages/domain-logic/src/appointment-reminders/`** — pure `dueReminderWindows({scheduledAtMs, nowMs, sent})` returning the due window(s). **Bucket semantics**: 7d window = `[sched−7d, sched−1d)`, 1d = `[sched−1d, sched−2h)`, 2h = `[sched−2h, sched)` — disjoint, so at most one fires per tick. An appointment booked 3 days out lands in the 7d bucket (one generic "upcoming" reminder, not a false "in 7 days"); a 1-hour booking only gets the 2h reminder; past appointments fire nothing. 16 tests (3 fast-check properties: ≤1 window, idempotent, never-fires-past). **Pinned 100%** in `vitest.config.ts`.
- **`apps/server/src/workers/appointment-reminder.{processor,worker}.ts`** — hourly cron (`10 * * * *`, staggered off the :00/:05 crons). Scans `status='scheduled'` appointments in `(now, now+7d]` with any un-sent window (served by the G.1 `(status, scheduled_at)` index), runs `dueReminderWindows`, pushes via `resolveHouseholdDelivery` (shared phone rings), and **flips the matching `reminder_sent_*` flag even when zero tokens exist** so a token-less household isn't re-scanned forever (on-device local reminder still covers it). Gated by `doctor_portal_enabled`. Registered in `workers/index.ts` (+ bootstrap).
- **i18n** — bilingual `appointment_reminder` copy (hi + en), window-varied (7d generic / 1d "kal" / 2h "aaj"). **PostHog** `appointment_reminder_sent {appointment_id, window, channel}`. New queue `APPOINTMENT_REMINDER`.
- **Tests** — `tests/integration/appointment-reminder.test.ts`, 8 cases (kill-switch no-op, 7d-fires-once, 2h-only, idempotent re-tick, zero-token-still-flips, beyond-horizon ignored, past ignored, cancelled skipped). Expo push mocked. Also fixed two latent tsc errors in the chunk-2 `doctor-portal.test.ts` (setFlag annotation + unused `outsiderId`) that vitest's esbuild had masked. domain-logic 823 green, server typecheck + eslint clean.

### Feature G (chunk 2) — doctors + appointments CRUD (2026-06-13)

Second chunk of phase4.md §G. Two server modules + the kill-switch + integration coverage. No cron, no PDF yet (G.3/G.4); mobile deferred.

- **`apps/server/src/modules/doctors/`** — `DoctorProfile` CRUD (`GET`/`POST`/`PUT /api/v1/doctors`). Patient-owned address-book entries; no doctor-side auth, no DELETE (would orphan appointments + the `prescriptions.doctor_id` FK). Exports `assertDoctorPortalEnabled()` (shared kill-switch guard) and `resolveOwnedDoctor()` (FK + household-authz helper the appointments module reuses).
- **`apps/server/src/modules/appointments/`** — `DoctorAppointment` CRUD (`POST`/`GET`/`PUT /api/v1/appointments`, `POST /:id/complete`). Cursor-paginated list (`?from=&to=&status=`), upcoming-first. Create validates the doctor is owned by the SAME patient (cross-patient-in-household → `DOCTOR_NOT_FOUND`, cross-household → `FAMILY_NO_ACCESS`). **Reschedule resets `reminder_sent_7d/1d/2h`** so the G.3 cron re-arms the moved date; a purpose-only edit leaves them intact.
- **Kill-switch** — `doctor_portal_enabled` (default off, added to `seed-flags.ts`) enforced in the service layer (mirrors cardiac/respiratory); off → 503 `DOCTOR_PORTAL_DISABLED`, with `requireAuth` still checked first.
- **New error codes** (`shared-types/api.ts` + `error-handler.ts`): `DOCTOR_PORTAL_DISABLED` (503), `DOCTOR_NOT_FOUND` / `APPOINTMENT_NOT_FOUND` (404). **PostHog** `appointment_created {appointment_id, doctor_id, days_until}`.
- **Tests** — `tests/integration/doctor-portal.test.ts`, 17 cases (kill-switch on/off + auth-before-flag ordering, doctor CRUD + null-clear + 404 + cross-household 403, appointment CRUD + cursor/status filter + the two doctor-ownership rejections + reschedule-resets-flags + purpose-edit-preserves-flags + complete + 404). All green. Server typecheck + eslint clean.

### Feature G (chunk 1) — Doctor-portal schema (2026-06-12)

First chunk of phase4.md §G. Schema-only landing — three new tables, two new enums, plus the FK tightening Feature F.1 deferred. No module code, no cron, no PDF job yet; those land in G.2–G.4. Mobile deferred to a follow-up per the Week-17 plan.

- **Schema (`apps/server/prisma/schema.prisma`)** — new `DoctorProfile` (patient-owned, no doctor-side auth), `DoctorAppointment` (with `reminder_sent_7d/1d/2h` idempotency flags for the hourly APPOINTMENT_REMINDER cron + `status`/`scheduled_at` composite index for the reminder scan), and `Report` (async pre-visit PDF: `generating`→`ready`/`failed`, `pdf_r2_key` for signed download, `ai_summary_included` records whether the Claude summary survived the spend cap). Enums `AppointmentStatus` (scheduled | completed | cancelled | missed) and `ReportStatus` (generating | ready | failed).
- **Standalone `Report` table** (chosen over storing status on the appointment) — backs `/reports/*` status+download and supports reports not tied to a booked visit. `appointment_id` is nullable with `ON DELETE SET NULL`.
- **FK tightening** — `prescriptions.doctor_id` was a plain UUID since F.1 (`DoctorProfile` didn't exist yet); migration `20260704000000_doctors` adds the real FK with `ON DELETE SET NULL`. All Feature G FKs are retention-safe: deleting a `DoctorProfile` nulls the pointer on prescriptions/appointments, never cascade-deletes a medical record. `prisma migrate status` clean, server typecheck green.

### Feature F (chunk 4) — `PRESCRIPTION_OCR` BullMQ job (2026-06-09)

Fourth chunk of phase4.md §F. The async worker that drives every prescription upload through the two-pass Vision pipeline and lands the per-item state on `PrescriptionItem`. Consumes F.2's classifier + F.3's wrapper + reconciliation; emitted by the F.5 upload route (next chunk).

- **`apps/server/src/workers/prescription-ocr.processor.ts`** — the orchestrator. Five steps:
  1. **Kill-switch + idempotency guards.** Reads `prescription_ocr_enabled` (auto-flipped off by the F.3 Vision spend cap → cheap early-return). Loads `Prescription` + linked `MedicinePhoto[]`. If row not in `pending_ocr`, return — BullMQ retries are safe. If `job.userId !== prescription.userId`, log + return — wrong-patient enqueue defends against operator footgun.
  2. **Pass A.** One `generateVisionResponse({mode: "prescription_text"})` per `originalPhotoUrls[i]`. Flatten all lines into a single `PassACandidate[]` tagged `${pageIndex}:${rowIndex}` so the audit trail can replay which page + row produced each item.
  3. **Pass B.** One `generateVisionResponse({mode: "medicine_bottle"})` per `MedicinePhoto` where `uploadedAt === "initial_upload"`. Clarification + post-schedule photos belong to their own future workers (F.5/F.5b), so this processor leaves them alone.
  4. **Reconcile + classify (pure).** `reconcilePassAB({passA, passB})` from F.3 → `classifyPrescriptionItem({...})` from F.2 per item. No Prisma calls inside the pure pipeline — the boundary stays clean.
  5. **Persist in one transaction.** Update every `MedicinePhoto.aiReadName + matchConfidence + matchStatus`. Create one `PrescriptionItem` per reconciled candidate with `ocrConfidence` (reconciled), `ocrColor`, `pairedMedicinePhotoIds`, and an append-only `aiSuggestionHistory` recording both the Pass-A and (when matched) Pass-B Vision calls with model + tokens + latency + raw read + alternatives. Update `Prescription.status` to `partial` if any item is `need_clarification` OR Vision returned zero lines, otherwise `pending_approval`. Stamp `approvalRequestedAt` when transitioning to `pending_approval` — drives the §C' "guardian sent, not yet seen" Silent Guardian signal in a later chunk.
- **PII guard.** `processPrescriptionOcr` hashes the raw `userId` to `anon_${sha256(userId).slice(0, 16)}` and passes it as `PrescriptionContext.anonymizedPatientId`. The raw `userId` stays on the server side for PostHog correlation. The F.3 wrapper's compile-time guard would reject anything else.
- **`apps/server/src/workers/prescription-ocr.worker.ts`** — one-liner that registers the processor against the BullMQ queue. Side-effecting; tests import the processor directly.
- **Queue + worker plumbing.** New `PRESCRIPTION_OCR` entry in `QUEUE_NAMES` (`apps/server/src/shared/queue.ts`); `prescriptionOcrWorker` added to the workers array + `workerNames` registry in `apps/server/src/workers/index.ts`. BullMQ retries (3 attempts, exponential backoff) inherited from the global queue defaults.
- **Spend-cap interaction.** A mid-prescription Vision cap breach surfaces as an exception from `generateVisionResponse`; BullMQ retries, and the next attempt sees `prescription_ocr_enabled=false` and aborts cleanly. The prescription stays in `pending_ocr` for ops to re-enqueue after lifting the cap — never half-classified.
- **PostHog event.** New `prescription_ocr_completed{prescription_id, item_count, bottle_count, page_count, request_id}` fires after the transaction commits. `prescription_ocr_call` (from F.3) covers per-call telemetry; this one closes the loop on per-job outcomes.
- **11 new unit tests.** Cover kill-switch / idempotency (4 cases: flag off, already-classified, userId mismatch, row missing) + happy path (4 cases: multi-line YELLOW → `pending_approval`, mixed line with `need_clarification` → `partial`, blank prescription → `partial` with zero items, bottle match drives `pairedMedicinePhotoIds` + matched `matchStatus`) + audit trail / Pass-B isolation (2 cases) + PII guard (1 case asserting anonymised id matches `^anon_[a-f0-9]{16}$`). Total server unit tests: **74** (up from 63).
- **Verify gates** — `pnpm format:check` ✅ · `pnpm typecheck` ✅ (6/6) · `pnpm lint` ✅ (6/6) · `pnpm -r build` ✅ · purity ✅ (88 files unchanged) · 797 domain-logic tests ✅ · 74 server unit tests ✅.

### Feature F (chunk 3) — Claude Vision wrapper + paired-reconciliation (2026-06-09)

Third chunk of phase4.md §F. Vision-side plumbing for the OCR pipeline: pure paired-reconciliation matcher + Claude Vision wrapper + separate per-surface spend cap. The `PRESCRIPTION_OCR` BullMQ job (F.4) and HTTP routes (F.5) still pending — this chunk gives them all the building blocks they need.

- **`packages/domain-logic/src/medicine-aliases/indian-brands.json`** — checked-in alias data for ~40 top diabetes / BP / asthma / cardiac brands sold in India (Glycomet → metformin, Telma → telmisartan, etc.). Updatable via single-PR review per phase4.md §F.6 ("data, not code"). Includes `metformin_gp1` / `metformin_gp2` so variant-difference cases ("Glycomet 500" vs "Glycomet GP 1") fold into distinct canonical keys.
- **`packages/domain-logic/src/medicine-aliases/index.ts`** — `canonicaliseMedicineName(raw): string | null`. Case-insensitive, whitespace-normalised lookup. Returns `null` on unknown brands so the matcher falls through to Levenshtein.
- **`packages/domain-logic/src/prescription-paired-reconciliation/`** — three files. `similarity.ts` exposes `levenshtein` + `nameSimilarity` (alias-table fast path → 1.0 on same canonical; 0.05 on different; Levenshtein fallback). `reconciliation.ts` exposes `reconcilePassAB({passA, passB})` which scores each Pass-A line against every Pass-B bottle and maps the best score onto `match | mismatch | not_attempted`:
  - Score ≥ 0.80 → `match`, confidence boosted by 0.1 (clamped), `matchedMedicinePhotoId` snapshotted.
  - 0.40 ≤ score < 0.80 → `mismatch` (same stem, different variant — downstream classifier marks RED).
  - Score < 0.40 OR Pass B empty → `not_attempted`.
  - One bottle can match multiple Pass-A items by design (morning + evening dose lines for the same drug).
- **Coverage** — 34 new domain-logic tests across `similarity.test.ts`, `reconciliation.test.ts`, and `medicine-aliases/index.test.ts`. **100% lines / branches / functions / statements** on both `reconciliation.ts` and `similarity.ts`. New ratchets pinned in `vitest.config.ts`. Total domain-logic: **797 tests** (up from 763).
- **`apps/server/src/shared/ai/claude-vision.ts`** — Anthropic SDK wrapper that mirrors `claude.ts` shape: lazy client, per-surface circuit breaker (Redis namespace `vision_circuit:*`, separate from chat), per-surface daily spend cap (`vision_spend:*`), hard timeout via `AbortController`, `PrescriptionContext` PII guard (anonymised patient id only), Sentry breadcrumbs + PostHog telemetry. Three modes: `prescription_text` (Pass A — returns lines array with alternatives), `medicine_bottle` (Pass B — returns single bottle reading), `clarification_pass` (same shape as bottle for the F.5 mid-approval reupload flow). Vision uses Sonnet by default (Haiku struggles with handwritten Hindi-English prescriptions); temperature 0 for deterministic replay. JSON-only output enforced by the system prompt + defensive strip of ` ```json ` fences. Out-of-range confidence values clamped to `[0, 1]` at the wrapper.
- **`CLAUDE_VISION_DAILY_SPEND_CAP_USD`** (env, default 20 USD) + **`VISION_HARD_TIMEOUT_MS`** (default 30s — Vision is slower than chat). Cap breach auto-flips `prescription_ocr_enabled=false` per CLAUDE.md "Spend-Cap Parity Across AI Surfaces" — separate from the chat cap so ops can kill OCR without breaking chat.
- **New flags** in `seed-flags.ts`: `prescription_ocr_enabled: false` (kill switch + spend-cap auto-flip target) and `prescription_auto_approve_green: false` (ship default per phase4.md §F.2 — GREEN items still require explicit `/approve`).
- **New error codes** in `@swasth/shared-types`: `VISION_CIRCUIT_OPEN` (503), `VISION_UPSTREAM_TIMEOUT` (504), `VISION_INVALID_JSON` (422), `VISION_NO_IMAGES` (422). Wired through `error-handler.ts`.
- **New PostHog events**: `prescription_ocr_call` (per Vision call, pivot by mode), `prescription_ocr_circuit_opened`, `prescription_ocr_spend_cap_reached`.
- **17 new server unit tests** covering happy path / clamping / fence-stripping / empty-lines / both bottle modes / image validation / PII guard / circuit breaker / hard timeout / spend cap. All passing.
- **Verify gates** — `pnpm format:check` ✅ · `pnpm typecheck` ✅ (6/6) · `pnpm lint` ✅ (6/6, max-warnings=0) · `pnpm -r build` ✅ · purity ✅ (88 files, +5 since chunk 2) · 797 domain-logic tests ✅ · 63 server unit tests ✅.

### Feature F (chunks 1+2 merged) — schema + pure modules (2026-06-09)

PR [#137](https://github.com/yogeshmishra667/SwasthParivar/pull/137) squash-merged to main as `1b2a51c`. Bundles three atomic commits from the F.1 / F.2 / mobile-UI-overhaul session: server schema (Prescription / PrescriptionItem / MedicinePhoto + 5 enums + audit trail), mobile log-surface UX redesign (grid mode chooser + shared modeHeader + inline numpads), and the two safety-critical pure modules (`prescription-color-classifier` + `prescription-approver-resolver`) at 100% branch coverage.

Splash-logo size regression (separately surfaced post-merge) is in flight on PR [#138](https://github.com/yogeshmishra667/SwasthParivar/pull/138) — single-file regen of `splash.png` from 1242×2436 portrait to 1024×1024 square with logo at 85% scale, so Android's splash drawable no longer downscales the logo to ~10% of screen width.

### Feature F (chunk 2) — `prescription-color-classifier` + `prescription-approver-resolver` (2026-06-08)

Two pure domain-logic modules backing the F.4 item state machine and the F.2 approval-authority resolution. No service code, no Vision wrapper, no HTTP routes yet — those land in F.3+. Both modules are SAFETY-CRITICAL per phase4.md §F.6: a regression in either can put the wrong medication in a 70-year-old's cabinet.

- **`packages/shared-types/src/prescriptions.ts`** — new file exporting `PrescriptionItemColor` (`red | yellow | green | need_clarification`), `MedicineMatchStatus` (`match | mismatch | unclear | not_attempted`), `PrescriptionItemStatus`, `PrescriptionStatus`, `ApproverFrictionLevel` (`none | high`), and the confidence-band constants `PRESCRIPTION_CONFIDENCE_HIGH=0.85` / `PRESCRIPTION_CONFIDENCE_LOW=0.6`. Mirrors the Prisma enums from F.1 so domain-logic + mobile UI share one source of truth without importing `@prisma/client`. Same pattern cardiac uses for `RhythmStatus` / `ExerciseTolerance`.
- **`packages/domain-logic/src/prescription-color-classifier/`** — pure `classifyPrescriptionItem({ocrConfidence, photoCrossCheckStatus, hasPairedMedicinePhoto})` returning `{color, reason}`. Encodes the F.6 decision tree literally: mismatch overrides all → RED; confidence < 0.60 with no bottle → `need_clarification`; < 0.60 with a bottle → RED; 0.60–0.85 → YELLOW; ≥ 0.85 + match → GREEN; ≥ 0.85 otherwise → YELLOW. GREEN is unreachable without a bottle match per the §F.6 design rule. 16 tests + 3 fast-check property tests (totality, GREEN gating, mismatch-always-RED). **100% lines / branches / functions / statements** — pinned in `vitest.config.ts`.
- **`packages/domain-logic/src/prescription-approver-resolver/`** — pure `resolveApprover({patientUserId, acceptedFamilyLinks, patientIsGuardianElsewhere})` returning `{approverUserId, requiresGuardianApproval, frictionLevel, reason}`. Three branches per F.2:
  - **Guardian primary**: ≥ 1 accepted FamilyLink whose relationship folds to `child | spouse | caregiver` → that guardian approves, friction `none`. Tie-break by family precedence (child > spouse > caregiver) then earliest `acceptedAt` — stable "primary" identity across invite churn.
  - **Self-capable adult**: no qualifying guardian but `patientIsGuardianElsewhere=true` → patient self-approves, friction `none`.
  - **Solo with friction**: no qualifying guardian, not a guardian elsewhere → patient self-approves with friction `high` (the elderly-shared-device case CLAUDE.md "Solo patient (no guardian)" targets — 3-second activation delay + re-confirm modal).
  - **Relationship-family matcher** (`relationship.ts`) folds free-text labels (English + Hindi/Hinglish + Devanagari) onto a closed `RelationshipFamily` enum. Aliases curated, honorifics stripped (`ji`, `saab`, etc), word-boundary matching (so "godfather" does NOT match "father"). Pre-compiled regex patterns for the security/non-literal-regexp lint rule.
  - 37 tests + 3 invariant tests. **100% lines / branches / functions / statements** on `resolver.ts` AND `relationship.ts` — pinned in `vitest.config.ts`. The empty-string defensive guard inside `hasAlias` is marked `/* c8 ignore */` since the caller short-circuits before reaching it.
- **Coverage ratchets pinned** — three new entries in `packages/domain-logic/vitest.config.ts` at 100% across the board: `prescription-color-classifier/classifier.ts`, `prescription-approver-resolver/resolver.ts`, `prescription-approver-resolver/relationship.ts`.
- **Verify gates** — `pnpm format:check` ✅ · `pnpm typecheck` ✅ (6/6) · `pnpm lint` ✅ (6/6) · `pnpm -r build` ✅ · purity ✅ (83 files, up from 76 — 3 new files in domain-logic) · **763 domain-logic tests** ✅ (up from 708, +55).

### Feature F (chunk 1) — Prescription / PrescriptionItem / MedicinePhoto schema (2026-06-07)

First chunk of phase4.md §F. Schema-only landing — three new tables, five new enums, audit-trail columns. No service code, no OCR job, no HTTP routes yet; those land in chunk 2+ once the schema has stabilised.

- **Schema (`apps/server/prisma/schema.prisma`)** — new `Prescription` + `PrescriptionItem` + `MedicinePhoto` models. Enums: `PrescriptionStatus` (pending_ocr | pending_approval | partial | approved | rejected), `PrescriptionItemColor` (red | yellow | green | need_clarification — the §F.4 revision that parks low-confidence items instead of silently dropping them), `PrescriptionItemStatus` (pending | need_clarification | approved | rejected | needs_doctor), `MedicineMatchStatus` (match | mismatch | unclear | not_attempted — `not_attempted` keeps GREEN unreachable without a bottle photo per §F.6), `MedicinePhotoUploadContext` (initial_upload | mid_approval_clarification | post_schedule_routine_check). Reverse relations added on `User` (`prescriptions[]`) and `MedicationSchedule` (`prescriptionItems[]` + `medicinePhotos[]`).
- **Audit trail — `PrescriptionItem.aiSuggestionHistory`** is the append-only JSON array that lets ops replay "which Vision pass + which approver tap put this drug in the cabinet three months later" (same philosophy as `PaymentEvent.rawPayload`). `pairedMedicinePhotoIds` (UUID[]) snapshots the Pass-B inputs at OCR time; `approverCorrections` records the diff vs the AI's suggestion at approval time; `clarificationAttempts` enforces the §F.4 "≤ 3 clarification attempts → terminal needs_doctor" rule.
- **Approval-authority snapshot — `Prescription.requiresGuardianApproval`** is a NOT-NULL Boolean resolved at upload time and IMMUTABLE thereafter. Per CLAUDE.md "Approval authority: guardian-primary": a guardian being removed mid-approval must NOT flip authority back to the elderly patient. `approvalRequestedAt` / `approvalCompletedAt` track the guardian-side push lifecycle for the §C' Silent Guardian signal "Maa ji ne bheja, abhi tak nahi dekha".
- **MedicinePhoto** uses nullable `prescriptionId` / `prescriptionItemId` / `medicationScheduleId` so a photo can be attached at upload time (BEFORE any item is reconciled), at mid-approval clarification time, OR post-schedule for the routine cross-check flow (CLAUDE.md `POST /medicines/:id/photo`). Three indexes cover the three lookup patterns.
- **`doctorId` is plain UUID, no FK** — `DoctorProfile` doesn't ship until Feature G (Week 17). A follow-up migration adds the FK once `doctor_profiles` exists. Same pattern Phase 1 used for the eventually-tightened `Household.primaryUserId`.
- **Migration `20260628000000_prescriptions/migration.sql`** — hand-written, byte-equivalent to `prisma migrate diff` output (verified locally). DPDP retention preserved: rejected/approved prescriptions are RETAINED, never row-deleted. CASCADE fires only on user row deletion (separate forget-me flow).
- **Verify gates** — `pnpm format:check` ✅ · `pnpm typecheck` ✅ (6/6) · `pnpm lint` ✅ (6/6) · `pnpm -r build` ✅ · purity ✅ (76 files) · 708 domain-logic tests ✅. Schema ↔ migration parity passes via `prisma migrate diff`.

### Feature E (chunk 7) — Mobile voice integration for cardiac + respiratory (2026-06-07)

Wires the cardiac + respiratory voice parsers (chunk 6) into the mobile log surface. The headline numeric (HR / peak flow) is captured by voice; the rest of the form (rhythm, chest-pain, exercise tolerance / symptom severity, inhaler) stays tap-only. Voice mic is opt-in for the new modes — the tap form remains the default landing so the existing Phase-4 §E.5 flow is unchanged for users who don't toggle voice on.

- **`apps/mobile/src/components/logging/VoiceInput.tsx` + `VoiceInputNative.tsx`** — props widened to a discriminated union over `mode: "glucose" | "cardiac" | "respiratory"`. Glucose path is byte-identical with Phase 1: same `parseVoiceTranscript` call, same `VoiceParseResult` shape, same contextual-string list, same tap-target geometry. Cardiac / respiratory dispatch into `parseCardiacVoiceTranscript` / `parseRespiratoryVoiceTranscript` and return `NumericVoiceParseResult`. Contextual-string lists per mode push the SR engine toward "dil ki dhadkan" / "peak flow" / "saans" so cross-domain false transcripts are reduced.
- **Pre-fill, not skip-to-confirm.** Voice captures the single numeric and routes back to the tap form (CardiacInput / RespiratoryInput) with that field seeded — NOT directly to the confirmation screen. Rhythm / chest-pain / exercise / symptom severity / inhaler are still tap-only because they have no clean voice utterance and would force the elderly user to repeat themselves on edit. Cardiac voice + tap = the same Next → confirmation flow as pure tap.
- **`CardiacInput.tsx` + `RespiratoryInput.tsx`** — accept optional `initialHeartRate` / `initialPeakFlow` props. Internal state seeds from those on first render. The existing tap-only flow is unchanged when the prop is `undefined`.
- **`apps/mobile/app/(tabs)/log.tsx`** — `inputMethod` default is now per-mode via `defaultInputMethodFor(mode)`: glucose stays on "voice" (Phase 1), cardiac / respiratory default to "numpad" (existing §E.5 flow). `resetForNext` takes the next mode so a mode-switch lands on the right default; the saved-summary "Log another" button keeps the current mode's default. Voice mode for cardiac / respiratory renders the mic OUTSIDE the ScrollView — the same Android tap-intercept regression the glucose branch already calls out (a Pressable inside ScrollView swallows the mic activation on Android).
- **Analytics extension** — `voice_attempt` event now carries a `surface: "glucose" | "cardiac" | "respiratory"` dimension. Dashboards can pivot voice success rate, colloquial-match rate, uncertainty rate by surface — important for the developer-alert thresholds (voice_success < 70% → parsing problem) which now apply per-category.
- **i18n (en + hi)** — new `voice.glucose.*`, `voice.cardiac.*`, `voice.respiratory.*` namespaces for example hints + accessibility labels. The legacy top-level `voice.exampleHint` key is preserved (no other consumer reads it, but a soft-deprecate is safer than ripping it out). Hindi-first per CLAUDE.md.
- **Verify gates** — `pnpm typecheck` ✅ (6/6) · `pnpm lint` ✅ (6/6) · purity ✅ (76 files) · 770 tests ✅ · `pnpm -r build` ✅. The two glucose-vs-numeric type assertions in the dispatch were trimmed to the minimum the discriminated union requires — only the glucose branch needs an explicit cast, the numeric branch is a structural supertype of the parse-result union.

### Feature E (chunk 6) — Cardiac + Respiratory voice parser (2026-06-06)

Pure-function voice parsers for the two new categories. The glucose parser stays byte-identical; this chunk adds a parallel `parseNumericVoiceTranscript` covering numeric-only surfaces (HR in bpm, peak flow in L/min) with no reading-type axis. Mobile integration into `VoiceInput` is intentionally deferred — UI ships in a follow-up so the parser can stabilise on its own first.

- **`packages/domain-logic/src/voice-parser/dictionary.ts`** — new `CARDIAC_INTENT_KEYWORDS` ("dhadkan", "dil ki dhadkan", "dil", "pulse", "heart rate", "heartbeat", "heart") and `RESPIRATORY_INTENT_KEYWORDS` ("peak flow", "saans", "saans phoolti", "breath", "breathing", "asthma", "inhaler"). Glucose dictionary entries unchanged.
- **`packages/domain-logic/src/voice-parser/numeric-parser.ts`** — shared `parseNumericVoiceTranscript({transcript, confidence, intentKeywords, validRange})`. Same gate sequence as the glucose parser (empty → no_number, negation → negated_intent, past-tense-without-present → past_tense_only, no intent → no_intent, no number → no_number, value outside range → out_of_range). Helpers (containsAnyWord, extractDigits, extractColloquial, rankCandidates) are deliberately duplicated from `parser.ts` rather than extracted — glucose is the safety-critical path that ships today; isolating new code keeps regressions from touching glucose. A future `chore/voice-helpers` extracts the common surface.
- **The Hindi colloquial number dictionary IS shared** — "sava sau" still means 125 whether the patient is reporting glucose, HR, or peak flow.
- **`packages/domain-logic/src/voice-parser/cardiac-voice.ts` + `respiratory-voice.ts`** — thin wrappers that call `parseNumericVoiceTranscript` with the category-specific intent keywords + the `*_VALID_MIN/MAX` constants from `@swasth/shared-types`. Each is one function call.
- **Test fixtures `packages/test-factories/src/voice-transcript.fixtures.ts`** — new `CARDIAC_VOICE_FIXTURES` + `RESPIRATORY_VOICE_FIXTURES` (8 + 7 fixtures): explicit intent, colloquial Hindi, English variants, past-tense rejection, no-intent rejection, out-of-range, uncertainty hedging. New `NumericVoiceFixture` interface — the original `VoiceFixture` (glucose-shaped with `capturedAtHourLocal`) stays untouched.
- **Tests — 48 new cases (24 per category)**: happy-path table tests with `it.each`, all rejection reasons, confirmation-flag plumbing (`requiresStrongConfirmation` on low confidence, `uncertaintyDetected` on hedge words), intent-ranking (numbers after intent keyword beat numbers before), fixture-compliance loops. All passing.
- **Coverage ratchet pinned** in `vitest.config.ts`: `numeric-parser.ts` at 97% statements / 100% functions / 93% branches / 97% lines (the 7% uncovered branch is the defensive non-standalone-retry path inside `containsAnyWord` — unreachable from production transcripts, matches the glucose-parser baseline). Cardiac/respiratory wrappers are too thin to need their own per-file ratchet.
- **Total domain-logic** now: 708 tests across 38 files (up from 660). Ratchets enforced.
- **Verify gates** — `pnpm format:check` ✅ · `pnpm typecheck` ✅ (6/6) · `pnpm lint` ✅ (6/6) · `pnpm -r build` ✅ · 708 unit tests ✅.

### Feature E (chunk 5) — Mobile log surfaces for cardiac + respiratory (2026-06-06)

Patient-facing UX for the two new categories. Numpad-only this round; voice fixtures + parser extension land in a small follow-up. Flag-gated through the existing CC.12 rollout resolver so a patient outside the cohort sees the unchanged Phase-2 layout.

- **Server config registry `apps/server/src/modules/config/config.service.ts`** — adds `cardiac_logging` and `respiratory_logging` to the `FEATURE_REGISTRY`. Mobile reads these via `GET /api/v1/config/features` and gates the mode chooser buttons on them; server-side writes ALSO gate on the same `*_logging_enabled` flag so a runtime flip turns the feature off at both ends in lockstep.
- **Mobile service clients `apps/mobile/src/services/cardiac.ts` + `respiratory.ts`** — mirror `services/bp.ts`: online-first with a `queued` fallback on network / 5xx errors. The new typed `rejected` discriminator surfaces `CARDIAC_DISABLED` / `RESPIRATORY_DISABLED` (503) so the screen can render a "feature unavailable" message instead of a generic toast. Sets `targetUserId` for shared-phone profile routing.
- **`apps/mobile/src/components/logging/CardiacInput.tsx`** — TAP-ONLY (CLAUDE.md "core flows: TAP ONLY"). Sections: HR numpad → rhythm chips (regular/irregular/unknown) → chest-pain toggle (auto-expands a 0–10 pain-severity numpad) → exercise-tolerance chips. Local validation rejects HR ∉ [30,250] and `painSeverity > 0` without `chestPain=true` before the user can tap Next.
- **`apps/mobile/src/components/logging/RespiratoryInput.tsx`** — Symmetric. Sections: peak-flow numpad → symptom-severity chips → inhaler toggle (auto-expands a puffs numpad). Local validation enforces at-least-one-signal (peakFlow OR inhalerUsed OR symptomSeverity≠none).
- **`apps/mobile/src/components/logging/CardiacConfirmationScreen.tsx` + `RespiratoryConfirmationScreen.tsx`** — Mirror `BPConfirmationScreen`. Both run the **pure classifier from `@swasth/domain-logic` locally** so the patient sees the critical / warn banner BEFORE the server round-trip — the same `classifyCardiacReading` / `classifyRespiratoryReading` the server runs, so this is a faithful preview, not a guess.
- **`apps/mobile/app/(tabs)/log.tsx`** — `LogMode` widened from `glucose | bp | meal` to also include `cardiac | respiratory`. Mode chooser renders the two new buttons only when their per-user rollout flag is true; the layout for users outside the cohort is byte-identical to Phase 2. Cardiac + respiratory get the same `saved` summary screen, offline indicator, and reset semantics. Critical-bypass surface emits the same `critical_bypass_triggered` PostHog event with a new `surface` dimension (`cardiac` / `respiratory`) so dashboards pivot by category.
- **i18n (en + hi) — `apps/mobile/src/i18n/{en,hi}.json`** — ~80 new keys covering input labels, confirmation copy, classification banner per reason code (every value of `classification.reason` from both classifiers gets its own localised string), saved / offline / disabled / saveFailed states, range hints, mode-chooser buttons. Hindi-first per CLAUDE.md.
- **Regression — `tests/integration/config.test.ts`** updated for the widened registry (3 features now return; previously 1). 7/7 still pass.
- **Verify gates** — `pnpm format:check` ✅ · `pnpm typecheck` ✅ (6/6) · `pnpm lint` ✅ (6/6) · `pnpm -r build` ✅ · 660 domain-logic tests ✅ · 7/7 config integration ✅.

### Feature E (chunk 4) — ANALYZE_READING multi-category wiring (2026-06-06)

Closes the worker-side gap left by chunks 1-3. Cardiac + respiratory trend detectors now actually run; BP gains cross-condition firing on its own insert (previously the correlation card only landed when glucose arrived). Glucose path byte-identical, verified by regression run.

- **Job shape generalisation `apps/server/src/workers/analyze-reading.processor.ts`** — `AnalyzeReadingJob` is now a discriminated union over `category`. Missing category routes to the glucose branch (back-compat with in-flight BullMQ retries from the previous server). Per-category branches:
  - `glucose` (existing) — unchanged: spike + trend + meal-correlation + anomaly + cross-condition.
  - `bp` (new) — runs `detectCrossCondition` so a BP-leading patient produces the correlation card on BP insert. Same `cross_condition_detector_enabled` flag gate as the glucose path.
  - `cardiac` (new) — runs `detectCardiacTrend` across 5/14/30 day windows; the window-pattern de-dup pass in the processor collapses repeats within 24h.
  - `respiratory` (new) — runs `detectRespiratoryTrend` across 5/14/30 day windows; null-peakFlow rows filtered at the boundary mapper (`toTypedRespiratory`) so the pure detector keeps its non-null contract.
- **Window-pattern dedup extended** — `WINDOW_PATTERNS` now includes `trend` alongside `cross_condition` and `meal_correlation`. Without this, every cardiac/respiratory insert at the same severity would persist a duplicate card. Spike + anomaly remain target-keyed and never dedup.
- **BP service enqueue** — `bp.service.ts` now fires `analyzeQueue.add` after a successful write; controller forwards `requestId` for correlated logging.
- **Cardiac + respiratory service enqueues** — symmetric `analyzeQueue.add` calls after the critical-bypass block, mirroring the glucose pattern.
- **Integration tests** — one ANALYZE_READING enqueue assertion added to `bp.test.ts`, `cardiac.test.ts`, `respiratory.test.ts` (3 new, 49 total). BullMQ queue probe verifies the job carries the right `category` + `readingId`. All passing.
- **No glucose regression** — 12/12 existing `readings.test.ts` tests still pass after the processor refactor.
- **Verify gates** — `pnpm format:check` ✅ · `pnpm typecheck` ✅ (6/6) · `pnpm lint` ✅ (6/6) · `pnpm -r build` ✅ · 49/49 integration ✅.

### Feature E (chunk 3) — Cardiac + Respiratory trend detectors (2026-06-05)

Third chunk of phase4.md §E. Pure pattern detectors that complete the safety-critical insight surface for the new categories. ANALYZE_READING server-side wiring is deferred (BP doesn't have it either today; it's a follow-up that can land for all three categories together).

- **Detector input types `packages/domain-logic/src/detectors/types.ts`** — added `TypedCardiacReading` (id + heartRateBpm + measuredAt) and `TypedRespiratoryReading` (id + peakFlow + measuredAt). Both narrow to the trend-relevant numeric column only; the never-mix-conditions invariant becomes structural (the function literally cannot see glucose/BP fields).
- **`packages/domain-logic/src/detectors/cardiac-trend.ts`** — linear regression on heart-rate over 5/14/30 day windows. R² > 0.5 gate, ≥ 5 points, span ≥ max(2, window/3) days. Slope thresholds calibrated for HR's tighter range (60-100 bpm typical, vs. glucose's 100-180 mg/dL): null < 0.5 bpm/day, notable ≥ 1.0, rapid ≥ 2.5. Message keys: `insight.cardiac.trend.{slow,notable,rapid}`. `conditionsInvolved: ["cardiac"]` hardcoded.
- **`packages/domain-logic/src/detectors/respiratory-trend.ts`** — same regression skeleton over peak-flow. Thresholds: null < 5 L/min/day, notable ≥ 10, rapid ≥ 25 (calibrated to a 300-600 L/min typical range — a 70 L/min/week drift is roughly a 15% baseline shift, clinically notable). Caller responsible for filtering rows where `peakFlow === null` before passing in (input type makes peakFlow non-nullable, so the contract is enforced at compile time). Message keys: `insight.respiratory.trend.{slow,notable,rapid}`.
- **Never-mix-conditions invariant** — structurally enforced by the input types; pinned in test by asserting `conditionsInvolved` is always exactly `["cardiac"]` / `["respiratory"]` even when ad-hoc fields are smuggled in through structural typing.
- **Tests (28 new, 14 per detector)** — sparsity gates (< 5 readings, packed span, ancient readings excluded), three severity bands, directional sign, R² gate, constant-value null-fit case, evidence shape, confidence clamping, invariant assertions. All passing.
- **Coverage ratchet pinned** in `vitest.config.ts`: both detectors at 100% lines / 100% functions / 94% branches / 97% statements — matches the measured values; the 6% uncovered branch is the defensive `fit === null` path which the span check makes structurally unreachable (same situation as glucose `detectors/trend.ts`).
- **Total domain-logic** now: 660 tests across 36 files, all green. Ratchet enforced.

### Feature E.2 — Cardiac + Respiratory server modules + multi-category bypass dispatch (2026-06-05)

Second chunk of phase4.md §E. Server modules, critical-bypass dispatch generalisation, and full integration coverage. Mobile UI, ActivityDaily/SleepLog, and trend detectors are still deferred.

- **Multi-category bypass planner `packages/domain-logic/src/critical-bypass/multi-category.ts`** — pure `planMultiCategoryBypassDispatch(input)`. Drives off the classifier `reasons[]` (no per-category domain teaching in the planner). Per-category copy-key precedence: cardiac → `chest_pain > hr_high > hr_low`; respiratory → `peak_flow > severe_symptom`. Cooldown window shared with glucose (30 min) but evaluated against the per-category last-bypass ISO, per CLAUDE.md "Phase 4 Invariants — Multi-condition Critical-Bypass Dispatch". 12 tests, **100% lines / 100% branches / 100% functions**. Ratchet pinned at 100%.
- **Per-category Redis cooldown `apps/server/src/shared/critical-bypass-cooldown.ts`** — `getLastBypassIso(category, userId)` + `markBypassed(category, userId, iso)`. Key shape: `critical_bypass:cooldown:{category}:{userId}`, 30-min TTL. Fail-safe: Redis down → returns `null` → planner treats as "no recent bypass" → dispatch proceeds. A Redis outage can never silence a real critical alert. Glucose's historic cooldown (FeedbackEvent `critical_warn`) is untouched.
- **Worker payload generalisation `apps/server/src/workers/critical-alert.processor.ts`** — `CriticalAlertJob` is now a discriminated union: `CriticalAlertGlucoseJob` (historical shape, no category discriminator) routes to the unchanged glucose code path; `CriticalAlertMultiCategoryJob` (new) routes to a parallel branch that reuses `resolveGuardianPushTokens` + `resolveSmsTargets` + `scheduleCriticalBypassAutoEscalation`. The chain itself is reused not re-implemented (CLAUDE.md). Glucose integration tests still pass byte-for-byte (verified — 19/19 BP + readings green after the refactor).
- **i18n bundle extension `apps/server/src/shared/i18n/notifications.ts`** — 5 new copy keys × 2 languages (hi + en): `critical_bypass_cardiac_low/high/chest_pain` and `critical_bypass_respiratory_peak_flow/severe`. Bundle type-system enforces parity across languages.
- **Cardiac module `apps/server/src/modules/readings/cardiac.{validation,service,controller}.ts`** — colocated with `bp.*` inside `readings/` (matches the BP convention). Routes: `POST/GET/DELETE /api/v1/readings/cardiac`. Idempotent write via the shared `checkIdempotent` helper. Validation enforces HR ∈ [30,250] and rejects `painSeverity > 0 && !chestPain` (medical correctness — that combo is always a UI bug). Concurrent-create race recovery via the P2002 catch (same shape as glucose). On critical: reads per-category cooldown via Redis, plans the dispatch, enqueues to `CRITICAL_ALERT`, then stamps the cooldown — order matters: enqueue first, then mark.
- **Respiratory module `apps/server/src/modules/readings/respiratory.{validation,service,controller}.ts`** — symmetric. Validation: peak flow ∈ [50,800], at least one signal must be present (peakFlow OR inhalerUsed OR symptomSeverity≠none — otherwise the row is a no-op), `puffs > 0` requires `inhalerUsed=true`. Baseline peak flow is snapshotted onto the row so a later User-baseline change cannot retroactively reclassify a historical reading. Critical-bypass enqueue identical to cardiac; baseline-null falls back to symptom signal only (so severe symptom still fires bypass without a numeric reading).
- **Kill-switch flags** — `cardiac_logging_enabled` + `respiratory_logging_enabled`, both default false. Service throws `CARDIAC_DISABLED` / `RESPIRATORY_DISABLED` (new error codes, 503) when flipped off. Default flag values added to `prisma/seed-flags.ts`. New error codes mapped in `error-handler.ts` and added to `@swasth/shared-types`.
- **Routes mounted in `readings.routes.ts`** — all 6 new endpoints behind `requireAuth`. Routes mount unconditionally; the runtime flag check is in the service layer so a flag flip is a runtime change with no redeploy.
- **PostHog event extension `critical_bypass_triggered`** — now carries optional `category` + `copy_key` for multi-category dispatches. Glucose emission shape unchanged (the historic `value_mg_dl + severity` fields stay required-when-present via optional discrimination). Same extension on `push_zero_recipients` for category dimensional pivots.
- **Integration tests `tests/integration/cardiac.test.ts` + `respiratory.test.ts`** — 18 cases each, total 36, covering: happy path (normal + warn), validation (HR range, chest-pain consistency, no-signal rejection, source missing), idempotency (stale → 409, replay → 200 same id, version bump → in-place update), critical-bypass enqueue verification via BullMQ queue probe (job carries `category` + `copyKey`), per-category 30-min cooldown semantics (second critical within window → `withinCooldown=true`, no second enqueue), kill-switch (503), authz (cross-user delete → 404), unauthorised (401). **All 36 pass against real Postgres + Redis containers.**
- **Verify gates** — `pnpm format:check` ✅ · `pnpm typecheck` ✅ (6/6 projects) · `pnpm lint` ✅ (6/6) · `pnpm -r build` ✅ · domain-logic unit tests ✅ (632 total, 12 new since chunk 1) · 36/36 new integration tests ✅ · existing BP + glucose integration tests ✅ (19/19, no regression).

### Feature E.1 — Cardiac + Respiratory schema + bypass classifiers (2026-06-05)

First chunk of phase4.md §E. Schema-only + the two safety-critical pure detectors. Service wiring, activity/sleep schema, activity-aggregator, sleep-quality-classifier, and the trend detectors are deferred to a follow-up PR.

- **Schema (`apps/server/prisma/schema.prisma`)** — new `CardiacLog` + `RespiratoryLog` models (both TimescaleDB-hypertable-ready with composite PK on `(id, measured_at)` and `@@unique([clientUuid, measuredAt])`, identical pattern to `bp_readings` / `glucose_readings` per the CLAUDE.md note on hypertable PKs). 3 new enums: `RhythmStatus` (regular/irregular/unknown), `ExerciseTolerance` (normal/reduced/severe), `SymptomSeverity` (none/mild/moderate/severe). `User` gains `cardiacLogs` + `respiratoryLogs` relations. `prisma validate` + `prisma format` clean. **ActivityDaily + SleepLog deferred to Feature I (Week 19), per the original spec.**
- **Migration `20260620000000_cardiac_respiratory_logs/migration.sql`** — additive DDL only, byte-matches `prisma migrate diff --from-empty` output for the cardiac/respiratory portions. Hypertable conversion (`SELECT create_hypertable('cardiac_logs', 'measured_at', if_not_exists => TRUE)` and same for respiratory) is intentionally NOT in the migration — wired in test setup + production runbook, mirroring the bp_readings convention so plain Postgres still accepts the schema.
- **Pure detector `packages/domain-logic/src/cardiac-thresholds/`** — `classifyCardiacReading(input)` returns `{ severity: "normal" | "warn" | "critical_bypass", reason, reasons[] }`. Critical-bypass (hardcoded, CLAUDE.md "Phase 4 Invariants — Multi-condition Critical-Bypass Dispatch"): HR < 40 OR HR > 150 OR (chestPain && severity ≥ 7). Warn band: HR 40–49 / 121–150, chestPain < 7, irregular rhythm, exerciseTolerance ∈ {reduced, severe}. `painSeverity: null` is treated as 0 (conservative). `shouldTriggerCardiacBypass(input)` exported as a service-layer convenience helper. 28 tests, **100% lines / 100% branches / 100% functions**. Ratchet pinned at 100% in `vitest.config.ts`.
- **Pure detector `packages/domain-logic/src/respiratory-thresholds/`** — `classifyRespiratoryReading({peakFlow, baselinePeakFlow, inhalerUsed, symptomSeverity})`. Critical-bypass (hardcoded): `peakFlow / baselinePeakFlow < 0.5` (asthma red zone) OR `symptomSeverity === "severe"`. Warn band: yellow zone (50–80%), moderate/mild symptoms, inhalerUsed. Defensive guards: `baselinePeakFlow ≤ 0` and missing peakFlow/baseline skip the peak-flow branches entirely, falling back to symptom + inhaler signal — important during an acute attack when the patient cannot blow into the meter. 24 tests, **100% lines / 100% branches / 100% functions**. Ratchet pinned at 100%.
- **Shared constants** — moved hardcoded thresholds into `@swasth/shared-types` (`HR_CRITICAL_LOW`, `HR_CRITICAL_HIGH`, `CHEST_PAIN_CRITICAL_SEVERITY`, `PEAK_FLOW_RED_ZONE_RATIO`, `PEAK_FLOW_YELLOW_ZONE_RATIO`, plus valid-range bounds for upcoming Zod validators). Mirrors the existing `GLUCOSE_CRITICAL_LOW`/`HIGH` pattern so server + mobile + admin share one source of truth.
- **Verify gates** — `pnpm format:check` ✅ · `pnpm typecheck` ✅ (6/6 projects) · `pnpm lint` ✅ (6/6) · `pnpm -r build` ✅ · domain-logic unit tests ✅ (620 total, 52 new) · per-file coverage ratchets ✅.

### Mobile UX polish round 2 + SOS dark-mode + icon refresh (2026-06-04)

Continuation session on the same working tree as the 2026-06-03 entry. Closes the visual rough edges and locks in the brand-icon swap.

- **Brand-icon swap.** User dropped a hand-designed family-of-figures inside a heart for `icon.png`; companion assets were broken (white-only adaptive, blank notification). New `apps/mobile/scripts/derive-companion-icons.mjs` reads `icon.png`, chroma-keys the brand-blue, and regenerates `adaptive-icon.png` (white art on transparent at 50% safe zone — conservative enough to survive Pixel circular, OneUI squircle, and teardrop launcher masks; was 66% which was clipping the heart's top edges on real devices) and `notification-icon.png` (96×96 pure-white silhouette so Android tints correctly). Run with `pnpm --filter @swasth/mobile icon:derive`. Original `splash.png` is still hand-designed and unchanged; the `expo-splash-screen` plugin detour got reverted to the legacy `expo.splash` config because the plugin's screen-center anchor was clipping the logo on tall phones.
- **Dev IP refresh.** Updated `apps/mobile/app.json` `extra.apiBaseUrl` and the fallback in `apps/mobile/src/services/api.ts` from `10.251.99.196` → `10.228.161.196` (carrier-NAT rotation).
- **TipsCarousel editorial redesign.** After three iterations, settled on a two-zone editorial card layout: tinted top zone with an icon tile (bottom-left, spans the seam between zones) + big faded number top-right + two decorative offset blobs; clean content zone below with title, body, and an action row that has a leading topic-icon chip + action text + circular arrow nudge. Peek-and-gap snap carousel (`CARD_W = USABLE_W − 24px peek`, `GAP = 14`) — earlier full-width version with `pagingEnabled` glued cards edge-to-edge; current version respects the parent insights ScrollView's existing 16dp padding so we don't double-inset. Pagination dots with a wider active state. Zero emojis (per user request); the leading icon in the action row replaces what was previously a 💧/🚶/🥗/🌙.
- **InviteGuardianForm — profile as the header.** The "for {{name}} ji" context now lives IN the card header: the active profile's avatar (real `avatarColor` from the profile switcher) is the hero icon, the title and `inviteForLine` sit beside it. Removes the separate "Inviting for X" pill below the header that was crammed and visually orphaned. Soft hero band, icon-prefixed phone + relationship inputs, color-coded sensitivity radio cards (green/blue/red dots), iconified error/success pills. Nothing removed — only restructured.
- **Family tab hero + section headers.** Live count + avatar stack in `FamilyQuickSummary.tsx`. Icon-chip section headers with count badges. Iconified `EmptyState` cards for both invites + patients sections. Family route file unchanged except for the new helpers.
- **Profile-switcher dark-mode polish.** Closed the gaps in `ProfileSwitcher.tsx` (inactive ring + label color), `ProfileSelectorModal.tsx` (active-row bg, border, added selected check icon), `AddProfileModal.tsx` + `EditProfileModal.tsx` (label colors, close icon contrast).
- **Check-frequency UX surfacing.** New `src/utils/nextReminder.ts` exports `nextReminderAt()` + `formatNextReminder()` + `cadenceLabel()` — pure helpers (TFunction-typed, easy to unit-test) that compute the next time the local reminder will fire and format it as "Aaj 7:30 PM" / "Kal 7:00 AM" / "Somvaar 7:00 AM" / "1 Apr, 7:00 AM". Two new surfaces consume them: `CheckScheduleChip` (subtle "Daily • 7:00 AM" pill at the top of the Log input stage) and `NextCheckReminderCard` (post-save card that says "Agla [Sugar/BP/both] check reminder: Kal 7:00 AM"). Both are condition-aware (read active profile's `conditions`) and hide themselves when notifications are off. Wired into `app/(tabs)/log.tsx` for glucose, BP, and meal modes. Active-profile changes in `_layout.tsx` resync the schedule so a profile switch re-renders the title/body. ~30 new `nextReminder.*` i18n keys (en + hi). Skipped guardian-side surfacing — would require extending `getPatientDashboard` server-side to expose patient preferences; flagged as a follow-up.
- **SOS Button extension + AfterAction dark-mode fix.** The user's SOS clinical redesign (`SOSActiveFullscreen`, `SOSConfirmationScreen`, `SOSAfterActionCard`) passed `style` + `textStyle` props that the existing `Button` component didn't declare — 7 typecheck errors. Extended `apps/mobile/src/components/ui/Button.tsx` to accept both, merging `style` AFTER the built-in 48dp touch-target floor so accessibility minimums survive overrides. Separately, `SOSAfterActionCard.tsx` had hardcoded `#FFFFFF` / `#EFF6FF` / `#374151` choice tiles that were broken in dark mode — extracted a `ChoiceTile` helper, swapped to NativeWind `bg-blue-50 dark:bg-blue-950/40` etc. The two panic surfaces (`SOSActiveFullscreen`, `SOSConfirmationScreen`) stay always-dark by design (same logic as `CriticalAlert.tsx` — safety surfaces are theme-independent).
- **Emoji purge.** Per user request, removed every emoji from session-touched files: 💧🚶🥗🌙 from tip action defaultValues, 🙏 × 3 from notification-body defaultValues in `check-reminders.ts`, 👤 from the orphaned `family.inviteForProfile` i18n key. All decorative meaning now carried by Ionicons.

### Phase 1 corrigendum close-out + UI polish (2026-06-03 follow-up session)

Mobile UX polish + the remaining Phase 1 audit item closed:

- **EmergencyContact priority-1 seeding (both paths)** — `apps/server/src/modules/household/household.service.ts` (`addHouseholdProfile`) wraps the sub-profile creation in a transaction and seeds the new profile's priority-1 `EmergencyContact` with the household primary's name + phone + `isGuardian:true` (defensive skip if the primary's phone is synthetic). Complementary hook in `apps/server/src/modules/family/family.service.ts` (`respondToInvite("accept")`): when a cross-household guardian accepts a FamilyLink invite, seed the patient's priority-1 EC with the guardian's phone IFF no priority-1 exists. New integration tests in `tests/integration/household.test.ts` (asserts the seed shape on profile creation) and `tests/integration/family.test.ts` (seed on accept, no-overwrite branch on pre-existing priority-1).
- **Check-frequency reminder copy is now condition-aware** — `apps/mobile/src/services/check-reminders.ts` exports `composeReminderCopy(conditions)`: sugar-only / BP-only / both, picked from the active profile's `conditions`. Single picker, single fire per slot. New `useEffect` in `app/_layout.tsx` re-runs `syncCheckReminders` on profile-id / conditions change so mid-session profile switches re-render the title. Preferences store passes `activeConditions()` to every reminder resync call.
- **TipsCarousel redesign** — `apps/mobile/src/components/insights/TipsCarousel.tsx` rewritten as a snap-paged `FlatList` (`decelerationRate="fast"`, `snapToInterval = card+gap`, peek of next card). Cards size to content (was `h-full` → looked half-empty), new card design (rounded icon halo + accent bottom stripe), active page-indicator dots beneath.
- **Profile switcher dark-mode polish** — closed gaps in `ProfileSwitcher.tsx` (inactive ring, label color), `ProfileSelectorModal.tsx` (active row bg, border, added selected check icon), `AddProfileModal.tsx`+`EditProfileModal.tsx` (label/icon color tokens).
- **Family tab hierarchy** — `apps/mobile/app/(tabs)/family.tsx` re-organised with a new hero card (`FamilyQuickSummary.tsx` rewritten to show live count + avatar stack + pending-invite callout), icon-chip section headers with count badges, iconified `EmptyState` card. Nothing removed.
- **Brand assets v2** — new `apps/mobile/scripts/generate-icons-v2.mjs` + `assets/images/icon-source.svg` produce a lotus + tilak + ECG pulse mark replacing the v1 generic heart. Pure-JS rasteriser (same plumbing as v1), all four PNG outputs regenerated. `pnpm --filter @swasth/mobile icon:build` runs v2; `icon:build:legacy` runs v1 for revert.
- **Mobile Settings → Emergency Contacts CRUD** (Phase 1 corrigendum, second half) — new screen at `apps/mobile/app/settings/emergency-contacts.tsx` lists contacts by priority with a tap-only ↑/↓ reorder (no drag — CLAUDE.md "core flows: TAP ONLY"), edit modal, delete confirm. Disabled "+ Add contact" once the 5-cap hits, with copy explaining why. Top of screen explains "Priority #1 sabse pehle call hoga". The household primary can manage a sub-profile's contacts because `targetUserId` is set from the active profile. Companion `apps/mobile/src/services/emergency-contacts.ts` is the typed client. `apps/mobile/src/components/settings/EmergencyContactModal.tsx` does add+edit in one form with inline E.164 validation. New "Safety" section on the Settings tab is the entry point. ~50 new `emergencyContacts.*` i18n keys (en + hi). Closes the Phase 1 corrigendum: every onboarding path now seeds priority-1 (server) AND users can manage the list (mobile).

### Phase 1/2 corrigenda + DX polish (2026-06-03) — *PR #125 open*

- **Rate-limit alert UI** (`apps/mobile/app/(tabs)/log.tsx`) — glucose save flow now distinguishes `RATE_LIMITED` from other rejections. New `rateLimited` state replaces the input region with an amber card (icon + "Aaj ka limit poori ho gayi" + "Dashboard dekhein" CTA) when the daily-readings cap is hit. Critical values still bypass the cap server-side, so the card never blocks a safety alert. New `logging.rateLimited.{title,body,cta}` i18n keys in en + hi.
- **Brand assets regenerated** — `apps/mobile/scripts/generate-icons.mjs` (new) renders real heart-with-ECG-pulse marks for all four required PNGs from a single pixel rasteriser, no native deps, 16× supersampled. Replaces the placeholder solid-color rectangles. The `notification-icon.png` fix is the highest-impact: prior file was opaque white everywhere → Android tinted the entire 96×96 rectangle as a colored square; new file is white silhouette on transparent so the tint paints only the heart shape.
- **Dark mode on log surfaces** — fixed real invisible-text bugs in `NumpadInput.tsx` (digit labels had no color → black-on-dark-gray invisible), `BPInput.tsx` (FieldChip active state was `bg-blue-50` only → white value text invisible on light blue in dark mode), `ConfirmationScreen.tsx` (5 bugs: warning text class collision, radio inner dot wrongly inheriting `dark:bg-gray-900`, festive toggle label uncolored, toggle ball dark-gray in dark mode, status card bgs missing dark variants), `BPConfirmationScreen.tsx` (high-BP warning had the same class collision), `VoiceInput.tsx` (loading placeholder `bg-gray-200` themed). `CriticalAlert.tsx` intentionally left alone (red/white safety surface, theme-independent by design).
- **Cold-start seed script** — `apps/server/prisma/seed-coldstart-users.ts` (new). Six free-tier users at stages 0/3/7/13/7/35: Anil/Sunita/Vikram/Lakshmi for stage-isolated testing, plus Rajesh (`+918349227777`, day 7, diabetes + HTN, poorly-controlled arc) and Priya (`+917509069999`, day 35, well-controlled, past full unlock so HbA1c + 30d trend detector fire) sharing phones with `seed-test-users.ts`. Whichever seed runs last wins; both idempotent. `createdAt` offset by `-1hr` so `Math.floor((now - createdAt)/86_400_000)` lands on the right side of the day boundary. Reading `measuredAt` uses negative hour offsets so day-0 readings are never in the future. Wired as `db:seed:coldstart-users` in `apps/server/package.json`.
- **`checkFrequency` wiring** — new `apps/mobile/src/services/check-reminders.ts`. `syncCheckReminders()` maps each frequency to the right `expo-notifications` trigger (DAILY / 2× WEEKLY Mon+Thu / WEEKLY Sun / 8× DATE for biweekly / MONTHLY day-1). Identifier prefix `check-*` so reconcile/cancel can discover everything without a separate index. `preferences.store.ts`: setters for `checkFrequency`/`notificationsEnabled`/`reminderTime` resync after `set()`. `onRehydrateStorage` resyncs on cold-start to refill the biweekly DATE-trigger queue. Server-side push reminders (best_log_time, streak-risk) remain independent — they're behaviour-aware and shouldn't be silenced by this setting. Top-level `notifications.glucoseCheck.{title,body}` i18n keys added in en + hi.
- **Preferences backend persistence** — new `UserPreferences` model + migration `20260602200000_user_preferences` (single row per user, PK on user_id, cascade-deletes with user, defaults match mobile store defaults). Server `users` module extended with `GET /users/me/preferences` (returns defaults when row missing) + `PUT /users/me/preferences` (upsert; strips `undefined` for strict-TS). New `apps/mobile/src/services/preferences.ts` (`fetchPreferences()` + `pushPreferences()`, both swallow errors so local AsyncStorage stays source of truth on network failures). `preferences.store.ts` setters push best-effort; new `hydrateFromServer()` action (server wins on mismatch, then resyncs local reminders); wired into `app/_layout.tsx` auth-aware effect. End-to-end verified: missing row → defaults; PUT partial body → persists only sent fields; explicit `null` distinguished from `undefined` (clears vs. don't-touch). Out of scope: `language` stays on `User.preferredLanguage` (existing path).
- **HbA1c response-shape bug** — mobile `services/health.ts` had hand-written `HbA1cEstimate` declaring `estimate`/`readingCount`/`weightedMeanMgDl`/`computedAt`; the actual `@swasth/domain-logic` shape uses `hba1cPercent`/`totalReadings`/`weightedAverageMgDl`/`computedAtIso`. TypeScript couldn't catch it because the type was a guess, not derived from source — surfaced at runtime as `estimate.toFixed is not a function (it is undefined)` on `HbA1cCard.tsx:114`. Fixed the type and cleaned up a defensive `typeof ... ? ... : "N/A"` ladder on the card. Follow-up: promote `HbA1cEstimate` to `@swasth/shared-types` so server + mobile import the same definition (separate refactor).

### UI Polish & Settings (2026-05-31) — *by Antigravity*
- PR #117 (2026-05-31) — Complete settings screen redesign with `ReminderTimePicker` and `CheckFrequencyPicker` modal flows (by Antigravity).
- PR #118 (2026-05-31) — NativeWind theme integration (`usePreferencesStore` linked to `setColorScheme`) with an `AnimatedThemeToggle` component for Light/Dark/System (by Antigravity).
- PR #119 (2026-05-31) — App-wide Dark Mode support executed via a comprehensive style injection script across 60+ UI files and dynamic Tab Bar colors (by Antigravity).
- PR #120 (2026-05-31) — Fixed generic black text overriding the dark mode theme across 35 UI files by injecting `dark:text-gray-100` into `text-hero` and `text-important` classes (by Antigravity).
- PR #121 (2026-05-31) — Fixed a UX edge-case where the Dashboard `InsightsBadge` teased "new patterns" prior to the 14-day unlock, preventing users from getting trapped on the "Insights Locked" screen (by Antigravity).
- **Architectural Decision (Multi-Profile Push Routing)**: Confirmed that for shared devices (e.g., 3 profiles managed on 1 phone), push notifications and SMS alerts for ALL profiles must route to the primary account's device/number. The push token is tied to the primary user's install, and the backend must route alerts for sub-profiles to this token (by Antigravity).
- PR #118 (2026-05-31) — Cleanup pass on the Antigravity rollup (#117–#121):
  - Dark mode rebuilt with a real 3-tier palette (page = `gray-950`, surface = `gray-900` + dark border, elevated = `gray-800`) — previously cards sat *below* the page bg, rendering as wells instead of elevated surfaces.
  - Removed `bg-gradient-to-br` cards that don't render in React Native (`FamilyQuickSummary`, `PatternSummaryCard`, `GuardianEmptyState`), replaced with flat `bg-*-50 dark:bg-*-950/40`.
  - Fixed class collisions (`text-critical text-gray-900`, `text-primary text-gray-900`), added missing dark variants across `InviteGuardianForm`, `EditProfileModal`, `ActiveProfileBadge` (now resolves icon colors via `useColorScheme`), `TipsCarousel`, `NotificationToggle`.
  - `ReminderTimePicker`: fixed the `settings.reminderTime.value` i18n key leaking the literal key string into the UI; added `accessibilityLabel` on hour/minute inputs.
  - Added ~50 missing i18n keys across `settings.*`, `insights.tips.*`, `insights.emptyState.*`, `insights.loggingProgress.*`, `guardian.emptyState.*`, `family.quickSummary.*` in both `en.json` and `hi.json` (Hindi-first, CLAUDE.md tone).
  - `LoggingProgressCard` wired to real data: fetches `GET /readings/glucose?from=-7d`, counts distinct local calendar days, surfaces X-of-7 with tiered color (green ≥70% / amber 40-69% / red <40%) and three copy variants. Soft-hides on fetch failure.
  - Server fix: `household.controller` was passing `req.params.id` (typed `string | string[]` under Express 5) directly to the service; `household.service` was throwing `DomainError("NOT_FOUND", …)` against an `ErrorCode` union that didn't include it. Added `HOUSEHOLD_PROFILE_NOT_FOUND` to `@swasth/shared-types` and mapped to 404 in the error handler.
  - Cleanup: deleted the one-shot `apps/mobile/fix_dark_text.js` codemod artifact; `.gitignore` now ignores `service-account-key.json`.
  - Lint debt closed on every touched file. Verify pipeline (`pnpm typecheck` × 5 projects, `pnpm lint`, `pnpm -r build`) green.


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

### Feature E cohort ramp checklist

Runbook: `docs/runbooks/feature-e-cohort-ramp.md`. Run the cardiac
ramp and the respiratory ramp in sequence, not parallel — a regression
in shared infra (critical-bypass chain, ANALYZE_READING worker, voice
parser dispatch) would taint both soak datasets and force a restart.

**Cardiac (`cardiac_logging_enabled`)**

- [ ] Stage 1 — Internal smoke (1 ops user, 24h). PostHog gates:
      `critical_bypass_triggered{surface=cardiac}` = 0,
      `fail_safe_triggered{scenario LIKE 'cardiac%'}` = 0.
- [ ] Stage 2 — Internal cohort (≤ 10 users with `cardiac` condition,
      7d). Zero false-alarm bypass rows. Zero new Sentry P1s tagged
      `category:cardiac`.
- [ ] Stage 3 — Percentage ramp: 5% → 25% → 50% → 100%, holding 24-48h
      between each step. Any false-alarm row → flip back to the
      previous percentage immediately.

**Respiratory (`respiratory_logging_enabled`)**

- [ ] Stage 1 — Internal smoke (1 ops user with asthma or COPD, 24h).
      Same PostHog gates with `surface=respiratory`.
- [ ] Stage 2 — Internal cohort (≤ 10 users, 7d). Same acceptance
      criteria as cardiac stage 2.
- [ ] Stage 3 — Percentage ramp: same step sizes and hold times as
      cardiac stage 3.

Both ramps share the kill-switch: `PUT /admin/flags/<key>` back to
`{"value": false}` immediately turns the surface off at the server
(`CARDIAC_DISABLED` / `RESPIRATORY_DISABLED`, 503) and the mobile
client renders the disabled copy from `cardiac.disabled` /
`respiratory.disabled` i18n keys.

### Emergency contacts go-live

- [x] (2026-06-03 follow-up) Build Settings → Emergency Contacts mobile screen (CRUD against `/api/v1/emergency-contacts`). Reorder via tap-only ↑/↓ swap with neighbour (no drag, per CLAUDE.md "core flows: TAP ONLY"). 48dp targets, Hindi-first copy. Active-profile aware via `targetUserId` so the household primary can manage sub-profile contacts. Files: `apps/mobile/src/services/emergency-contacts.ts` (typed client), `apps/mobile/src/components/settings/EmergencyContactModal.tsx` (add/edit form with E.164 inline validation), `apps/mobile/app/settings/emergency-contacts.tsx` (list + reorder + delete confirm). Entry point added under a new "Safety" section on the Settings tab. ~50 new i18n keys (en + hi).
- [x] (2026-06-03 follow-up) Wire guardian-assisted onboarding step to write an initial `EmergencyContact` row at priority 1 with `isGuardian: true` (CLAUDE.md line 171). Landed in `addHouseholdProfile` (household.service.ts) so creating a sub-profile seeds the new profile's priority-1 EC with the household primary's phone in the same transaction. Complementary hook landed in `respondToInvite("accept")` (family.service.ts) for the cross-household FamilyLink path.

### Pending — next session pickup

- [x] (2026-06-03) Land the 2026-06-03 working-tree changes as PR #125 — 8 commits, all 11 preflight gates green.
- [x] (2026-06-03 follow-up) **EmergencyContact priority-1 seeding on guardian-assisted onboarding** (CLAUDE.md:171). Last item from the original audit list. Landed in `apps/server/src/modules/household/household.service.ts` (`addHouseholdProfile` seeds priority-1 EC in same tx as profile creation; defensive skip for synthetic primary phones) AND in `apps/server/src/modules/family/family.service.ts` (`respondToInvite("accept")` seeds priority-1 EC for the patient with the accepting guardian's phone, IFF no priority-1 exists, with standard shift-cascade). New integration tests in `household.test.ts` and `family.test.ts` cover the seed + no-overwrite branches.
- [x] (2026-06-03 follow-up) Mobile Settings → Emergency Contacts CRUD screen — see "Emergency contacts go-live" checkbox above.
- [ ] Follow-up refactor: promote `HbA1cEstimate` to `@swasth/shared-types` so server + mobile share the type. Prevents this class of drift bug recurring. Small, independent — can land alongside or after the EmergencyContact PR.

---

## What's next (Week 14 close-out → Week 15 ramp)

Per `phase4.md` Week-14 row: **SOS real-call ramp + Feature E.1 + E.2**.

SOS real-call ramp stays operational (see checklist above). Feature E.1 chunk 1 + E.2 chunk 1 (schema + bypass classifiers + server modules + dispatch + integration tests) landed 2026-06-05 above. Remaining code work for Phase 4 Feature E:

### Feature E — mobile + remaining pure modules

Spec: `phase4.md §E.5` + `§E.2 (#3–#5)`.

1. **Activity dashboard widget + Sleep dashboard widget** — placeholders until Feature I ships `ActivityDaily` + `SleepLog`.

2. **Remaining pure modules** in `packages/domain-logic/src/`:
   - `activity-aggregator/` — `dailyActivitySummary(logs)`. Coupled to Feature I (ActivityDaily) → naturally lands Week 19.
   - `sleep-quality-classifier/` — coupled to SleepLog → Week 19.

3. **(Done 2026-06-07, chunk 7)** Mobile voice integration — cardiac + respiratory `VoiceInput` mode dispatch landed.

4. **Cohort ramp** (operational):
   - Flip `cardiac_logging_enabled` for a ≤10-user internal cohort.
   - Flip `respiratory_logging_enabled` same cohort.
   - After 7 days zero false-alarm, ramp by percentage.

---

## Risks / known unknowns

- **SOS soak might surface vendor issues.** Exotel Indian E.164 routing has been known to silently drop calls when the `CallerId` is unverified — verify before the soak starts.
- **Mobile push notifications are still flaky** until the user reinstalls on every affected device (existing broken `PushTooManyExperienceIds` tokens). The auto-prune from #114 helps but a stale install will keep re-registering the same broken token until reinstalled.
- **Activity-drop SG signal** stays score=0 until Feature I (Week 19). This is the only Phase 3 carry-over that's wired-but-dormant — fine, but Feature I is far away in the schedule.
- **Mobile schedule editor + emergency-contact screen** are both small Phase 1/2 corrigenda that keep getting deferred. They'll likely land alongside Feature G's doctor-portal mobile work (Week 17) unless prioritised sooner.
- **Prescription safety-validator is half-implemented (§F.6 / CLAUDE.md "dosage > 99% percentile OR frequency > 6×/day → needs_doctor").** The **frequency > 6×/day** gate is live on both the `/approve` and `/items` (manual-add) paths via `parseDailyDoseCount`. The **dosage > 99th-percentile** gate is NOT implemented — deliberately deferred: it needs either a curated per-drug max-safe-dose reference table or a production dosage population to compute a percentile against, and neither exists yet (`indian-brands.json` is a name-alias map with no dosage figures; the only `percentile()` helper is glucose-IQR in `detectors/stats.ts`). Hardcoding mg thresholds without clinical input would be worse than the gap. Revisit once a max-dose dataset is sourced (likely alongside Feature H's IndianFoodItem data work).

---

## How to use this file

- **After every PR merges**, append a one-line entry under "What shipped" with PR #, date, and one-sentence summary.
- **When a checklist item completes**, replace the `[ ]` with `[x]` and add the date in parens.
- **When a new feature track starts**, add it to the TL;DR table and to "What's next".
- **Don't duplicate spec content here.** Link to the `phase4.md §` section instead.
