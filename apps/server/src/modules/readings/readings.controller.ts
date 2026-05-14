import type { Request, Response } from "express";
import { DomainError } from "@swasth/shared-types";
import { parseVoiceTranscript } from "@swasth/domain-logic";
import { ok } from "../../shared/http.js";
import { resolveHouseholdMember } from "../../shared/auth/household.js";
import { capture as captureAnalyticsEvent } from "../../shared/analytics/posthog.js";
import * as service from "./readings.service.js";

export const postGlucose = async (req: Request, res: Response): Promise<void> => {
  const body = req.body as {
    clientUuid: string;
    valueMgDl: number;
    readingType: "fasting" | "pre_meal" | "post_meal" | "random" | "bedtime";
    context: "normal" | "festive";
    notes?: string;
    source: "manual" | "voice" | "device";
    measuredAt: string;
    version: number;
    targetUserId?: string;
  };
  const userId = await resolveHouseholdMember(req.auth!, body.targetUserId);
  const { targetUserId: _drop, ...rest } = body;
  void _drop;
  const result = await service.createGlucoseReading({
    userId,
    ...rest,
    ...(req.requestId ? { requestId: req.requestId } : {}),
  });
  ok(res, result, 201);
};

export const postGlucoseVoice = async (req: Request, res: Response): Promise<void> => {
  const body = req.body as {
    clientUuid: string;
    transcript: string;
    confidence: number;
    capturedAtIso: string;
    capturedAtHourLocal: number;
    confirmedValue: number;
    confirmedType: "fasting" | "pre_meal" | "post_meal" | "random" | "bedtime";
    context: "normal" | "festive";
    targetUserId?: string;
  };

  const userId = await resolveHouseholdMember(req.auth!, body.targetUserId);

  const parsed = parseVoiceTranscript({
    transcript: body.transcript,
    confidence: body.confidence,
    capturedAtHourLocal: body.capturedAtHourLocal,
  });

  if (parsed.kind === "rejected") {
    captureAnalyticsEvent("voice_attempt", userId, {
      success: false,
      fallback: "numpad",
      confidence: body.confidence,
      colloquial_match: false,
      uncertainty_detected: false,
      rejected_reason: parsed.reason,
    });
    throw new DomainError("READING_CONFIRMATION_NEEDED", `voice rejected: ${parsed.reason}`);
  }

  captureAnalyticsEvent("voice_attempt", userId, {
    success: true,
    fallback: "none",
    confidence: body.confidence,
    colloquial_match: parsed.colloquialMatch,
    uncertainty_detected: parsed.requiresStrongConfirmation,
    rejected_reason: null,
  });

  const result = await service.createGlucoseReading({
    userId,
    clientUuid: body.clientUuid,
    valueMgDl: body.confirmedValue,
    readingType: body.confirmedType,
    context: body.context,
    source: "voice",
    measuredAt: body.capturedAtIso,
    version: 1,
    ...(req.requestId ? { requestId: req.requestId } : {}),
  });

  ok(res, { ...result, parseHints: { colloquialMatch: parsed.colloquialMatch } }, 201);
};

export const deleteGlucose = async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id;
  if (!id || typeof id !== "string") throw new DomainError("VALIDATION_ERROR", "id is required");
  const q = req.query as { targetUserId?: string };
  const userId = await resolveHouseholdMember(req.auth!, q.targetUserId);
  await service.deleteGlucoseReading({ userId, id });
  ok(res, { deleted: true });
};

export const getGlucose = async (req: Request, res: Response): Promise<void> => {
  const q = req.query as {
    from?: string;
    to?: string;
    limit?: string | number;
    cursor?: string;
    targetUserId?: string;
  };
  const userId = await resolveHouseholdMember(req.auth!, q.targetUserId);
  const result = await service.listGlucoseReadings({
    userId,
    ...(q.from ? { from: new Date(q.from) } : {}),
    ...(q.to ? { to: new Date(q.to) } : {}),
    limit: Number(q.limit ?? 50),
    ...(q.cursor ? { cursor: q.cursor } : {}),
  });
  ok(res, result);
};
