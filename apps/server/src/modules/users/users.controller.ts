import type { Request, Response } from "express";
import { ok } from "../../shared/http.js";
import * as service from "./users.service.js";
import type { UpdatePreferencesInput, UpdateProfileInput } from "./users.validation.js";

export const getMe = async (req: Request, res: Response): Promise<void> => {
  const result = await service.getProfile(req.auth!.sub);
  ok(res, result);
};

export const patchMe = async (req: Request, res: Response): Promise<void> => {
  const input = req.body as UpdateProfileInput;
  const result = await service.updateProfile(req.auth!.sub, input);
  ok(res, result);
};

export const getPreferences = async (req: Request, res: Response): Promise<void> => {
  const result = await service.getPreferences(req.auth!.sub);
  ok(res, result);
};

export const updatePreferences = async (req: Request, res: Response): Promise<void> => {
  const input = req.body as UpdatePreferencesInput;
  const result = await service.updatePreferences(req.auth!.sub, input);
  ok(res, result);
};
