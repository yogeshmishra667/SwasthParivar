// Thin HTTP layer for Phase 4 §F.5 prescription routes. All business
// logic lives in the service; controllers only wire request shape onto
// service inputs and surface the typed response.

import type { Request, Response } from "express";
import { DomainError } from "@swasth/shared-types";

import { resolveHouseholdMember } from "../../shared/auth/household.js";
import { ok } from "../../shared/http.js";
import * as service from "./prescriptions.service.js";
import {
  appendPhotosFormFieldsSchema,
  approveBodySchema,
  clarifyBodySchema,
  listPrescriptionsQuerySchema,
  manualItemBodySchema,
  rejectBodySchema,
  uploadFormFieldsSchema,
} from "./prescriptions.validation.js";

const requestIdOf = (req: Request): string => req.requestId ?? "no-request-id";

// ── POST /prescriptions/upload ─────────────────────────────────────

export const postUpload = async (req: Request, res: Response): Promise<void> => {
  // multer wrote the files to `req.files` keyed by field name. Both
  // arrays are optional individually; the service enforces that at
  // least one of them is present.
  const files = (req.files ?? {}) as {
    prescriptionPhotos?: Express.Multer.File[];
    medicinePhotos?: Express.Multer.File[];
  };
  const prescriptionPhotos = (files.prescriptionPhotos ?? []).map((f) => ({
    buffer: f.buffer,
    mimeType: f.mimetype,
  }));
  const medicinePhotos = (files.medicinePhotos ?? []).map((f) => ({
    buffer: f.buffer,
    mimeType: f.mimetype,
  }));

  // multer hands non-file fields as strings on req.body — Zod parses
  // the subset we care about, ignoring stray fields.
  const formFields = (req.body ?? {}) as Record<string, unknown>;
  const parsed = uploadFormFieldsSchema.parse({
    doctorId: typeof formFields.doctorId === "string" ? formFields.doctorId : undefined,
    prescribedDate:
      typeof formFields.prescribedDate === "string" ? formFields.prescribedDate : undefined,
  });

  const targetUserId = await resolveHouseholdMember(
    req.auth!,
    typeof formFields.targetUserId === "string" ? formFields.targetUserId : undefined,
  );

  const result = await service.uploadPrescription({
    auth: req.auth!,
    targetUserId,
    prescriptionPhotos,
    medicinePhotos,
    doctorId: parsed.doctorId,
    prescribedDate: parsed.prescribedDate,
    requestId: requestIdOf(req),
  });
  ok(res, result, 201);
};

// ── GET /prescriptions ─────────────────────────────────────────────

export const list = async (req: Request, res: Response): Promise<void> => {
  const query = listPrescriptionsQuerySchema.parse(req.query);
  const prescriptions = await service.listPrescriptions({
    auth: req.auth!,
    targetUserId: query.targetUserId,
    status: query.status,
  });
  ok(res, { prescriptions });
};

// ── GET /prescriptions/:id ─────────────────────────────────────────

export const getOne = async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id;
  if (typeof id !== "string" || !id)
    throw new DomainError("VALIDATION_ERROR", "missing prescription id");
  const view = await service.getPrescription({
    auth: req.auth!,
    prescriptionId: id,
  });
  ok(res, view);
};

// ── POST /prescriptions/:id/items/:itemId/clarify ──────────────────

export const postClarify = async (req: Request, res: Response): Promise<void> => {
  const prescriptionId = req.params.id;
  const itemId = req.params.itemId;
  if (
    typeof prescriptionId !== "string" ||
    !prescriptionId ||
    typeof itemId !== "string" ||
    !itemId
  ) {
    throw new DomainError("VALIDATION_ERROR", "missing prescription id or item id");
  }
  const file = req.file;
  const formFields = (req.body ?? {}) as Record<string, unknown>;
  const body = clarifyBodySchema.parse({
    typedMedicineName:
      typeof formFields.typedMedicineName === "string" ? formFields.typedMedicineName : undefined,
    approverNote: typeof formFields.approverNote === "string" ? formFields.approverNote : undefined,
    clarificationAttemptId:
      typeof formFields.clarificationAttemptId === "string"
        ? formFields.clarificationAttemptId
        : "",
  });

  const result = await service.clarifyItem({
    auth: req.auth!,
    prescriptionId,
    itemId,
    clarificationAttemptId: body.clarificationAttemptId,
    typedMedicineName: body.typedMedicineName,
    approverNote: body.approverNote,
    photo: file ? { buffer: file.buffer, mimeType: file.mimetype } : undefined,
    requestId: requestIdOf(req),
  });
  ok(res, result, 202);
};

