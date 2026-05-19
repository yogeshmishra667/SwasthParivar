/**
 * Phase 3 — AI Chat (controller)
 *
 * Thin Express handlers. Zod has already validated the body in route
 * middleware; this layer maps to service calls and wraps the result in
 * the standard `{success, data}` envelope. Errors propagate via Express
 * 5 async error handling → shared error-handler maps DomainError codes
 * to HTTP status.
 */

import type { Request, Response } from "express";
import { DomainError } from "@swasth/shared-types";
import { ok } from "../../shared/http.js";
import * as service from "./chat.service.js";
import type { FlagMessageBody, ListSessionsQuery, SendMessageBody } from "./chat.validation.js";

// Validates a UUID path param under Express 5's lazy parser. Same
// helper pattern as family.controller.ts:requireParamUuid.
const requireUuidParam = (raw: string | string[] | undefined, name: string): string => {
  if (!raw || typeof raw !== "string") {
    throw new DomainError("VALIDATION_ERROR", `${name} is required`);
  }
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(raw)) {
    throw new DomainError("VALIDATION_ERROR", `${name} must be a UUID`);
  }
  return raw;
};

export const postMessage = async (req: Request, res: Response): Promise<void> => {
  const body = req.body as SendMessageBody;
  const result = await service.sendMessage({
    userId: req.auth!.sub,
    // Express's `req.id` is typed as ReqId (string | number). Our
    // request-id middleware always sets a string; narrow with a
    // type-safe fallback that doesn't risk Object.toString.
    requestId:
      typeof req.id === "string" ? req.id : typeof req.id === "number" ? req.id.toString(10) : "",
    clientUuid: body.client_uuid,
    version: body.version,
    sessionId: body.session_id ?? null,
    message: body.message,
  });
  ok(res, result, 201);
};

export const getSessions = async (req: Request, res: Response): Promise<void> => {
  const query = req.query as unknown as ListSessionsQuery;
  const result = await service.listSessions({
    userId: req.auth!.sub,
    limit: query.limit,
    ...(query.cursor ? { cursor: query.cursor } : {}),
  });
  ok(res, result);
};

export const getSessionMessages = async (req: Request, res: Response): Promise<void> => {
  const sessionId = requireUuidParam(req.params.sessionId, "sessionId");
  const messages = await service.listMessages({
    userId: req.auth!.sub,
    sessionId,
  });
  ok(res, messages);
};

export const postFlagMessage = async (req: Request, res: Response): Promise<void> => {
  const messageId = requireUuidParam(req.params.messageId, "messageId");
  const body = req.body as FlagMessageBody;
  const result = await service.flagMessage({
    userId: req.auth!.sub,
    messageId,
    reason: body.reason,
    note: body.note,
  });
  ok(res, result);
};
