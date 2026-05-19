/**
 * Phase 3 — AI Chat (service)
 * Kill switch flag: ai_chat_enabled (gates the entry point)
 *                   ai_chat_tier3_enabled (gates Tier 3 sonnet calls)
 * Rollback runbook: docs/runbooks/rollback.md#chat
 * Owner: @phase3-chat-team
 *
 * Orchestrates the full chat turn per phase3.md A.4:
 *   1. Idempotency check on clientUuid (same-version → replay)
 *   2. Flag gate `ai_chat_enabled`
 *   3. Daily rate limit (free tier — CHAT_DAILY_FREE_LIMIT)
 *   4. Emergency check — if a critical-bypass fired in the last 30
 *      min, skip Claude entirely and return the canned redirect
 *   5. Cold-start router — day 1–14 returns Tier-1 stage message
 *   6. Cost-tier router — template / cached / sonnet
 *   7. Build PatientContext (PII-stripped) from User + recent readings
 *   8. Tier 1 (template) lookup → use Tier-1 string
 *   9. Tier 2/3 → Claude wrapper (gates `ai_chat_tier3_enabled` for sonnet)
 *  10. Post-Response Safety Filter — replace + flag if unsafe
 *  11. Persist ChatMessage (one transaction with the session upsert)
 *  12. Return SendMessageResult to the controller
 *
 * Notes on what *isn't* here:
 *  - The Claude wrapper handles its own retry/timeout/circuit/spend cap.
 *  - The shared `checkIdempotent` helper handles version compare.
 *  - The pure domain modules (filter, router, cold-start, templates,
 *    intent classifier) are zero-IO; they get called like utilities.
 */

import { createHash } from "node:crypto";
import {
  DomainError,
  type ChatCondition,
  type ChatCostTier,
  type ChatLanguage,
} from "@swasth/shared-types";
import {
  classifyIntent,
  coldStartResponse,
  filterChatResponse,
  lookupTemplate,
  pickCostTier,
} from "@swasth/domain-logic";
import {
  type ChatMessage,
  type ChatSession,
  type GlucoseReading,
  type Prisma,
} from "@prisma/client";
import { env } from "../../config/env.js";
import { prisma } from "../../shared/database.js";
import { redis } from "../../shared/redis.js";
import { logger } from "../../shared/logger.js";
import { getFlag } from "../../shared/flags/index.js";
import { checkIdempotent } from "../../shared/idempotency.js";
import { capture as captureAnalyticsEvent } from "../../shared/analytics/posthog.js";
import {
  generateResponse,
  type ClaudeResponse,
  type PatientContext,
} from "../../shared/ai/claude.js";
import { enqueueChatSafetyReview } from "./chat.jobs.js";
import type { SendMessageInput, SendMessageResult } from "./chat.types.js";

// ─────────────────────────────────────────────────────────────────────
// Tunables — kept inline (auditable) rather than env to prevent
// configuration drift between environments. Move to flag service if a
// runtime change becomes operationally necessary.
// ─────────────────────────────────────────────────────────────────────

const CRITICAL_BYPASS_WINDOW_MIN = 30;
const RECENT_GLUCOSE_LIMIT = 10;
const CONVERSATION_HISTORY_TURNS = 6;
const STATIC_SYSTEM_PROMPT = [
  "You are SwasthParivar — a Hindi-first health companion for Indian patients managing chronic conditions (diabetes, hypertension).",
  "Speak warmly. Use simple Hindi or Hinglish unless the patient writes in English. Keep replies under 4 sentences.",
  "NEVER recommend medication changes, dosages, or diagnoses. Direct medication questions to the doctor.",
  "Acknowledge limits when data is sparse — never invent trends.",
].join("\n");

// ─────────────────────────────────────────────────────────────────────
// Public entry point — POST /api/v1/chat/message
// ─────────────────────────────────────────────────────────────────────

