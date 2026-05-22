// Phase 3 Feature C — Silent Guardian controllers (thin).
//
// Zod-validated query / body lands here; the auth `sub` is always the
// guardian. Patient-scoped authorisation is enforced in the service.

import type { Request, Response } from "express";
import { DomainError } from "@swasth/shared-types";
import type { GuardianAlertType } from "@prisma/client";
import { ok } from "../../shared/http.js";
import * as service from "./silent-guardian.service.js";
import type { AlertActionTaken } from "./silent-guardian.types.js";

// req.params is typed as `string | string[] | undefined` under Express
// 5's lazy parser. Narrow + UUID-validate in one helper (same pattern
// as family.controller).
const requireParamUuid = (raw: string | string[] | undefined, name: string): string => {
  if (!raw || typeof raw !== "string") {
    throw new DomainError("VALIDATION_ERROR", `${name} is required`);
  }
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(raw)) {
    throw new DomainError("VALIDATION_ERROR", `${name} must be a UUID`);
  }
  return raw;
};

export const getAlerts = async (req: Request, res: Response): Promise<void> => {
  // validateQuery has already parsed + coerced req.query (limit → number).
  const q = req.query as unknown as {
    patientId?: string;
    type?: GuardianAlertType;
    limit: number;
    cursor?: string;
  };
  const page = await service.listAlertsForGuardian({
    guardianId: req.auth!.sub,
    patientId: q.patientId,
    type: q.type,
    limit: q.limit,
    cursor: q.cursor,
  });
  ok(res, page);
};

export const postAlertRead = async (req: Request, res: Response): Promise<void> => {
  const alertId = requireParamUuid(req.params.alertId, "alertId");
  const alert = await service.markAlertRead({ guardianId: req.auth!.sub, alertId });
  ok(res, { alert });
};

export const postAlertFeedback = async (req: Request, res: Response): Promise<void> => {
  const alertId = requireParamUuid(req.params.alertId, "alertId");
  const body = req.body as { helpful: boolean; actionTaken?: AlertActionTaken };
  const alert = await service.recordAlertFeedback({
    guardianId: req.auth!.sub,
    alertId,
    helpful: body.helpful,
    actionTaken: body.actionTaken,
  });
  ok(res, { alert });
};

export const getDailySummary = async (req: Request, res: Response): Promise<void> => {
  const patientId = requireParamUuid(req.params.patientId, "patientId");
  const summary = await service.getDailySummaryForPatient({
    guardianId: req.auth!.sub,
    patientId,
  });
  ok(res, summary);
};
