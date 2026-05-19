/**
 * Phase 3 — AI Chat (Claude wrapper)
 * Kill switch flag: ai_chat_enabled (gated upstream in chat.service.ts)
 *                   ai_chat_tier3_enabled (gated here for `sonnet` tier)
 * Rollback runbook: docs/runbooks/rollback.md#chat
 * Owner: @phase3-chat-team
 *
 * Anthropic SDK wrapper. The chat service hands this function a
 * sanitised `PatientContext` (compile-time guarded — see below) and a
 * tier; the wrapper picks the model, enforces a hard 12s timeout, runs
 * the circuit breaker + daily spend cap, and emits the response with
 * Sentry breadcrumbs and PostHog telemetry. The SDK handles 429/5xx
 * retries with backoff out of the box (default max_retries=2), so we
 * never reimplement that.
 *
 * What stays out of this file (by design):
 *   - Idempotency on `clientUuid` — handled in chat.service via
 *     shared/idempotency.ts. The wrapper is a black box: same input →
 *     fresh Claude call.
 *   - The Post-Response Safety Filter — runs *after* this returns, in
 *     chat.service. Pure function from @swasth/domain-logic.
 *   - Tier-1 template routing — happens before the wrapper is invoked.
 */

import Anthropic from "@anthropic-ai/sdk";
import { DomainError } from "@swasth/shared-types";
import type { ChatCondition, ChatLanguage } from "@swasth/shared-types";
import { env } from "../../config/env.js";
import { logger } from "../logger.js";
import { redis } from "../redis.js";
import { capture as captureAnalyticsEvent } from "../analytics/posthog.js";
import { captureUnhandled as captureSentry } from "../observability/sentry.js";
import { setFlag } from "../flags/index.js";
import * as Sentry from "@sentry/node";

// ─────────────────────────────────────────────────────────────────────
// PatientContext — compile-time PII guard (CC.11 §4 in phase3.md)
//
// The wrapper REFUSES to take a raw User row. By accepting only this
// narrow shape, the type system forbids the most common PII leak: a
// caller passing `user` straight through after a Prisma fetch. Add a
// field here only after auditing what Claude would see in the rendered
// prompt — phone, aadhaar, household_id, and guardian names MUST NOT
// appear.
// ─────────────────────────────────────────────────────────────────────

export interface PatientContext {
  // Stable per-user identifier used by Claude only for "remember the
  // patient across messages in this session". Not the database UUID —
  // the chat service hashes the userId before constructing the
  // context.
  readonly anonymizedId: string;
  // Coarsened — never the exact birthdate or age.
  readonly ageRange: "under_50" | "50_59" | "60_69" | "70_plus";
  readonly conditions: readonly ("diabetes" | "hypertension" | "asthma" | "cardiac")[];
  // Last N readings the chat service judged relevant. Reading values
  // are not PII; the patient's name / phone / address are.
  readonly recentReadings: readonly {
    readonly type: string;
    readonly value: number;
    readonly measuredAtIso: string;
  }[];
  readonly language: ChatLanguage;
  readonly condition: ChatCondition;
}

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

export type ClaudeTier = "cached" | "sonnet";

export interface GenerateResponseInput {
  readonly tier: ClaudeTier;
  readonly systemPrompt: string;
  readonly patientContext: PatientContext;
  readonly userMessage: string;
  // Conversation history (server-side filtered to last N turns from
  // the same session). Each role/content pair becomes a Claude message.
  readonly conversationHistory?: readonly {
    readonly role: "user" | "assistant";
    readonly content: string;
  }[];
  // Telemetry — server-side identifiers, NEVER sent to Claude.
  readonly userId: string;
  readonly sessionId: string;
  readonly requestId: string;
}

export interface ClaudeResponse {
  readonly content: string;
  readonly model: string;
  readonly tokensInput: number;
  readonly tokensOutput: number;
  readonly cacheReadInputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly responseLatencyMs: number;
}

// ─────────────────────────────────────────────────────────────────────
// Circuit breaker + spend cap config — kept inline so behaviour is
// auditable in one place. If any of these need to be runtime-tunable
// they should move to flag service, not env.
// ─────────────────────────────────────────────────────────────────────

const CIRCUIT_FAIL_THRESHOLD = 5;
const CIRCUIT_FAIL_WINDOW_SECONDS = 60;
const CIRCUIT_OPEN_DURATION_SECONDS = 5 * 60;
const FAIL_KEY = `ai_circuit:fail_count:${env.NODE_ENV}` as const;
const OPEN_KEY = `ai_circuit:open_until:${env.NODE_ENV}` as const;

