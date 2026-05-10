import type { Request, Response } from "express";
import { ok } from "../../shared/http.js";
import * as service from "./household.service.js";
import type { AddHouseholdProfileInput } from "./household.validation.js";

/**
 * `POST /api/v1/household/profiles` — adds a profile to the caller's
 * household (the same `householdId` the caller belongs to).
 *
 * Returns 201 with the new profile shape used by `GET /users/me`'s
 * `householdProfiles` list, so the mobile client can splice the result
 * into its profile-switcher without an extra round-trip.
 */
export const postAddProfile = async (req: Request, res: Response): Promise<void> => {
  const callerUserId = req.auth!.sub;
  const body = req.body as AddHouseholdProfileInput;
  const result = await service.addHouseholdProfile(callerUserId, body);
  ok(res, result, 201);
};
