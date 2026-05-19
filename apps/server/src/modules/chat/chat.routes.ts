/**
 * Phase 3 — AI Chat
 * Kill switch flag: ai_chat_enabled
 * Rollback runbook: docs/runbooks/rollback.md#chat
 * Owner: @phase3-chat-team
 *
 * Routes mounted under /api/v1/chat. All endpoints require auth.
 *
 *   POST /message                    send a chat turn
 *   GET  /sessions                   list patient's recent chat sessions
 *   GET  /sessions/:sessionId/messages   full message log for one session
 *   POST /messages/:messageId/flag   patient 🚩 button (per-message audit)
 *
 * The `ai_chat_enabled` flag is checked inside chat.service.sendMessage
 * (not at the route layer) so that flipping the flag off still allows
 * `/sessions` reads to render the patient's chat history — only new
 * sends get the CHAT_DISABLED 503.
 */

import { Router } from "express";
import { requireAuth } from "../../shared/middleware/auth.js";
import { validateBody, validateQuery } from "../../shared/validate.js";
import {
  flagMessageSchema,
  listSessionsQuerySchema,
  sendMessageSchema,
} from "./chat.validation.js";
import * as controller from "./chat.controller.js";

export const chatRouter: Router = Router();

chatRouter.use(requireAuth);

chatRouter.post("/message", validateBody(sendMessageSchema), controller.postMessage);

chatRouter.get("/sessions", validateQuery(listSessionsQuerySchema), controller.getSessions);

chatRouter.get("/sessions/:sessionId/messages", controller.getSessionMessages);

chatRouter.post(
  "/messages/:messageId/flag",
  validateBody(flagMessageSchema),
  controller.postFlagMessage,
);
