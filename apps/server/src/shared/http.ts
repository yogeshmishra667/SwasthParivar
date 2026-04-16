import type { Response } from "express";
import type { ApiSuccess } from "@swasth/shared-types";

export const ok = <T>(res: Response, data: T, status = 200): Response => {
  const body: ApiSuccess<T> = { success: true, data };
  return res.status(status).json(body);
};