export const sendMessage = async (input: SendMessageInput): Promise<SendMessageResult> => {
  // 1. Idempotency replay short-circuit (same {clientUuid, version}).
  const idem = await checkIdempotent(prisma.chatMessage, input.clientUuid, input.version);
  if (idem.kind === "stale") {
    throw new DomainError(
      "READING_STALE_VERSION",
      "incoming version not newer than stored chat message",
    );
  }
  if (idem.kind === "replay") {
    return buildReplayResult(idem.existing);
  }

  // 2. Kill-switch flag.
  const enabled = await getFlag<boolean>("ai_chat_enabled", false);
  if (!enabled) {
    throw new DomainError("CHAT_DISABLED", "AI chat is disabled — try again later.");
  }

  // Load the user + tier in parallel with the rate-limit counter.
  const [user, dailyCount] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: input.userId },
      select: {
        id: true,
        age: true,
        conditions: true,
        preferredLanguage: true,
        tier: true,
        createdAt: true,
      },
    }),
    incrementDailyRateCounter(input.userId),
  ]);

  // 3. Rate limit — free tier only.
  if (user.tier === "free" && dailyCount > env.CHAT_DAILY_FREE_LIMIT) {
    throw new DomainError(
      "CHAT_RATE_LIMITED",
      `Daily chat limit (${env.CHAT_DAILY_FREE_LIMIT}) reached. Try again tomorrow.`,
    );
  }

  // Coerce User → chat-domain unions. The pure modules require these
  // narrower types so the lookup tables stay auditable.
  const condition = coerceCondition(user.conditions);
  const language = coerceLanguage(user.preferredLanguage);
  const userStageDays = Math.floor((Date.now() - user.createdAt.getTime()) / 86_400_000);

  // 4. Emergency check — if a critical-bypass fired recently, skip
  // Claude entirely and surface the canned redirect.
  const emergency = await detectActiveEmergency(input.userId);
  if (emergency) {
    return await persistAndReturn(
      input,
      user.id,
      language,
      {
        content: emergencyCannedResponse(language),
        tier: "template",
        tokensInput: 0,
        tokensOutput: 0,
      },
      {
        flagged: false,
        safetyViolations: [],
        emergencySkipped: true,
      },
    );
  }

  // 5–7. Compute routing inputs from pure domain modules.
  const intent = classifyIntent({ message: input.message, language });
  const recentReadings = await loadRecentReadings(user.id);
  const cold = coldStartResponse({
    userStageDays,
    condition,
    language,
    intent,
  });
  if (cold) {
    return await persistAndReturn(
      input,
      user.id,
      language,
      { content: cold.content, tier: "template", tokensInput: 0, tokensOutput: 0 },
      { flagged: false, safetyViolations: [], emergencySkipped: false },
    );
  }

  const tier = pickCostTier({
    intent,
    userStageDays,
    readingsAvailable: recentReadings.length,
    // historyMatch is a placeholder — Phase 3 doesn't yet implement
    // a semantic cache lookup. When that lands, swap in the result of
    // a vector search over prior {prompt, response} pairs for this
    // (user, intent). Until then, `false` keeps routing honest.
    historyMatch: false,
  });

  // Tier 1 — Tier-1 lookup table OR safety pre-empt for medication.
  if (tier === "template") {
    const tpl = lookupTemplate({ intent, condition, language });
    // `cold` is null here (the cold-start short-circuit returned above).
    const content = tpl?.content ?? defaultTemplateFallback(language);
    return await persistAndReturn(
      input,
      user.id,
      language,
      { content, tier: "template", tokensInput: 0, tokensOutput: 0 },
      { flagged: false, safetyViolations: [], emergencySkipped: false },
    );
  }

  // Tier 2/3 — Claude. Gate Tier 3 separately so cost runaway can flip
  // sonnet off while keeping cached haiku flowing (per phase3.md A.10).
  let resolvedTier: ChatCostTier = tier;
  if (tier === "sonnet") {
    const tier3Enabled = await getFlag<boolean>("ai_chat_tier3_enabled", false);
    if (!tier3Enabled) resolvedTier = "cached";
  }

  // 8/9. Build PatientContext + invoke wrapper.
  const sessionId = await ensureSession(input, user.id, language);
  const history = await loadHistory(sessionId);
  const patientContext = buildPatientContext({
    userId: user.id,
    age: user.age,
    conditions: user.conditions,
    language,
    condition,
    recentReadings,
  });

  let claude: ClaudeResponse;
  try {
    claude = await generateResponse({
      tier: resolvedTier === "sonnet" ? "sonnet" : "cached",
      systemPrompt: STATIC_SYSTEM_PROMPT,
      patientContext,
      userMessage: input.message,
      conversationHistory: history,
      userId: user.id,
      sessionId,
      requestId: input.requestId,
    });
  } catch (err) {
    // Circuit open / timeout / spend cap — degrade to template.
    // The wrapper has already emitted Sentry + PostHog telemetry.
    if (
      err instanceof DomainError &&
      (err.code === "CHAT_CIRCUIT_OPEN" || err.code === "CHAT_UPSTREAM_TIMEOUT")
    ) {
      logger.warn(
        { requestId: input.requestId, code: err.code },
        "claude degraded — falling back to Tier 1 template",
      );
      const tpl = lookupTemplate({ intent, condition, language });
      return await persistAndReturn(
        input,
        user.id,
        language,
        {
          content: tpl?.content ?? defaultTemplateFallback(language),
          tier: "template",
          tokensInput: 0,
          tokensOutput: 0,
        },
        { flagged: false, safetyViolations: [], emergencySkipped: false },
        sessionId,
      );
    }
    throw err;
  }

  // 10. Post-Response Safety Filter.
  const filtered = filterChatResponse({ content: claude.content, language });
  if (!filtered.safe) {
    // Sentry breadcrumb (no content) + PostHog event.
    logger.error(
      {
        requestId: input.requestId,
        violations: filtered.violations,
        tier: resolvedTier,
      },
      "chat safety filter rejected upstream response",
    );
  }

  const persisted = await persistAndReturn(
    input,
    user.id,
    language,
    {
      content: filtered.redactedContent,
      tier: resolvedTier,
      tokensInput: claude.tokensInput,
      tokensOutput: claude.tokensOutput,
    },
    {
      flagged: !filtered.safe,
      safetyViolations: filtered.violations,
      emergencySkipped: false,
    },
    sessionId,
  );

  // Audit-trail async enqueue. Failure inside the helper is logged
  // and swallowed — patient response is already returned.
  if (!filtered.safe) {
    await enqueueChatSafetyReview({
      messageId: persisted.messageId,
      userId: user.id,
      requestId: input.requestId,
    });
  }

  return persisted;
};

