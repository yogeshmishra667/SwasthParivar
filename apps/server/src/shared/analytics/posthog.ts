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
  critical_bypass_triggered: {
    value_mg_dl: number;
    severity: "low" | "high";
    push_targets: number;
    sms_targets: number;
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
