// Phase 2 step 7 — family/guardian controllers (thin).
//
// Zod-validated body lands here; auth claims drive who is acting.
// Patient creates invites + updates privacy; guardian responds to
// invites + lists their patients + reads patient dashboards.

import type { Request, Response } from "express";
import { DomainError } from "@swasth/shared-types";
import type { FamilyLinkStatus } from "@prisma/client";
import { ok } from "../../shared/http.js";
import { resolveHouseholdMember } from "../../shared/auth/household.js";
import * as service from "./family.service.js";

// req.params is typed as `string | string[] | undefined` under Express
// 5's lazy parser. Narrow + UUID-validate in one helper.
const requireParamUuid = (raw: string | string[] | undefined, name: string): string => {
  if (!raw || typeof raw !== "string") {
    throw new DomainError("VALIDATION_ERROR", `${name} is required`);
  }
  // 8-4-4-4-12 hex; loose enough for v4 + v7.
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(raw)) {
    throw new DomainError("VALIDATION_ERROR", `${name} must be a UUID`);
  }
  return raw;
};

export const postInvite = async (req: Request, res: Response): Promise<void> => {
  const body = req.body as {
    guardianPhone: string;
    targetUserId?: string;
    relationship?: string;
    visibleConditions: string[];
    alertEnabled: boolean;
    alertSensitivity: "low" | "medium" | "high";
  };
  // The invite is for whichever household profile is active on the
  // shared device. `resolveHouseholdMember` returns the JWT subject
  // when `targetUserId` is omitted, and rejects a target outside the
  // caller's household — so a profile can never be invited on behalf
  // of another household.
  const patientId = await resolveHouseholdMember(req.auth!, body.targetUserId);
  const result = await service.createInvite({
    patientId,
    guardianPhone: body.guardianPhone,
    relationship: body.relationship,
    visibleConditions: body.visibleConditions,
    alertEnabled: body.alertEnabled,
    alertSensitivity: body.alertSensitivity,
  });
  ok(res, result, 201);
};

export const postInviteRespond = async (req: Request, res: Response): Promise<void> => {
  const linkId = requireParamUuid(req.params.linkId, "linkId");
  const body = req.body as { decision: "accept" | "decline" };
  const link = await service.respondToInvite({
    guardianId: req.auth!.sub,
    linkId,
    decision: body.decision,
  });
  ok(res, { link });
};

export const putLinkPrivacy = async (req: Request, res: Response): Promise<void> => {
  const linkId = requireParamUuid(req.params.linkId, "linkId");
  const body = req.body as {
    visibleConditions?: string[];
    alertEnabled?: boolean;
    alertSensitivity?: "low" | "medium" | "high";
    revoke?: boolean;
  };
  const link = await service.updatePrivacy({
    callerId: req.auth!.sub,
    callerHouseholdId: req.auth!.householdId,
    linkId,
    visibleConditions: body.visibleConditions,
    alertEnabled: body.alertEnabled,
    alertSensitivity: body.alertSensitivity,
    revoke: body.revoke,
  });
  ok(res, { link });
};

export const getInvites = async (req: Request, res: Response): Promise<void> => {
  const invites = await service.listPendingInvitesForGuardian(req.auth!.sub);
  ok(res, { invites });
};

export const getPatients = async (req: Request, res: Response): Promise<void> => {
  const q = req.query as { status: FamilyLinkStatus };
  const patients = await service.listPatientsForGuardian({
    guardianId: req.auth!.sub,
    status: q.status,
  });
  ok(res, { patients });
};

export const getPatientDashboard = async (req: Request, res: Response): Promise<void> => {
  const patientId = requireParamUuid(req.params.patientId, "patientId");
  const dashboard = await service.getPatientDashboardForGuardian({
    guardianId: req.auth!.sub,
    patientId,
  });
  ok(res, dashboard);
};