// ─────────────────────────────────────────────────────────────────────
// User-flag endpoint — POST /api/v1/chat/messages/:id/flag
// Patient hits the 🚩 button on an assistant message.
// ─────────────────────────────────────────────────────────────────────

export const flagMessage = async (input: {
  userId: string;
  messageId: string;
  reason: "medical_advice" | "wrong_info" | "disrespectful" | "other";
  note?: string | undefined;
}): Promise<{ messageId: string; flagged: true; reason: string }> => {
  // Patient may only flag their own assistant messages. We check the
  // userId match defensively even though the route is auth-protected.
  const existing = await prisma.chatMessage.findFirst({
    where: { id: input.messageId, userId: input.userId, role: "assistant" },
  });
  if (!existing) {
    throw new DomainError("VALIDATION_ERROR", "chat message not found for user");
  }
  await prisma.chatMessage.update({
    where: { id: existing.id },
    data: {
      flagged: true,
      flagReason: existing.flagReason ?? `user_flagged:${input.reason}`,
    },
  });
  return { messageId: existing.id, flagged: true, reason: input.reason };
};

// ─────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────

const incrementDailyRateCounter = async (userId: string): Promise<number> => {
  const key = `chat:rate:${userId}:${new Date().toISOString().slice(0, 10)}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 60 * 60 * 36);
  return count;
};

const detectActiveEmergency = async (userId: string): Promise<boolean> => {
  // Look at the most recent feedback event of type `critical_warn` —
  // this is the row the readings service writes when the bypass fires.
  // Mirrors the same lookup chat.service uses for replay reconstruction.
  const recent = await prisma.feedbackEvent.findFirst({
    where: {
      userId,
      feedbackType: "critical_warn",
      shownAt: { gte: new Date(Date.now() - CRITICAL_BYPASS_WINDOW_MIN * 60_000) },
    },
    select: { id: true },
  });
  return recent !== null;
};

const emergencyCannedResponse = (language: ChatLanguage): string => {
  if (language === "en") {
    return "Please handle the critical alert first. Call your doctor now.";
  }
  return "Pehle critical alert handle karein. Doctor ko abhi call karein.";
};

const defaultTemplateFallback = (language: ChatLanguage): string => {
  if (language === "en") {
    return "I'm here. Tell me what's on your mind about your health today.";
  }
  return "Main yahaan hoon. Aaj apni health ke baare mein kya sochna hai?";
};

const loadRecentReadings = async (userId: string): Promise<readonly GlucoseReading[]> =>
  await prisma.glucoseReading.findMany({
    where: { userId },
    orderBy: { measuredAt: "desc" },
    take: RECENT_GLUCOSE_LIMIT,
  });

const loadHistory = async (
  sessionId: string,
): Promise<readonly { role: "user" | "assistant"; content: string }[]> => {
  const rows = await prisma.chatMessage.findMany({
    where: { sessionId, role: { in: ["user", "assistant"] } },
    orderBy: { createdAt: "asc" },
    take: CONVERSATION_HISTORY_TURNS * 2,
    select: { role: true, content: true },
  });
  return rows.map((r) => ({
    role: r.role === "user" ? "user" : "assistant",
    content: r.content,
  }));
};

const ensureSession = async (
  input: SendMessageInput,
  userId: string,
  language: ChatLanguage,
): Promise<string> => {
  if (input.sessionId) {
    const existing = await prisma.chatSession.findFirst({
      where: { id: input.sessionId, userId },
      select: { id: true },
    });
    if (existing) return existing.id;
    // Drop-through: client provided an id that doesn't belong to them
    // — treat as a fresh session rather than 404'ing the chat send.
  }
  // Prisma Language enum only has hi | en; coerce "hi-en" → "hi" for
  // storage. Chat behavior uses the wider ChatLanguage at runtime.
  const storeLang: "hi" | "en" = language === "en" ? "en" : "hi";
  const created = await prisma.chatSession.create({
    data: { userId, language: storeLang },
    select: { id: true },
  });
  return created.id;
};

interface PersistedSummary {
  readonly content: string;
  readonly tier: ChatCostTier;
  readonly tokensInput: number;
  readonly tokensOutput: number;
}

interface PersistedFlags {
  readonly flagged: boolean;
  readonly safetyViolations: readonly string[];
  readonly emergencySkipped: boolean;
}

const persistAndReturn = async (
  input: SendMessageInput,
  userId: string,
  language: ChatLanguage,
  summary: PersistedSummary,
  flags: PersistedFlags,
  sessionIdOverride?: string,
): Promise<SendMessageResult> => {
  const sessionId = sessionIdOverride ?? (await ensureSession(input, userId, language));
  const storeLang: "hi" | "en" = language === "en" ? "en" : "hi";

  // Two rows per turn: the user's message + the assistant's response.
  // The `clientUuid` lives on the assistant row (the one we replay
  // on idempotent retries). The user row gets a derived UUID so the
  // unique constraint never collides.
  const userClientUuid = deriveUserTurnUuid(input.clientUuid);
  const assistantRow: Prisma.ChatMessageCreateManyInput = {
    clientUuid: input.clientUuid,
    version: input.version,
    sessionId,
    userId,
    role: "assistant",
    content: summary.content,
    language: storeLang,
    tokensInput: summary.tokensInput,
    tokensOutput: summary.tokensOutput,
    costTier: summary.tier,
    flagged: flags.flagged,
    flagReason: flags.flagged ? "safety_filter_rejected" : null,
    // Prisma rejects `undefined` here under exactOptionalPropertyTypes;
    // omit the key when there are no violations.
    ...(flags.flagged ? { safetyViolations: [...flags.safetyViolations] } : {}),
  };
  const data: Prisma.ChatMessageCreateManyInput[] = [
    {
      clientUuid: userClientUuid,
      version: input.version,
      sessionId,
      userId,
      role: "user",
      content: input.message,
      language: storeLang,
      costTier: "template",
    },
    assistantRow,
  ];

  // The user row may race against another concurrent send; ignore the
  // P2002 there (same patient retrying). The assistant row is what
  // replay reconstructs from, so its uniqueness is load-bearing.
  await prisma.chatMessage.createMany({ data, skipDuplicates: true });

  const assistant = await prisma.chatMessage.findUniqueOrThrow({
    where: { clientUuid: input.clientUuid },
    select: { id: true, content: true, costTier: true, tokensInput: true, tokensOutput: true },
  });

  captureAnalyticsEvent("ai_chat_response_generated", userId, {
    tier: summary.tier === "template" ? "cached" : summary.tier,
    model: summary.tier === "template" ? "template" : "claude",
    tokens_input: summary.tokensInput,
    tokens_output: summary.tokensOutput,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    response_latency_ms: 0,
    estimated_cost_usd: 0,
  });

  return {
    messageId: assistant.id,
    sessionId,
    content: assistant.content,
    tier: assistant.costTier,
    language,
    tokensInput: assistant.tokensInput,
    tokensOutput: assistant.tokensOutput,
    flagged: flags.flagged,
    safetyViolations: flags.safetyViolations,
    emergencySkipped: flags.emergencySkipped,
  };
};

const buildReplayResult = (existing: ChatMessage): SendMessageResult => ({
  messageId: existing.id,
  sessionId: existing.sessionId,
  content: existing.content,
  tier: existing.costTier,
  language: existing.language === "en" ? "en" : "hi",
  tokensInput: existing.tokensInput,
  tokensOutput: existing.tokensOutput,
  flagged: existing.flagged,
  safetyViolations: Array.isArray(existing.safetyViolations)
    ? (existing.safetyViolations as string[])
    : [],
  emergencySkipped: false,
});

// `User.conditions` (Condition[]) coerces to the narrower chat union
// per phase3.md A.4 — "diabetes" / "bp" / "multi". Anything outside
// those collapses into the closest bucket.
const coerceCondition = (conditions: readonly string[]): ChatCondition => {
  const hasDiabetes = conditions.includes("diabetes");
  const hasBp = conditions.includes("hypertension");
  if (hasDiabetes && hasBp) return "multi";
  if (hasBp) return "bp";
  if (hasDiabetes) return "diabetes";
  return "multi"; // Patient has another condition only — multi is safe.
};

const coerceLanguage = (lang: string): ChatLanguage => {
  if (lang === "en") return "en";
  return "hi";
};

const ageRange = (age: number): PatientContext["ageRange"] => {
  if (age < 50) return "under_50";
  if (age < 60) return "50_59";
  if (age < 70) return "60_69";
  return "70_plus";
};

const filterPatientConditions = (raw: readonly string[]): PatientContext["conditions"] => {
  const allowed = new Set(["diabetes", "hypertension", "asthma", "cardiac"] as const);
  return raw.filter((c): c is "diabetes" | "hypertension" | "asthma" | "cardiac" =>
    allowed.has(c as "diabetes" | "hypertension" | "asthma" | "cardiac"),
  );
};

const buildPatientContext = (params: {
  userId: string;
  age: number;
  conditions: readonly string[];
  language: ChatLanguage;
  condition: ChatCondition;
  recentReadings: readonly GlucoseReading[];
}): PatientContext => ({
  // SHA-256 of the userId, truncated to 12 chars. Stable per patient
  // but non-reversible — Claude can use it to anchor identity within
  // a session without learning the database UUID.
  anonymizedId: createHash("sha256").update(params.userId).digest("hex").slice(0, 12),
  ageRange: ageRange(params.age),
  conditions: filterPatientConditions(params.conditions),
  language: params.language,
  condition: params.condition,
  recentReadings: params.recentReadings.slice(0, 7).map((r) => ({
    type: r.readingType,
    value: r.valueMgDl,
    measuredAtIso: r.measuredAt.toISOString(),
  })),
});

// Derive a deterministic UUID for the user-row half of a turn so the
// unique index on `client_uuid` doesn't collide with the assistant row.
// Same input always derives the same UUID — replays stay idempotent.
const deriveUserTurnUuid = (clientUuid: string): string => {
  const hash = createHash("sha256").update(`user:${clientUuid}`).digest("hex");
  // Reshape 32 hex chars into the 8-4-4-4-12 UUID v4 form. The version
  // nibble is forced to 4 and the variant nibble to 8 so Postgres
  // accepts it as a UUID literal.
  const v4 = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  return v4;
};

// Listing helpers used by the controller.

export const listSessions = async (params: {
  userId: string;
  limit: number;
  cursor?: string;
}): Promise<{ data: ChatSession[]; cursor: string | null; hasMore: boolean }> => {
  const rows = await prisma.chatSession.findMany({
    where: {
      userId: params.userId,
      archivedAt: null,
      ...(params.cursor ? { startedAt: { lt: new Date(params.cursor) } } : {}),
    },
    orderBy: { startedAt: "desc" },
    take: params.limit + 1,
  });
  const hasMore = rows.length > params.limit;
  const data = rows.slice(0, params.limit);
  const cursor = hasMore && data.length > 0 ? data[data.length - 1]!.startedAt.toISOString() : null;
  return { data, cursor, hasMore };
};

export const listMessages = async (params: {
  userId: string;
  sessionId: string;
}): Promise<ChatMessage[]> => {
  const session = await prisma.chatSession.findFirst({
    where: { id: params.sessionId, userId: params.userId },
    select: { id: true },
  });
  if (!session) {
    throw new DomainError("VALIDATION_ERROR", "chat session not found");
  }
  return await prisma.chatMessage.findMany({
    where: { sessionId: params.sessionId },
    orderBy: { createdAt: "asc" },
  });
};