// ── POST /prescriptions/:id/approve ────────────────────────────────

export const postApprove = async (req: Request, res: Response): Promise<void> => {
  const prescriptionId = req.params.id;
  if (typeof prescriptionId !== "string" || !prescriptionId)
    throw new DomainError("VALIDATION_ERROR", "missing prescription id");
  const body = approveBodySchema.parse(req.body);

  const result = await service.approvePrescription({
    auth: req.auth!,
    prescriptionId,
    body,
    requestId: requestIdOf(req),
  });
  ok(res, result);
};

// ── POST /prescriptions/:id/reject ─────────────────────────────────

export const postReject = async (req: Request, res: Response): Promise<void> => {
  const prescriptionId = req.params.id;
  if (typeof prescriptionId !== "string" || !prescriptionId)
    throw new DomainError("VALIDATION_ERROR", "missing prescription id");
  const body = rejectBodySchema.parse(req.body);
  const result = await service.rejectPrescription({
    auth: req.auth!,
    prescriptionId,
    reason: body.reason,
    requestId: requestIdOf(req),
  });
  ok(res, result);
};

// ── POST /prescriptions/:id/photos (§F.10b.2 append) ───────────────

export const postAppendPhotos = async (req: Request, res: Response): Promise<void> => {
  const prescriptionId = req.params.id;
  if (typeof prescriptionId !== "string" || !prescriptionId)
    throw new DomainError("VALIDATION_ERROR", "missing prescription id");

  const files = (req.files ?? {}) as {
    prescriptionPhotos?: Express.Multer.File[];
    medicinePhotos?: Express.Multer.File[];
  };
  const prescriptionPhotos = (files.prescriptionPhotos ?? []).map((f) => ({
    buffer: f.buffer,
    mimeType: f.mimetype,
  }));
  const medicinePhotos = (files.medicinePhotos ?? []).map((f) => ({
    buffer: f.buffer,
    mimeType: f.mimetype,
  }));

  const formFields = (req.body ?? {}) as Record<string, unknown>;
  const parsed = appendPhotosFormFieldsSchema.parse({
    deltaUploadId:
      typeof formFields.deltaUploadId === "string" ? formFields.deltaUploadId : undefined,
  });

  const result = await service.appendPhotos({
    auth: req.auth!,
    prescriptionId,
    deltaUploadId: parsed.deltaUploadId,
    prescriptionPhotos,
    medicinePhotos,
    requestId: requestIdOf(req),
  });
  ok(res, result, 202);
};

// ── POST /prescriptions/:id/items (§F.10b.3 manual add) ────────────

export const postManualItem = async (req: Request, res: Response): Promise<void> => {
  const prescriptionId = req.params.id;
  if (typeof prescriptionId !== "string" || !prescriptionId)
    throw new DomainError("VALIDATION_ERROR", "missing prescription id");
  const body = manualItemBodySchema.parse(req.body);
  const result = await service.addManualItem({
    auth: req.auth!,
    prescriptionId,
    body,
    requestId: requestIdOf(req),
  });
  ok(res, result, 201);
};

// ── POST /medicines/:id/photo (routine cross-check) ────────────────

export const postMedicinePhoto = async (req: Request, res: Response): Promise<void> => {
  const scheduleId = req.params.id;
  if (typeof scheduleId !== "string" || !scheduleId)
    throw new DomainError("VALIDATION_ERROR", "missing medication schedule id");
  const file = req.file;
  if (!file) throw new DomainError("VALIDATION_ERROR", "a `photo` file is required");
  const result = await service.addMedicinePhoto({
    auth: req.auth!,
    scheduleId,
    photo: { buffer: file.buffer, mimeType: file.mimetype },
    requestId: requestIdOf(req),
  });
  ok(res, result, 202);
};
