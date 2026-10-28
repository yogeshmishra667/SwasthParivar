// PostHog server-side emitter — strongly-typed event surface for the
// Phase-1 retention metrics (CLAUDE.md Metrics section). The client is
// no-op when POSTHOG_API_KEY is missing, so dev/test runs stay quiet.
//
// Adding a new event: extend `EventName` + the matching properties type
// in `EventPropsMap` below. The dispatch helper keeps emit sites tidy.

import { PostHog } from "posthog-node";
import { env, isProd } from "../../config/env.js";
import { logger } from "../logger.js";

let client: PostHog | null = null;

const initClient = (): PostHog | null => {
  if (client) return client;
  if (!env.POSTHOG_API_KEY) return null;
  client = new PostHog(env.POSTHOG_API_KEY, {
    host: "https://us.i.posthog.com",
    flushAt: 20,
    flushInterval: 10_000,
  });
  return client;
};

// One narrow type per event keeps every emit site type-checked.
export interface EventPropsMap {
  reading_logged: {
    type: "fasting" | "pre_meal" | "post_meal" | "random" | "bedtime";
    source: "manual" | "voice" | "device";
    time_to_log_seconds: number | null;
    user_stage: number;
    streak_credited_to_server_time: boolean;
  };
  voice_attempt: {
    success: boolean;
    fallback: "numpad" | "none";
    confidence: number;
    colloquial_match: boolean;
    uncertainty_detected: boolean;
    rejected_reason: string | null;
  };
  // `push_success` / `sms_success` are the per-event delivery booleans
  // CLAUDE.md names; `sms_triggered` is the denominator the
  // `critical_bypass_sms_success_rate` developer alert (URGENT < 95%)
  // divides by — without it, events where SMS was never attempted
  // (push succeeded) would deflate the rate.
  critical_bypass_triggered: {
    // Glucose carries `value_mg_dl + severity`; cardiac/respiratory
    // carry `category + copy_key` (Phase 4 Feature E). All other
    // fields are common to every dispatch shape so the developer
    // alert (`critical_bypass_sms_success_rate`) keeps working across
    // categories without per-category branches.
    value_mg_dl?: number;
    severity?: "low" | "high";
    category?: "glucose" | "bp" | "cardiac" | "respiratory";
    copy_key?: string;
    push_targets: number;
    push_success: boolean;
    // Contacts whose OWN device received the push (the patient's device
    // never counts) and contacts texted because push didn't reach them.
    contacts_reached_by_push: number;
    sms_contacts: number;
    sms_targets: number;
    sms_triggered: boolean;
    sms_success: boolean;
    within_cooldown: boolean;
  };
  // Audit P33 — a critical reading that synced > 2h after it was taken:
  // the family got a late notice, not a live alert. Kept out of
  // `critical_bypass_triggered` so the live-alert SMS rate isn't skewed.
  critical_reading_late_notified: {
    category: "glucose" | "bp" | "cardiac" | "respiratory";
    minutes_late: number;
    push_success: boolean;
    contacts_reached_by_push: number;
    sms_contacts: number;
    sms_success: boolean;
  };
  // CLAUDE.md edge case #22 — one event per emergency contact texted by a
  // critical-bypass dispatch, so SMS delivery can be tracked per contact.
  critical_sms_per_contact: {
    contact_id: string;
    delivered: boolean;
  };
  streak_milestone: {
    milestone_days: number;
    longest_streak_days: number;
  };
  notification_sent: {
    trigger_type: string;
    variant_id: number | null;
    suppressed: boolean;
    suppress_reason: string | null;
  };
  // Audit P11 / P25 — anti-fatigue inputs (CLAUDE.md "Raw Events").
  notification_opened: {
    trigger_type: string;
    source: "push";
  };
  notification_ignored: {
    trigger_type: string;
    fatigue_level: number;
  };
  // Phase 3 chat — emitted by the Claude wrapper after every upstream
  // call. `tier` distinguishes haiku-cached from sonnet-cold; cost
  // dashboards pivot on it.
  ai_chat_response_generated: {
    tier: "cached" | "sonnet";
    model: string;
    tokens_input: number;
    tokens_output: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
    response_latency_ms: number;
    estimated_cost_usd: number;
  };
  ai_chat_circuit_opened: {
    failures_in_window: number;
    window_seconds: number;
  };
  ai_chat_spend_cap_reached: {
    spend_usd: number;
    cap_usd: number;
  };
  // Phase 4 Feature F — Claude Vision (prescription OCR) telemetry.
  // `prescription_ocr_call` fires for every Pass A / Pass B / clarification
  // pass; the dashboards pivot by `mode` to track per-pass cost + latency.
  prescription_ocr_call: {
    mode: "prescription_text" | "medicine_bottle" | "clarification_pass";
    model: string;
    image_count: number;
    tokens_input: number;
    tokens_output: number;
    response_latency_ms: number;
    estimated_cost_usd: number;
    prescription_id: string;
    request_id: string;
  };
  prescription_ocr_circuit_opened: {
    failures_in_window: number;
    window_seconds: number;
  };
  prescription_ocr_spend_cap_reached: {
    spend_usd: number;
    cap_usd: number;
  };
  // Emitted by the PRESCRIPTION_OCR worker after the row of
  // PrescriptionItem inserts lands. `item_count` is the number of
  // PrescriptionItems persisted (possibly 0 if Vision returned a
  // blank prescription — those move to `partial` so the approver can
  // hand-add via the F.5 `/items` route).
  prescription_ocr_completed: {
    prescription_id: string;
    item_count: number;
    bottle_count: number;
    page_count: number;
    request_id: string;
    // §F.6 delta runs set these — absent on the initial OCR pass.
    delta?: boolean;
    promotions?: number;
  };
  // Phase 4 §F.5 — fired by the upload route AFTER R2 + DB lands but
  // BEFORE BullMQ enqueue. Pivot by `requires_guardian_approval` and
  // `approver_reason` for the funnel.
  prescription_uploaded: {
    prescription_id: string;
    prescription_photos: number;
    medicine_photos: number;
    requires_guardian_approval: boolean;
    approver_friction_level: "none" | "high";
    approver_reason: string;
  };
  // Fired by the clarify route on enqueue. `source` distinguishes the
  // two F.5 clarification paths — bottle photo (high-confidence) vs
  // typed name (single-source YELLOW).
  prescription_clarified: {
    prescription_id: string;
    item_id: string;
    attempt_number: number;
    source: "bottle_photo" | "typed";
  };
  // Fired per-item from the approve route when the approver typed-in
  // verified fields that differ from the AI suggestion. `fields_changed`
  // is the array of `"name" | "dosage" | "frequency"` deltas.
  prescription_approver_corrected: {
    prescription_id: string;
    item_id: string;
    fields_changed: readonly string[];
  };
  // Fired by the approve route in the solo-patient branch. Drives the
  // "is solo-OCR error rate higher than guardian-OCR?" dashboard.
  prescription_self_approved: {
    prescription_id: string;
    items_count: number;
  };
  // Fired whenever the approver-authority gate blocks a write —
  // wrong-caller `/approve`, `/clarify`, or `/reject`. `caller_id_redacted`
  // is a non-reversible hash so dashboards can pivot on repeated
  // attempts without leaking the user id.
  prescription_approval_authority_blocked: {
    prescription_id: string;
    action: "approve" | "reject" | "clarify" | "append_photos" | "add_item";
    caller_id_redacted: string;
    requires_guardian_approval: boolean;
  };
  // Phase 4 §F.12 — fired once per item the OCR (or OCR-delta) job parks
  // in `need_clarification`. Feeds the developer alert "need_clarification
  // rate > 20%/week → handwriting / photo-quality issue". `reason` is the
  // classifier verdict (e.g. `no_bottle_low_confidence`).
  prescription_need_clarification_item: {
    itemId: string;
    reason: string;
  };
  // Phase 4 Feature G — fired by the appointments service when a visit is
  // booked. `days_until` is floor((scheduled_at - now)/1d); negative when
  // back-dating a past visit (allowed — e.g. logging a completed visit).
  // Drives the "are reminders firing for near-term appointments?" funnel.
  appointment_created: {
    appointment_id: string;
    doctor_id: string;
    days_until: number;
  };
  // Fired by the APPOINTMENT_REMINDER cron once per window it sends.
  // `window` is the lead bucket; `channel` is "push" when a household
  // token received it, "none" when zero tokens were available (the
  // on-device local reminder still fires — the server path is just dead).
  appointment_reminder_sent: {
    appointment_id: string;
    window: "7d" | "1d" | "2h";
    channel: "push" | "none";
  };
  // Phase 4 Feature G.4 — fired by the reports service when a generation
  // is enqueued (distinctId = the patient).
  report_requested: {
    report_id: string;
    has_appointment: boolean;
  };
  // Fired by the GENERATE_PDF worker after the PDF lands in R2.
  report_generated: {
    report_id: string;
    appointment_id: string | null;
    ai_summary_included: boolean;
    generation_ms: number;
  };
  // Parity with ai_chat_spend_cap_reached — fired when the report-summary
  // daily cap trips and report_generation_enabled is auto-flipped off.
  report_spend_cap_reached: {
    spend_usd: number;
    cap_usd: number;
  };
  // Fired by the CHAT_SAFETY_REVIEW worker after persisting the
  // human-audit row. Drives the safety-review dashboard +
  // weekly-flag-rate alarm.
  ai_chat_safety_filter_rejected: {
    message_id: string;
    violations: string[];
    cost_tier: string;
    flag_reason: string;
  };
  // Phase 3 Feature C — emitted by the SILENT_GUARDIAN_ANALYZE worker:
  // one `signal_detected` per persisted SilentGuardianSignal, one
  // `alert_created` per fired GuardianAlert. distinctId is the patient.
  silent_guardian_signal_detected: {
    source:
      | "med_adherence"
      | "data_anomaly"
      | "chat_sentiment"
      | "schedule_miss"
      | "activity_drop"
      | "cross_signal";
    type: string;
    contribution: number;
  };
  silent_guardian_alert_created: {
    severity: "yellow" | "orange";
    type: "trend_concern" | "med_adherence" | "combined";
    signal_count: number;
  };
  // Phase 3 Feature C — emitted by the GUARDIAN_ALERT_DISPATCH worker
  // (dispatched / suppressed) and the guardian-alert endpoints
  // (read / feedback). distinctId is the patient.
  silent_guardian_alert_dispatched: {
    severity: "yellow" | "orange";
    type: "trend_concern" | "med_adherence" | "combined";
    push_success: boolean;
    sms_success: boolean;
  };
  silent_guardian_dedup_suppressed: {
    reason: string;
    severity: "yellow" | "orange";
    type: "trend_concern" | "med_adherence" | "combined";
  };
  silent_guardian_alert_read: {
    minutes_to_read: number;
  };
  silent_guardian_alert_feedback: {
    helpful: boolean;
    action_taken: string;
  };
  // CC.12.6 — emitted by setFlag on every flag write so a rollout or
  // rollback lands on the same dashboards as the feature's own metrics.
  // The Redis audit log remains the system-of-record.
  feature_flag_changed: {
    key: string;
    rollout_kind: "boolean" | "cohort" | "percentage" | "cohort_or_percentage" | "other";
    by: string;
  };
  // Phase 4 Feature D' — SOS scaffold events. distinctId is the
  // patient. `test_mode` is the snapshot read off the SOSEvent row at
  // emit time so dashboards can pivot test-mode vs real-call traffic.
  sos_triggered: {
    sos_event_id: string;
    source: "patient_manual" | "critical_bypass_escalation" | "guardian_initiated";
    has_location: boolean;
    location_accuracy_m: number | null;
    test_mode: boolean;
  };
  sos_stage_transition: {
    sos_event_id: string;
    from: string;
    to: string;
    reason: string;
    elapsed_seconds: number;
    test_mode: boolean;
    contacts_in_stage: number;
  };
  sos_cancelled: {
    sos_event_id: string;
    stage: string;
    by: "patient" | "guardian";
    elapsed_seconds: number;
  };
  sos_resolved: {
    sos_event_id: string;
    by: "patient" | "guardian" | "admin";
    elapsed_seconds: number;
    false_alarm: boolean;
  };

