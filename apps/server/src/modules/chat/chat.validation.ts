/**
 * Phase 3 — AI Chat (Zod schemas)
 *
 * The controller is strictly Zod → service → response envelope. Every
 * inbound field is constrained here. `clientUuid` and `version` mirror
 * the readings idempotency shape so mobile can reuse the same retry
 * machinery.
 */

import { z } from "zod";

// Max message length — keeps Claude prompts bounded and prevents
// pathological inputs from blowing past the 1024 max_tokens / spend
// cap. 2000 chars is generous for a chat turn.
const MAX_MESSAGE_CHARS = 2000;

export const sendMessageSchema = z.object({
  client_uuid: z.string().uuid(),
  version: z.number().int().positive(),
  session_id: z.string().uuid().nullable().optional(),
  message: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
});

export type SendMessageBody = z.infer<typeof sendMessageSchema>;

export const flagMessageSchema = z.object({
  reason: z.enum(["medical_advice", "wrong_info", "disrespectful", "other"]),
  note: z.string().trim().max(500).optional(),
});

export type FlagMessageBody = z.infer<typeof flagMessageSchema>;

// GET /api/v1/chat/sessions — list the patient's recent sessions for
// the chat UI's "previous chats" list. Cursor + limit per the standard
// cursor-pagination convention.
export const listSessionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().uuid().optional(),
});

export type ListSessionsQuery = z.infer<typeof listSessionsQuerySchema>;
