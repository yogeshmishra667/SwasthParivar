/**
 * Phase 4 Feature F — Claude Vision wrapper (prescription OCR + bottle
 * cross-check).
 *
 * Kill switch flag:    `prescription_ocr_enabled` (gated upstream in the
 *                      F.4 BullMQ job + the F.5 upload route)
 * Auto-flip:           on `CLAUDE_VISION_DAILY_SPEND_CAP_USD` breach
 * Rollback runbook:    docs/runbooks/prescription-ocr-incident.md
 * Owner:               @phase4-prescriptions
 *
 * Two Vision passes power the prescription pipeline (phase4.md §F.3):
 *
 *   - Pass A — `mode: "prescription_text"`: Vision reads a prescription
 *     PAGE photo and extracts a list of `{name, dosage, frequency,
 *     confidence}` rows. Multiple rows per page is normal.
 *
 *   - Pass B — `mode: "medicine_bottle"`: Vision reads ONE bottle photo
 *     and returns the single best guess at the medicine name. Used by
 *     `prescription-paired-reconciliation` to validate (or flag) the
 *     Pass-A reading.
 *
 *   - Clarification — `mode: "clarification_pass"`: re-runs Pass B for
 *     ONE item the approver flagged via `POST /prescriptions/:id/items/
 *     :itemId/clarify`. Same output shape as Pass B. Per-item
 *     idempotency belongs to the F.4 job that consumes this.
 *
 * What stays out of this file (by design):
 *   - The reconciliation between Pass A and Pass B — pure function in
 *     `@swasth/domain-logic/prescription-paired-reconciliation` (F.3).
 *   - The color classification — pure function in
 *     `@swasth/domain-logic/prescription-color-classifier` (F.2 on main).
 *   - Idempotency / retry semantics — the BullMQ worker (F.4) handles
 *     those. The wrapper is a black box: same image bytes → fresh
 *     Vision call.
 *   - Image upload to R2 — happens BEFORE this wrapper is invoked. The
 *     wrapper accepts presigned URLs or raw base64 payloads.
 */

import Anthropic from "@anthropic-ai/sdk";
import { DomainError } from "@swasth/shared-types";
import { env } from "../../config/env.js";
import { logger } from "../logger.js";
import { redis } from "../redis.js";
import { capture as captureAnalyticsEvent } from "../analytics/posthog.js";
import { captureUnhandled as captureSentry } from "../observability/sentry.js";
import { setFlag } from "../flags/index.js";
import * as Sentry from "@sentry/node";

// ─────────────────────────────────────────────────────────────────────
// PrescriptionContext — compile-time PII guard
//
// Same defensive pattern as `PatientContext` in claude.ts. The wrapper
// REFUSES to take a raw User / Prescription row. Vision sees ONLY the
// patient's anonymised id + the image; nothing in this shape can leak
// phone, address, household id, or guardian names into the prompt.
// ─────────────────────────────────────────────────────────────────────

export interface PrescriptionContext {
  readonly anonymizedPatientId: string;
  readonly prescriptionId: string;
}

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

export type VisionMode = "prescription_text" | "medicine_bottle" | "clarification_pass";

export type VisionImageInput =
  | { readonly kind: "url"; readonly url: string }
  | { readonly kind: "base64"; readonly mediaType: Base64MediaType; readonly data: string };

/**
 * MIME types accepted by the Vision API per Anthropic SDK
 * `Base64ImageSource.media_type`. Anything else is rejected at the
 * wrapper boundary so a typo in the upload route surfaces here, not
 * 600ms into the Vision call.
 */
export type Base64MediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

export interface VisionRequestInput {
  readonly mode: VisionMode;
  readonly images: readonly VisionImageInput[];
  readonly context: PrescriptionContext;
  /**
   * Telemetry — server-side identifiers, NEVER sent to Vision.
   */
  readonly userId: string;
  readonly requestId: string;
}

export interface PrescriptionLineCandidate {
  readonly name: string;
  readonly dosage: string;
  readonly frequency: string;
  /** Vision-reported confidence on this row, clamped to `[0, 1]`. */
  readonly confidence: number;
  /**
   * Alternate readings ordered by confidence DESC. Empty when Vision
   * had no second-best guess. Surfaced to the approver UI as a
   * one-tap "swap" list.
   */
  readonly alternatives: readonly { name: string; confidence: number }[];
}

