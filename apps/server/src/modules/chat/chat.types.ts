/**
 * Phase 3 — AI Chat
 * Kill switch flag: ai_chat_enabled
 * Rollback runbook: docs/runbooks/rollback.md#chat
 * Owner: @phase3-chat-team
 *
 * Shared request/response/service types for the chat module.
 * Mobile and server agree on the shapes here; the controller maps
 * Zod-validated input → service input, the service returns
 * `SendMessageResult` which the controller wraps in the API envelope.
 */

import type { ChatCostTier, ChatLanguage } from "@swasth/shared-types";

// ─────────────────────────────────────────────────────────────────────
// Inbound request — POST /api/v1/chat/message
// ─────────────────────────────────────────────────────────────────────

export interface SendMessageInput {
  readonly userId: string;
  readonly requestId: string;
  // Mobile-generated UUID for idempotent replay. Same `clientUuid` +
  // same `version` → server returns the persisted assistant response
  // without re-calling Claude. Bump `version` to edit (e.g. retry
  // after a transient mobile crash).
  readonly clientUuid: string;
  readonly version: number;
  // Optional — when null the service starts a new ChatSession. The
  // mobile typically retains a session id for the duration of a UI
  // session (until the user dismisses the chat screen).
  readonly sessionId: string | null;
  readonly message: string;
}

// ─────────────────────────────────────────────────────────────────────
// Outbound response
// ─────────────────────────────────────────────────────────────────────

export interface SendMessageResult {
  readonly messageId: string;
  readonly sessionId: string;
  readonly content: string;
  readonly tier: ChatCostTier;
  readonly language: ChatLanguage;
  readonly tokensInput: number;
  readonly tokensOutput: number;
  // Set true when the Post-Response Safety Filter (or pre-routing
  // medication redirect) substituted the original content. Mobile
  // surfaces a small disclaimer when flagged is true.
  readonly flagged: boolean;
  // Subset of `SafetyViolation[]` per shared/domain-logic. Surfaced so
  // PostHog / debug builds can see which rule fired without server
  // round-tripping. Empty list when `flagged === false`.
  readonly safetyViolations: readonly string[];
  // Set when the chat service short-circuited because the patient has
  // an active critical-bypass (glucose < 65 or > 315 within last
  // 30 min). The mobile uses this to surface the bypass UI rather
  // than show the chat response.
  readonly emergencySkipped: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// User flag — POST /api/v1/chat/messages/:id/flag
// ─────────────────────────────────────────────────────────────────────

export interface FlagMessageInput {
  readonly userId: string;
  readonly messageId: string;
  readonly reason: "medical_advice" | "wrong_info" | "disrespectful" | "other";
  readonly note?: string;
}

export interface FlagMessageResult {
  readonly messageId: string;
  readonly flagged: true;
  readonly reason: string;
}
