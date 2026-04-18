import type { Request, Response } from "express";
import { DomainError, type MedicationLogStatus } from "@swasth/shared-types";
import { ok } from "../../shared/http.js";
import * as service from "./medications.service.js";

export const getSchedules = async (req: Request, res: Response): Promise<void> => {
  ok(res, await service.listSchedules(req.auth!.sub));
};

export const postSchedule = async (req: Request, res: Response): Promise<void> => {
  const body = req.body as {
    medicineName: string;
    dosage?: string;
    timeSlots: string[];
    condition?: string;
    isCritical: boolean;
  };
  const created = await service.createSchedule({ userId: req.auth!.sub, ...body });
  ok(res, created, 201);
};

export const postLog = async (req: Request, res: Response): Promise<void> => {
  const body = req.body as {
    scheduleId: string;
    status: MedicationLogStatus;
    scheduledFor: string;
    skipReason?: string;
  };
  const log = await service.logMedication({ userId: req.auth!.sub, ...body });
  ok(res, log, 201);
};

export const deleteSchedule = async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id;
  if (!id || typeof id !== "string") throw new DomainError("VALIDATION_ERROR", "id is required");
  await service.deleteSchedule({ userId: req.auth!.sub, id });
  ok(res, { deleted: true });
};

export const getAdherence = async (req: Request, res: Response): Promise<void> => {
  const days = Number(req.query["days"] ?? 30);
  ok(res, await service.adherenceLast(req.auth!.sub, days));
};
