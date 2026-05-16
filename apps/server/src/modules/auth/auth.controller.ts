import type { Request, Response } from "express";
import { ok } from "../../shared/http.js";
import * as service from "./auth.service.js";

export const postSendOtp = async (req: Request, res: Response): Promise<void> => {
  const { phone } = req.body as { phone: string };
  const result = await service.sendOtp(phone);
  ok(res, result);
};

export const postVerifyOtp = async (req: Request, res: Response): Promise<void> => {
  const { phone, otp } = req.body as { phone: string; otp: string };
  const result = await service.verifyOtp(phone, otp);
  ok(res, result);
};

export const postRefresh = (req: Request, res: Response): void => {
  const { refreshToken } = req.body as { refreshToken: string };
  const result = service.refreshTokens(refreshToken);
  ok(res, result);
};

export const postPushToken = async (req: Request, res: Response): Promise<void> => {
  const userId = req.auth!.sub;
  const body = req.body as {
    token: string;
    platform: "ios" | "android" | "web";
    deviceId?: string;
  };
  const result = await service.upsertPushToken({ userId, ...body });
  ok(res, result);
};