export interface BottleCandidate {
  readonly aiReadName: string;
  readonly confidence: number;
}

export type VisionResponse =
  | {
      readonly mode: "prescription_text";
      readonly lines: readonly PrescriptionLineCandidate[];
      readonly meta: VisionResponseMeta;
    }
  | {
      readonly mode: "medicine_bottle";
      readonly bottle: BottleCandidate;
      readonly meta: VisionResponseMeta;
    }
  | {
      readonly mode: "clarification_pass";
      readonly bottle: BottleCandidate;
      readonly meta: VisionResponseMeta;
    };

export interface VisionResponseMeta {
  readonly model: string;
  readonly tokensInput: number;
  readonly tokensOutput: number;
  readonly responseLatencyMs: number;
  /** Raw text the model returned, before JSON parsing. Stored in `Prescription.ocrRawResult` for audit replay. */
  readonly rawText: string;
}

// ─────────────────────────────────────────────────────────────────────
// Circuit breaker — separate from the chat circuit. A Vision outage
// MUST NOT degrade chat, and vice versa. Same key shape; different
// namespace.
// ─────────────────────────────────────────────────────────────────────

const CIRCUIT_FAIL_THRESHOLD = 5;
const CIRCUIT_FAIL_WINDOW_SECONDS = 60;
const CIRCUIT_OPEN_DURATION_SECONDS = 5 * 60;
const FAIL_KEY = `vision_circuit:fail_count:${env.NODE_ENV}` as const;
const OPEN_KEY = `vision_circuit:open_until:${env.NODE_ENV}` as const;

