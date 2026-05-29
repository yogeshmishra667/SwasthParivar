import type { Request, Response } from "express";
import { ok } from "../../shared/http.js";
import * as service from "./sos.service.js";
import type { SOSTriggerInput } from "./sos.types.js";

export const postTrigger = async (req: Request, res: Response): Promise<void> => {
  const userId = req.auth!.sub;
  const result = await service.triggerSOS({
    userId,
    input: req.body as SOSTriggerInput,
    ...(req.requestId !== undefined ? { requestId: req.requestId } : {}),
  });
  // Newly-minted vs idempotent-replay both 200 — the mobile UX shows
  // the same screen either way. The DTO's `triggeredAt` is the
  // discriminator if a debugger cares.
  ok(res, result);
};

export const postCancel = async (req: Request, res: Response): Promise<void> => {
  const userId = req.auth!.sub;
  const { id } = req.params as { id: string };
  const { by } = req.body as { by: "patient" | "guardian" };
  const result = await service.cancelSOS({ userId, sosEventId: id, by });
  ok(res, result);
};

export const postResolve = async (req: Request, res: Response): Promise<void> => {
  const userId = req.auth!.sub;
  const { id } = req.params as { id: string };
  const { by, falseAlarm } = req.body as {
    by: "patient" | "guardian" | "admin";
    falseAlarm?: boolean;
  };
  const result = await service.resolveSOS({
    userId,
    sosEventId: id,
    by,
    ...(falseAlarm !== undefined ? { falseAlarm } : {}),
  });
  ok(res, result);
};

export const getActive = async (req: Request, res: Response): Promise<void> => {
  const userId = req.auth!.sub;
  const result = await service.getActiveSOS(userId);
  ok(res, { active: result });
};

export const getContacts = async (req: Request, res: Response): Promise<void> => {
  const userId = req.auth!.sub;
  const result = await service.listEmergencyContacts(userId);
  ok(res, { contacts: result });
};

export const postGuardianTrigger = async (req: Request, res: Response): Promise<void> => {
  const guardianId = req.auth!.sub;
  const { patientId } = req.params as { patientId: string };
  const { clientUuid } = req.body as { clientUuid: string };
  const result = await service.triggerGuardianInitiatedSOS({
    guardianId,
    patientId,
    clientUuid,
    ...(req.requestId !== undefined ? { requestId: req.requestId } : {}),
  });
  ok(res, result);
};
