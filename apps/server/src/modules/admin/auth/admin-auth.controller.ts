import type { Request, Response } from "express";
import { ok } from "../../../shared/http.js";
import { isProd } from "../../../config/env.js";
import * as service from "./admin-auth.service.js";
import { ADMIN_REFRESH_MAX_AGE_MS } from "./admin-auth.service.js";

const REFRESH_COOKIE = "admin_refresh";

// Scoped to /admin/auth so the refresh token is sent only to refresh /
// logout, never alongside the data endpoints. httpOnly keeps it out of
// reach of any XSS; SameSite=strict blocks cross-site replay.
const cookieOpts = {
  httpOnly: true,
  secure: isProd,
  sameSite: "strict" as const,
  path: "/admin/auth",
  maxAge: ADMIN_REFRESH_MAX_AGE_MS,
};

const setRefreshCookie = (res: Response, token: string): void => {
  res.cookie(REFRESH_COOKIE, token, cookieOpts);
};

export const postLogin = async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body as { email: string; password: string };
  const result = await service.login(email, password);
  ok(res, result);
};

export const postTotpEnroll = async (req: Request, res: Response): Promise<void> => {
  const { challengeToken } = req.body as { challengeToken: string };
  const result = await service.enrollTotp(challengeToken);
  ok(res, result);
};

export const postTotpConfirm = async (req: Request, res: Response): Promise<void> => {
  const { challengeToken, code } = req.body as { challengeToken: string; code: string };
  const { result, refreshToken } = await service.confirmTotpEnrollment(challengeToken, code);
  setRefreshCookie(res, refreshToken);
  ok(res, result);
};

export const postTotpVerify = async (req: Request, res: Response): Promise<void> => {
  const { challengeToken, code } = req.body as { challengeToken: string; code: string };
  const { result, refreshToken } = await service.verifyTotp(challengeToken, code);
  setRefreshCookie(res, refreshToken);
  ok(res, result);
};

export const postRefresh = async (req: Request, res: Response): Promise<void> => {
  const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
  const { accessToken, refreshToken } = await service.refresh(token);
  setRefreshCookie(res, refreshToken);
  ok(res, { accessToken });
};

export const postLogout = (_req: Request, res: Response): void => {
  res.clearCookie(REFRESH_COOKIE, { path: "/admin/auth" });
  ok(res, { loggedOut: true });
};

export const getMe = async (req: Request, res: Response): Promise<void> => {
  const result = await service.getProfile(req.admin!.id);
  ok(res, result);
};
