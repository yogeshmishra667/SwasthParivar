// Phase 3 — AI Chat service. Wraps the /chat endpoints.
//
// Reads (`listChatSessions`, `listSessionMessages`) fail soft and return
// empty, matching the insights.ts pattern — a chat history that won't
// load should never crash the screen.
//
// `sendChatMessage` is different: a failed send carries information the
// UI must act on (rate limit, kill switch, safety rejection). It returns
// a discriminated `ChatSendOutcome` instead of throwing, so the screen
// can show the right Hindi copy without a try/catch.

import axios from "axios";
import { api } from "@/services/api";
import { logError } from "@/services/analytics";

export type ChatTier = "template" | "cached" | "sonnet";
export type ChatRole = "user" | "assistant" | "system";
export type ChatFlagReason = "medical_advice" | "wrong_info" | "disrespectful" | "other";

export interface SendMessageResultDto {
  messageId: string;
  sessionId: string;
  content: string;
  tier: ChatTier;
  language: "hi" | "en";
  tokensInput: number;
  tokensOutput: number;
  flagged: boolean;
  safetyViolations: string[];
  emergencySkipped: boolean;
}

export interface ChatSessionDto {
  id: string;
  startedAt: string;
  endedAt: string | null;
  language: "hi" | "en";
}

export interface ChatMessageDto {
  id: string;
  sessionId: string;
  role: ChatRole;
  content: string;
  costTier: ChatTier;
  flagged: boolean;
  flagReason: string | null;
  createdAt: string;
}

// Server error codes the send surface can return — each maps to a
// distinct piece of Hindi copy on the chat screen.
export type ChatSendErrorCode =
  | "CHAT_DISABLED"
  | "CHAT_RATE_LIMITED"
  | "CHAT_SAFETY_REJECTED"
  | "CHAT_CIRCUIT_OPEN"
  | "CHAT_UPSTREAM_TIMEOUT"
  | "READING_STALE_VERSION"
  | "UNKNOWN";

export type ChatSendOutcome =
  | { ok: true; result: SendMessageResultDto }
  | { ok: false; code: ChatSendErrorCode };

const KNOWN_CODES: readonly ChatSendErrorCode[] = [
  "CHAT_DISABLED",
  "CHAT_RATE_LIMITED",
  "CHAT_SAFETY_REJECTED",
  "CHAT_CIRCUIT_OPEN",
  "CHAT_UPSTREAM_TIMEOUT",
  "READING_STALE_VERSION",
];

const extractErrorCode = (err: unknown): ChatSendErrorCode => {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { error?: { code?: string } } | undefined;
    const code = data?.error?.code;
    if (code !== undefined && (KNOWN_CODES as readonly string[]).includes(code)) {
      return code as ChatSendErrorCode;
    }
  }
  return "UNKNOWN";
};

export const sendChatMessage = async (input: {
  clientUuid: string;
  version: number;
  sessionId?: string;
  message: string;
}): Promise<ChatSendOutcome> => {
  try {
    const res = await api.post<{ success: boolean; data: SendMessageResultDto }>("/chat/message", {
      client_uuid: input.clientUuid,
      version: input.version,
      ...(input.sessionId ? { session_id: input.sessionId } : {}),
      message: input.message,
    });
    return { ok: true, result: res.data };
  } catch (err) {
    const code = extractErrorCode(err);
    // Only an unmapped failure is noteworthy — the mapped codes are
    // expected operational states the screen handles inline.
    if (code === "UNKNOWN") logError("sendChatMessage", err);
    return { ok: false, code };
  }
};

export const listChatSessions = async (params?: {
  limit?: number;
  cursor?: string;
}): Promise<{ data: ChatSessionDto[]; cursor: string | null; hasMore: boolean }> => {
  try {
    const res = await api.get<{
      success: boolean;
      data: { data: ChatSessionDto[]; cursor: string | null; hasMore: boolean };
    }>("/chat/sessions", { params });
    return res.data;
  } catch (err) {
    logError("listChatSessions", err);
    return { data: [], cursor: null, hasMore: false };
  }
};

export const listSessionMessages = async (sessionId: string): Promise<ChatMessageDto[]> => {
  try {
    const res = await api.get<{ success: boolean; data: ChatMessageDto[] }>(
      `/chat/sessions/${sessionId}/messages`,
    );
    return res.data;
  } catch (err) {
    logError("listSessionMessages", err);
    return [];
  }
};

export const flagChatMessage = async (
  messageId: string,
  reason: ChatFlagReason,
  note?: string,
): Promise<boolean> => {
  try {
    await api.post(`/chat/messages/${messageId}/flag`, {
      reason,
      ...(note ? { note } : {}),
    });
    return true;
  } catch (err) {
    logError("flagChatMessage", err);
    return false;
  }
};