  // Phase 2 carry-over (Week 17) — health-check schedules surface.
  // `schedule_created` fires on POST, `schedule_updated` on PUT.
  // `schedule_compliance_evaluated` is emitted by the hourly cron, ONE
  // row per (user, schedule) so the dashboard can pivot adherence by
  // check_type. distinctId is the patient.
  schedule_created: {
    schedule_id: string;
    check_type: "glucose" | "bp" | "cardiac" | "respiratory";
    frequency: "daily" | "weekly";
    slot_count: number;
    reminder_enabled: boolean;
  };
  schedule_updated: {
    schedule_id: string;
    active: boolean;
    fields_changed: string[];
  };
  schedule_compliance_evaluated: {
    schedule_id: string;
    check_type: "glucose" | "bp" | "cardiac" | "respiratory";
    on_time_count: number;
    late_count: number;
    missed_count: number;
    pending_count: number;
  };
  // Emitted whenever a push-sending worker resolves zero recipients
  // — the user/household never registered a device token, or all
  // tokens were pruned by Expo's DeviceNotRegistered cleanup.
  // distinctId is the patient.
  //
  // `surface` identifies which worker emitted (so dashboards can pivot
  // by feature: a spike in `critical_alert` zero-recipient is medically
  // urgent; a spike in `med_reminder` is just an opportunity to ask
  // users to reinstall). `reason` separates "no tokens in household"
  // from "resolved recipients had no tokens" — same outcome,
  // different ops response.
  //
  // Admin "test-push" emits with `surface: "admin_test"` and
  // `reason: "no_tokens"` when the target user has no devices.
  push_zero_recipients: {
    surface:
      | "critical_alert"
      | "med_reminder"
      | "notification_trigger"
      | "guardian_alert_dispatch"
      | "daily_guardian_summary"
      | "admin_test";
    reason: "no_tokens_in_household" | "no_tokens_for_resolved_recipients" | "no_tokens";
    // Phase 4 Feature E — multi-condition critical-bypass shares the
    // same `critical_alert` surface; the category disambiguates which
    // chain ran. Optional so the historical glucose-only emission
    // shape continues to validate unchanged.
    category?: "glucose" | "bp" | "cardiac" | "respiratory";
    household_size: number;
  };
  // Emitted by the admin "Send test push" endpoint. distinctId is the
  // target patient (not the admin). The admin actor lands in the audit
  // log via AdminAuditLog; this event powers a delivery-rate dashboard.
  admin_test_push: {
    admin_id: string;
    target_user_id: string;
    tokens_sent: number;
    success_count: number;
  };
  // Phase 4 Feature K — tier transition (CLAUDE.md "Payment" + phase4.md
  // §K.4). Powers MRR / churn dashboards. `reason` distinguishes a paid
  // upgrade from the various downgrade paths.
  tier_changed: {
    from: "free" | "premium" | "family";
    to: "free" | "premium" | "family";
    // `expired` = the paid period lapsed (completed/expired, or the
    // RAZORPAY_RECONCILIATION lapsed-cancellation downgrade).
    reason: "purchase" | "renewal" | "cancelled" | "refund" | "past_due" | "grace" | "expired";
    provider: "razorpay" | "apple_iap" | "manual";
  };
  // Emitted once per signature-verified webhook the worker acts on.
  payment_webhook_processed: {
    provider: "razorpay" | "apple_iap" | "manual";
    event_type: string;
    action: string;
    idempotent_replay: boolean;
  };
  // Phase 4 §K — one summary per RAZORPAY_RECONCILIATION run.
  payment_reconciliation_completed: {
    ran_api_pass: boolean;
    scanned: number;
    corrected: number;
    lapsed_downgraded: number;
    unresolved: number;
    errors: number;
  };
}

export type EventName = keyof EventPropsMap;

export const capture = <E extends EventName>(
  event: E,
  distinctId: string,
  properties: EventPropsMap[E],
): void => {
  const c = initClient();
  if (!c) return;
  try {
    c.capture({
      distinctId,
      event,
      properties: {
        ...properties,
        env: env.NODE_ENV,
      },
    });
  } catch (err) {
    // Never let analytics emission throw into a request path. Log + move on.
    logger.warn({ err, event }, "posthog capture failed");
  }
};

export const shutdownAnalytics = async (): Promise<void> => {
  if (!client) return;
  await client.shutdown();
  client = null;
};

export const warnIfMisconfigured = (warn: (msg: string) => void): void => {
  if (isProd && !env.POSTHOG_API_KEY) {
    warn("POSTHOG_API_KEY missing in production — retention metrics will not be captured");
  }
};
