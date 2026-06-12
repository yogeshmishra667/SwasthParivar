// Phase 4 Feature G.2 — appointment CRUD controller.

import type { Request, Response } from "express";
import * as service from "./appointments.service.js";
import type { AppointmentStatusDto } from "./appointments.types.js";

export const postAppointment = async (req: Request, res: Response): Promise<void> => {
  const body = req.body as {
    doctorId: string;
    scheduledAt: Date;
    purpose: string;
    targetUserId?: string;
  };
  const appointment = await service.createAppointment(req.auth!, body);
  res.status(201).json({ success: true, data: { appointment } });
};

export const getAppointments = async (req: Request, res: Response): Promise<void> => {
  const q = req.query as unknown as {
    from?: Date;
    to?: Date;
    status?: AppointmentStatusDto;
    targetUserId?: string;
    limit: number;
    cursor?: string;
  };
  const page = await service.listAppointments(req.auth!, q);
  res.json({ success: true, data: page });
};

export const putAppointment = async (req: Request, res: Response): Promise<void> => {
  const appointmentId = String(req.params.appointmentId);
  const body = req.body as {
    scheduledAt?: Date;
    purpose?: string;
    status?: AppointmentStatusDto;
  };
  const appointment = await service.updateAppointment(req.auth!, { appointmentId, ...body });
  res.json({ success: true, data: { appointment } });
};

export const completeAppointmentController = async (req: Request, res: Response): Promise<void> => {
  const appointmentId = String(req.params.appointmentId);
  const appointment = await service.completeAppointment(req.auth!, appointmentId);
  res.json({ success: true, data: { appointment } });
};