// Pricing snapshot per `claude.ts` — same SDK accounting model. Vision
// counts image tokens as input_tokens; we don't need a separate per-
// image surcharge.
const PRICING_USD_PER_M_TOKENS: Readonly<Record<string, { input: number; output: number }>> =
  Object.freeze({
    "claude-haiku-4-5": { input: 1.0, output: 5.0 },
    "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  });

const todayUtcKey = (now: Date): string => `vision_spend:${now.toISOString().slice(0, 10)}`;

// Lazy SDK client — keeps `pnpm test` from instantiating a real client
// when `CLAUDE_API_KEY` is unset. Vision uses the SAME API key as chat;
// no separate credential.
let client: Anthropic | null = null;
const getClient = (): Anthropic => {
  if (client) return client;
  if (!env.CLAUDE_API_KEY) {
    throw new DomainError(
      "INTERNAL_ERROR",
      "CLAUDE_API_KEY is unset — cannot reach Vision. Disable prescription_ocr_enabled.",
    );
  }
  client = new Anthropic({ apiKey: env.CLAUDE_API_KEY });
  return client;
};

// Override hook for unit tests — keeps the production path free of
// branching on NODE_ENV inside the request loop.
export const __setClaudeVisionClientForTests = (override: Anthropic | null): void => {
  client = override;
};

// Vision uses Sonnet by default — handwritten Hindi-English prescriptions
// are too noisy for Haiku to read reliably. Override via env if needed.
const visionModel = (): string => env.CLAUDE_MODEL_SONNET;

// ─────────────────────────────────────────────────────────────────────
// Prompts — kept inline so the system prompt is auditable in one file.
// ─────────────────────────────────────────────────────────────────────

const PRESCRIPTION_TEXT_SYSTEM_PROMPT = `You are a careful medical OCR assistant. The user will send a photo of a doctor's prescription (Indian context; mix of English and Hindi-script medicine names is common). Extract every medicine line.

Return ONLY a JSON object of this exact shape:
{
  "lines": [
    {
      "name": "string — medicine name as written, with brand if present",
      "dosage": "string — dose strength + form (e.g. '500 mg tab', '10 mL syrup'); empty string if unreadable",
      "frequency": "string — frequency text (e.g. 'twice daily', '1-0-1', 'BD'); empty string if unreadable",
      "confidence": number /* in [0, 1] reflecting how legible the line was */,
      "alternatives": [{"name": "string", "confidence": number}]
    }
  ]
}

Rules:
- If the prescription is blank or unreadable, return {"lines": []}.
- Never invent medicines that aren't visibly on the page.
- "alternatives" is for second-best readings of the SAME line; leave empty when there is no plausible alternative.
- No prose, no apology, no markdown — JSON only.`;

const MEDICINE_BOTTLE_SYSTEM_PROMPT = `You are a careful medical OCR assistant. The user will send a photo of a medicine bottle, strip, or packet (Indian retail packaging). Extract the primary medicine name printed on the packaging.

Return ONLY a JSON object of this exact shape:
{
  "aiReadName": "string — primary brand/generic name from the packaging; empty string if unreadable",
  "confidence": number /* in [0, 1] reflecting how legible the name was */
}

Rules:
- Prefer the PROMINENT brand/generic name. Ignore manufacturer tagline, batch number, expiry, and dosage strength suffix unless it is fused with the brand (e.g. "Glycomet GP 1" should stay as "Glycomet GP 1").
- If the packaging is illegible, return {"aiReadName": "", "confidence": 0}.
- No prose, no apology, no markdown — JSON only.`;

const promptForMode = (mode: VisionMode): string => {
  switch (mode) {
    case "prescription_text":
      return PRESCRIPTION_TEXT_SYSTEM_PROMPT;
    case "medicine_bottle":
    case "clarification_pass":
      return MEDICINE_BOTTLE_SYSTEM_PROMPT;
  }
};

// ─────────────────────────────────────────────────────────────────────
// Circuit breaker — copy of claude.ts shape; separate Redis namespace.
// ─────────────────────────────────────────────────────────────────────

const ensureCircuitClosed = async (): Promise<void> => {
  const openUntil = await redis.get(OPEN_KEY);
  if (!openUntil) return;
  const openUntilMs = Number.parseInt(openUntil, 10);
  if (Number.isFinite(openUntilMs) && openUntilMs > Date.now()) {
    throw new DomainError(
      "VISION_CIRCUIT_OPEN",
      "Claude Vision upstream is degraded; defer the OCR job.",
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
      "claude vision circuit breaker opened — OCR job will defer",
    );
    captureSentry(new Error("claude_vision_circuit_opened"), {
      failures_in_window: count,
      open_until_ms: openUntilMs,
    });
    captureAnalyticsEvent("prescription_ocr_circuit_opened", "system", {
      failures_in_window: count,
      window_seconds: CIRCUIT_FAIL_WINDOW_SECONDS,
    });
  }
};

const recordSuccess = async (): Promise<void> => {
  await redis.del(FAIL_KEY);
};

// ─────────────────────────────────────────────────────────────────────
// Daily spend cap — separate from the chat cap per CLAUDE.md
// "Spend-Cap Parity Across AI Surfaces". A cap breach auto-flips
// `prescription_ocr_enabled=false`; existing prescriptions still flow
// through the approval flow but NEW uploads stop enqueuing.
// ─────────────────────────────────────────────────────────────────────

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
  if (totalUsd > env.CLAUDE_VISION_DAILY_SPEND_CAP_USD) {
    await setFlag("prescription_ocr_enabled", false, "system:vision_spend_cap");
    logger.error(
      { totalUsd, capUsd: env.CLAUDE_VISION_DAILY_SPEND_CAP_USD },
      "claude vision daily spend cap reached — prescription_ocr_enabled flipped off",
    );
    captureSentry(new Error("claude_vision_spend_cap_reached"), {
      spend_usd: totalUsd,
      cap_usd: env.CLAUDE_VISION_DAILY_SPEND_CAP_USD,
    });
    captureAnalyticsEvent("prescription_ocr_spend_cap_reached", "system", {
      spend_usd: totalUsd,
      cap_usd: env.CLAUDE_VISION_DAILY_SPEND_CAP_USD,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────
// SDK adapters
// ─────────────────────────────────────────────────────────────────────

const toSdkImageBlock = (image: VisionImageInput): Anthropic.ImageBlockParam => {
  if (image.kind === "url") {
    return { type: "image", source: { type: "url", url: image.url } };
  }
  return {
    type: "image",
    source: { type: "base64", media_type: image.mediaType, data: image.data },
  };
};

const parseJsonStrict = <T>(raw: string, mode: VisionMode): T => {
  // Vision may wrap the JSON in a ```json fence despite the system
  // prompt — defensively strip it before parsing. Anything else that
  // doesn't parse cleanly is an upstream contract violation.
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch (e) {
    throw new DomainError("VISION_INVALID_JSON", `Vision returned non-JSON for ${mode}.`, {
      raw_excerpt: raw.slice(0, 200),
      error: e instanceof Error ? e.message : String(e),
    });
  }
};

const clamp01 = (n: unknown): number => {
  if (typeof n !== "number" || !Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
};

const asString = (x: unknown): string => (typeof x === "string" ? x : "");

const normaliseLines = (raw: unknown): readonly PrescriptionLineCandidate[] => {
  if (!raw || typeof raw !== "object") return [];
  const linesField = (raw as { lines?: unknown }).lines;
  if (!Array.isArray(linesField)) return [];
  return linesField.map((row): PrescriptionLineCandidate => {
    const r = (row ?? {}) as Record<string, unknown>;
    const alternativesRaw = Array.isArray(r.alternatives) ? r.alternatives : [];
    const alternatives = alternativesRaw
      .map((alt) => {
        const a = (alt ?? {}) as Record<string, unknown>;
        return { name: asString(a.name), confidence: clamp01(a.confidence) };
      })
      .filter((a) => a.name.length > 0);
    return {
      name: asString(r.name),
      dosage: asString(r.dosage),
      frequency: asString(r.frequency),
      confidence: clamp01(r.confidence),
      alternatives,
    };
  });
};

const normaliseBottle = (raw: unknown): BottleCandidate => {
  if (!raw || typeof raw !== "object") return { aiReadName: "", confidence: 0 };
  const r = raw as Record<string, unknown>;
  return { aiReadName: asString(r.aiReadName), confidence: clamp01(r.confidence) };
};

// ─────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────

export const generateVisionResponse = async (
  input: VisionRequestInput,
): Promise<VisionResponse> => {
  if (input.images.length === 0) {
    throw new DomainError("VISION_NO_IMAGES", "At least one image is required for a Vision call.");
  }
  await ensureCircuitClosed();

  const model = visionModel();
  const c = getClient();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.VISION_HARD_TIMEOUT_MS);
  const startedAt = Date.now();

  Sentry.addBreadcrumb({
    category: "vision",
    message: "claude_vision.generate",
    level: "info",
    data: {
      mode: input.mode,
      model,
      image_count: input.images.length,
      prescription_id: input.context.prescriptionId,
      request_id: input.requestId,
      // No image data, no patient identifiers — by construction.
    },
  });

  try {
    const response = await c.messages.create(
      {
        model,
        max_tokens: 2048,
        // Temperature 0 — OCR should be deterministic to make the
        // audit trail replayable. A second Vision call on the same
        // image should produce the same JSON.
        temperature: 0,
        system: promptForMode(input.mode),
        messages: [
          {
            role: "user",
            content: input.images.map(toSdkImageBlock),
          },
        ],
        metadata: { user_id: input.context.anonymizedPatientId },
      },
      { signal: controller.signal },
    );

    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    const rawText = textBlock?.text ?? "";
    const usage = response.usage;
    const meta: VisionResponseMeta = {
      model,
      tokensInput: usage.input_tokens,
      tokensOutput: usage.output_tokens,
      responseLatencyMs: Date.now() - startedAt,
      rawText,
    };

    await recordSuccess();
    const estimatedCostUsd = estimateCostUsd(model, meta.tokensInput, meta.tokensOutput);
    await trackSpendAndMaybeTripCap(estimatedCostUsd);

    captureAnalyticsEvent("prescription_ocr_call", input.userId, {
      mode: input.mode,
      model,
      image_count: input.images.length,
      tokens_input: meta.tokensInput,
      tokens_output: meta.tokensOutput,
      response_latency_ms: meta.responseLatencyMs,
      estimated_cost_usd: estimatedCostUsd,
      prescription_id: input.context.prescriptionId,
      request_id: input.requestId,
    });

    if (input.mode === "prescription_text") {
      const parsed = parseJsonStrict<unknown>(rawText, input.mode);
      return { mode: "prescription_text", lines: normaliseLines(parsed), meta };
    }
    const parsed = parseJsonStrict<unknown>(rawText, input.mode);
    return { mode: input.mode, bottle: normaliseBottle(parsed), meta };
  } catch (err) {
    if (
      err instanceof Anthropic.APIUserAbortError ||
      (err instanceof Error && err.name === "AbortError")
    ) {
      await recordFailure();
      throw new DomainError(
        "VISION_UPSTREAM_TIMEOUT",
        `Claude Vision exceeded the ${env.VISION_HARD_TIMEOUT_MS}ms hard timeout.`,
      );
    }
    if (err instanceof Anthropic.APIError) {
      await recordFailure();
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
};
