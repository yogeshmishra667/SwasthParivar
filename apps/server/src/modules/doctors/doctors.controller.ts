// Phase 4 Feature G.2 — doctor-profile CRUD controller.
//
// Thin layer: Zod already validated body/query in the routes; here we
// pull the typed payload and forward to the service.

import type { Request, Response } from "express";
import * as service from "./doctors.service.js";

export const getDoctors = async (req: Request, res: Response): Promise<void> => {
  const targetUserId =
    typeof req.query.targetUserId === "string" ? req.query.targetUserId : undefined;
  const doctors = await service.listDoctors(req.auth!, targetUserId);
  res.json({ success: true, data: { doctors } });
};

export const postDoctor = async (req: Request, res: Response): Promise<void> => {
  const body = req.body as {
    name: string;
    specialty: string;
    clinicName?: string;
    phone?: string;
    targetUserId?: string;
  };
  const doctor = await service.createDoctor(req.auth!, body);
  res.status(201).json({ success: true, data: { doctor } });
};

export const putDoctor = async (req: Request, res: Response): Promise<void> => {
  const doctorId = String(req.params.doctorId);
  const body = req.body as {
    name?: string;
    specialty?: string;
    clinicName?: string | null;
    phone?: string | null;
  };
  const doctor = await service.updateDoctor(req.auth!, { doctorId, ...body });
  res.json({ success: true, data: { doctor } });
};
