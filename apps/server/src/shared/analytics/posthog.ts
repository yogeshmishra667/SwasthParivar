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
    value_mg_dl: number;
    severity: "low" | "high";
    push_targets: number;
    push_success: boolean;
    sms_targets: number;
    sms_triggered: boolean;
    sms_success: boolean;
    within_cooldown: boolean;
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
    source: "med_adherence" | "data_anomaly";
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
