import type { Request, Response } from "express";
import { ok } from "../../shared/http.js";
import * as service from "./medications.service.js";

export const getSchedules = async (req: Request, res: Response): Promise<void> => {
  ok(res, await service.listSchedules(req.auth!.sub));
};

export const postSchedule = async (req: Request, res: Response): Promise<void> => {
  const body = req.body as Parameters<typeof service.createSchedule>[0] extends infer _
    ? { medicineName: string; dosage?: string; timeSlots: string[]; condition?: string; isCritical: boolean }
    : never;
  const created = await service.createSchedule({ userId: req.auth!.sub, ...body });
  ok(res, created, 201);
};

export const postLog = async (req: Request, res: Response): Promise<void> => {
  const body = req.body as {
    scheduleId: string;
    status: "taken" | "skipped" | "missed_no_response" | "delayed";
    scheduledFor: string;
    skipReason?: string;
  };
  const log = await service.logMedication({ userId: req.auth!.sub, ...body });
  ok(res, log, 201);
};

export const getAdherence = async (req: Request, res: Response): Promise<void> => {
  const days = Number(req.query["days"] ?? 30);
  ok(res, await service.adherenceLast(req.auth!.sub, days));
};
