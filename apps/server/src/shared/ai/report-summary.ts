// Phase 4 Feature G.4 — Claude executive-summary wrapper for the
// pre-visit PDF report.
//
// Separate AI surface with its OWN spend cap, per CLAUDE.md "Spend-Cap
// Parity Across AI Surfaces":
//   Kill switch:  report_generation_enabled (default false)
//   Spend cap:    CLAUDE_REPORT_DAILY_SPEND_CAP_USD
//   Auto-flip:    on cap breach → report_generation_enabled=false + Sentry
//
// Safety: the model output goes through the SAME post-response
// `filterChatResponse` the patient chat uses. A summary that names a
// dosage, a diagnosis, or a start/stop directive is DROPPED entirely
// (the PDF renders without the paragraph) — we never substitute the
// chat "ask your doctor" copy into a clinician-facing report.
//
// Graceful degradation: every failure mode (flag off, no API key, cap
// tripped mid-call, upstream error, safety rejection) returns
// `{ text: null }`. The PDF still generates without the AI paragraph —
// the report is degraded, never failed.

import Anthropic from "@anthropic-ai/sdk";
import { filterChatResponse } from "@swasth/domain-logic";
import { env } from "../../config/env.js";
import { logger } from "../logger.js";
import { getFlag, setFlag } from "../flags/index.js";
import { redis } from "../redis.js";
import { capture as captureAnalyticsEvent } from "../analytics/posthog.js";
import { captureUnhandled as captureSentry } from "../observability/sentry.js";

export interface ReportSummaryInput {
  userId: string;
  language: "hi" | "en" | "hi-en";
  /** Non-PII textual digest of the report data (trends, adherence, etc.).
   * The caller assembles this from the already-redacted ReportModel. */
  digest: string;
}

export interface ReportSummaryResult {
  /** The safety-filtered summary, or null when omitted for any reason. */
  text: string | null;
  reason: "ok" | "disabled" | "no_api_key" | "safety_rejected" | "error";
}

const PRICING_USD_PER_M_TOKENS: Readonly<Record<string, { input: number; output: number }>> =
  Object.freeze({
    "claude-haiku-4-5": { input: 1.0, output: 5.0 },
    "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  });

const todayUtcKey = (now: Date): string => `ai_report_spend:${now.toISOString().slice(0, 10)}`;

const SYSTEM_PROMPT = [
  "You write a short executive summary of a chronic-care patient's recent",
  "health data for THEIR OWN DOCTOR to read before a visit. 3-4 sentences.",
  "Describe trends and discussion points only. ABSOLUTELY DO NOT: suggest or",
  "change any medication or dosage, diagnose a condition, or tell the patient",
  "to start/stop anything. Neutral, factual, non-alarming. If data is sparse,",
  "say so plainly.",
].join(" ");

let client: Anthropic | null = null;
const getClient = (): Anthropic | null => {
  if (client) return client;
  if (!env.CLAUDE_API_KEY) return null;
  client = new Anthropic({ apiKey: env.CLAUDE_API_KEY });
  return client;
};

// Test seam — inject a stub Anthropic client (or null to reset).
export const __setReportClientForTests = (override: Anthropic | null): void => {
  client = override;
};

const estimateCostUsd = (model: string, tokensInput: number, tokensOutput: number): number => {
  const pricing = PRICING_USD_PER_M_TOKENS[model];
  if (!pricing) return 0;
  return (tokensInput * pricing.input + tokensOutput * pricing.output) / 1_000_000;
};

const trackSpendAndMaybeTripCap = async (costUsd: number): Promise<void> => {
  const cents = Math.max(0, Math.round(costUsd * 100));
  if (cents === 0) return;
  const key = todayUtcKey(new Date());
  const total = await redis.incrby(key, cents);
  if (total === cents) await redis.expire(key, 60 * 60 * 36);
  const totalUsd = total / 100;
  if (totalUsd > env.CLAUDE_REPORT_DAILY_SPEND_CAP_USD) {
    await setFlag("report_generation_enabled", false, "system:report_spend_cap");
    logger.error(
      { totalUsd, capUsd: env.CLAUDE_REPORT_DAILY_SPEND_CAP_USD },
      "claude report daily spend cap reached — report_generation_enabled flipped off",
    );
    captureSentry(new Error("claude_report_spend_cap_reached"), {
      spend_usd: totalUsd,
      cap_usd: env.CLAUDE_REPORT_DAILY_SPEND_CAP_USD,
    });
    captureAnalyticsEvent("report_spend_cap_reached", "system", {
      spend_usd: totalUsd,
      cap_usd: env.CLAUDE_REPORT_DAILY_SPEND_CAP_USD,
    });
  }
};

export const generateReportSummary = async (
  input: ReportSummaryInput,
): Promise<ReportSummaryResult> => {
  const enabled = await getFlag<boolean>("report_generation_enabled", false);
  if (!enabled) return { text: null, reason: "disabled" };

  const c = getClient();
  if (!c) return { text: null, reason: "no_api_key" };

  try {
    const model = env.CLAUDE_MODEL_SONNET;
    const response = await c.messages.create({
      model,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: input.digest }],
    });

    await trackSpendAndMaybeTripCap(
      estimateCostUsd(model, response.usage.input_tokens, response.usage.output_tokens),
    );

    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    const raw = textBlock?.text?.trim() ?? "";
    if (raw.length === 0) return { text: null, reason: "error" };

    // Same post-response safety gate as patient chat. A clinician-facing
    // report is held to the SAME bar — no dosage directives, no diagnosis
    // claims. On a violation we drop the paragraph rather than substitute.
    const verdict = filterChatResponse({ content: raw, language: input.language });
    if (!verdict.safe) {
      logger.warn(
        { userId: input.userId, violations: verdict.violations },
        "report summary rejected by safety filter — omitting AI paragraph",
      );
      return { text: null, reason: "safety_rejected" };
    }

    return { text: raw, reason: "ok" };
  } catch (err) {
    logger.error({ err, userId: input.userId }, "report summary generation failed");
    return { text: null, reason: "error" };
  }
};