// Approximate per-million-token pricing in USD as of 2026-05-19. The
// wrapper uses this for spend tracking only; the real bill comes from
// the API console. Reverify against the model catalogue in
// shared/models.md before bumping in production.
const PRICING_USD_PER_M_TOKENS: Readonly<Record<string, { input: number; output: number }>> =
  Object.freeze({
    "claude-haiku-4-5": { input: 1.0, output: 5.0 },
    "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  });

const todayUtcKey = (now: Date): string => `ai_spend:${now.toISOString().slice(0, 10)}`;

// Lazy SDK construction — keeps test runs from instantiating a real
// client when `CLAUDE_API_KEY` is unset. The chat service is the only
// caller; it gates on `ai_chat_enabled` before reaching the wrapper.
let client: Anthropic | null = null;
const getClient = (): Anthropic => {
  if (client) return client;
  if (!env.CLAUDE_API_KEY) {
    throw new DomainError(
      "INTERNAL_ERROR",
      "CLAUDE_API_KEY is unset — cannot reach the model. Disable ai_chat_enabled.",
    );
  }
  client = new Anthropic({ apiKey: env.CLAUDE_API_KEY });
  return client;
};

// Override hook for unit tests — keeps the production path free of
// branching on NODE_ENV inside the request loop.
export const __setClaudeClientForTests = (override: Anthropic | null): void => {
  client = override;
};

const modelFor = (tier: ClaudeTier): string =>
  tier === "sonnet" ? env.CLAUDE_MODEL_SONNET : env.CLAUDE_MODEL_HAIKU;

// ─────────────────────────────────────────────────────────────────────
// Circuit breaker
// ─────────────────────────────────────────────────────────────────────

const ensureCircuitClosed = async (): Promise<void> => {
  const openUntil = await redis.get(OPEN_KEY);
  if (!openUntil) return;
  const openUntilMs = Number.parseInt(openUntil, 10);
  if (Number.isFinite(openUntilMs) && openUntilMs > Date.now()) {
    throw new DomainError(
      "CHAT_CIRCUIT_OPEN",
      "AI chat upstream is degraded; falling back to template responses.",
      { open_until_ms: openUntilMs },
    );
  }
};

const recordFailure = async (): Promise<void> => {
  const count = await redis.incr(FAIL_KEY);
  if (count === 1) await redis.expire(FAIL_KEY, CIRCUIT_FAIL_WINDOW_SECONDS);
  if (count >= CIRCUIT_FAIL_THRESHOLD) {
    const openUntilMs = Date.now() + CIRCUIT_OPEN_DURATION_SECONDS * 1000;
    await redis.set(OPEN_KEY, String(openUntilMs), "EX", CIRCUIT_OPEN_DURATION_SECONDS);
    await redis.del(FAIL_KEY);
    logger.error(
      { failures: count, openUntilMs },
      "claude circuit breaker opened — degrading to template fallback",
    );
    captureSentry(new Error("claude_circuit_opened"), {
      failures_in_window: count,
      open_until_ms: openUntilMs,
    });
    captureAnalyticsEvent("ai_chat_circuit_opened", "system", {
      failures_in_window: count,
      window_seconds: CIRCUIT_FAIL_WINDOW_SECONDS,
    });
  }
};

const recordSuccess = async (): Promise<void> => {
  // Success in the window resets the counter — we only open after
  // CIRCUIT_FAIL_THRESHOLD *consecutive* failures in the window. A
  // single recovery clears the slate, matching phase3.md A.3.
  await redis.del(FAIL_KEY);
};

// ─────────────────────────────────────────────────────────────────────
// Daily spend cap
// ─────────────────────────────────────────────────────────────────────

const estimateCostUsd = (model: string, tokensInput: number, tokensOutput: number): number => {
  const pricing = PRICING_USD_PER_M_TOKENS[model];
  if (!pricing) return 0;
  return (tokensInput * pricing.input + tokensOutput * pricing.output) / 1_000_000;
};

const trackSpendAndMaybeTripCap = async (costUsd: number): Promise<void> => {
  // Redis stores cents (integers) to avoid FP drift across many INCRBYs.
  const cents = Math.max(0, Math.round(costUsd * 100));
  if (cents === 0) return;
  const key = todayUtcKey(new Date());
  const total = await redis.incrby(key, cents);
  // Set TTL only on first write. INCRBY returns the new value; if the
  // key was just created its TTL is -1 (none) — guard cheaply.
  if (total === cents) await redis.expire(key, 60 * 60 * 36);
  const totalUsd = total / 100;
  if (totalUsd > env.CLAUDE_DAILY_SPEND_CAP_USD) {
    // Auto-disable Tier 3 (Sonnet). Tier 1/2 still flow. Idempotent —
    // setFlag with the same value is a no-op against the cached
    // value; flag service emits an audit entry either way.
    await setFlag("ai_chat_tier3_enabled", false, "system:spend_cap");
    logger.error(
      { totalUsd, capUsd: env.CLAUDE_DAILY_SPEND_CAP_USD },
      "claude daily spend cap reached — ai_chat_tier3_enabled flipped off",
    );
    captureSentry(new Error("claude_spend_cap_reached"), {
      spend_usd: totalUsd,
      cap_usd: env.CLAUDE_DAILY_SPEND_CAP_USD,
    });
    captureAnalyticsEvent("ai_chat_spend_cap_reached", "system", {
      spend_usd: totalUsd,
      cap_usd: env.CLAUDE_DAILY_SPEND_CAP_USD,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────
// Prompt assembly — prompt-caching layout
//
// Render order is tools → system → messages. We have no tools, so the
// caching prefix is `system`. Two system blocks:
//   1. Static system prompt — cached across users for the cohort.
//   2. PatientContext block — cached per session (stable for the
//      duration of a session; recentReadings refresh on each call but
//      stay short).
//
// We put the breakpoint on the patient-context block so both blocks
// land in the same cache entry. See shared/prompt-caching.md.
// ─────────────────────────────────────────────────────────────────────

const renderPatientContextBlock = (ctx: PatientContext): string => {
  const lines = [
    `Patient profile (anonymised):`,
    `- conditions: ${ctx.conditions.join(", ") || "none recorded"}`,
    `- age band: ${ctx.ageRange}`,
    `- preferred language: ${ctx.language}`,
    `- chat condition bucket: ${ctx.condition}`,
    ``,
    `Recent readings (most recent first, max ${ctx.recentReadings.length}):`,
    ...ctx.recentReadings.map((r) => `- ${r.measuredAtIso}: ${r.type} = ${r.value}`),
  ];
  return lines.join("\n");
};

// ─────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────

export const generateResponse = async (input: GenerateResponseInput): Promise<ClaudeResponse> => {
  await ensureCircuitClosed();

  const model = modelFor(input.tier);
  const c = getClient();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.CHAT_HARD_TIMEOUT_MS);
  const startedAt = Date.now();

  Sentry.addBreadcrumb({
    category: "ai_chat",
    message: "claude.generate",
    level: "info",
    data: {
      tier: input.tier,
      model,
      session_id: input.sessionId,
      request_id: input.requestId,
      // No content, no user text — by construction.
    },
  });

  try {
    const response = await c.messages.create(
      {
        model,
        max_tokens: 1024,
        system: [
          { type: "text", text: input.systemPrompt },
          {
            type: "text",
            text: renderPatientContextBlock(input.patientContext),
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [
          ...(input.conversationHistory ?? []).map((m) => ({
            role: m.role,
            content: m.content,
          })),
          { role: "user", content: input.userMessage },
        ],
        metadata: { user_id: input.patientContext.anonymizedId },
      },
      {
        signal: controller.signal,
        // SDK retries 429/5xx automatically (default max_retries=2);
        // we don't reimplement.
      },
    );

    // Narrow the first content block — chat replies are always text.
    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    const content = textBlock?.text ?? "";
    const usage = response.usage;
    const result: ClaudeResponse = {
      content,
      model,
      tokensInput: usage.input_tokens,
      tokensOutput: usage.output_tokens,
      cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
      responseLatencyMs: Date.now() - startedAt,
    };

    await recordSuccess();
    const estimatedCostUsd = estimateCostUsd(model, result.tokensInput, result.tokensOutput);
    await trackSpendAndMaybeTripCap(estimatedCostUsd);

    captureAnalyticsEvent("ai_chat_response_generated", input.userId, {
      tier: input.tier,
      model,
      tokens_input: result.tokensInput,
      tokens_output: result.tokensOutput,
      cache_read_input_tokens: result.cacheReadInputTokens,
      cache_creation_input_tokens: result.cacheCreationInputTokens,
      response_latency_ms: result.responseLatencyMs,
      estimated_cost_usd: estimatedCostUsd,
    });

    return result;
  } catch (err) {
    // AbortController.abort() lands here as either an SDK
    // APIUserAbortError or a plain DOMException. Either way the
    // wrapper raises the project's typed timeout error.
    if (
      err instanceof Anthropic.APIUserAbortError ||
      (err instanceof Error && err.name === "AbortError")
    ) {
      await recordFailure();
      throw new DomainError(
        "CHAT_UPSTREAM_TIMEOUT",
        `Claude exceeded the ${env.CHAT_HARD_TIMEOUT_MS}ms hard timeout.`,
      );
    }
    // Typed SDK exceptions — record as circuit failures so persistent
    // upstream issues open the breaker. Don't re-wrap as DomainError
    // here; the chat service catches the API error and decides whether
    // to fall back to Tier 1 or surface to the user.
    if (err instanceof Anthropic.APIError) {
      await recordFailure();
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
};
