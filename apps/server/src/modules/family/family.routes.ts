// Phase 2 step 7 — /api/v1/family router.
//
// Endpoint map (CLAUDE.md "Family & Profiles"):
//   POST /invite                          patient invites a guardian
//   GET  /invites                         guardian lists their pending invites
//   POST /invites/:linkId/respond         guardian accepts | declines
//   PUT  /links/:linkId/privacy           patient updates visibility /
//                                         either side revokes
//   GET  /patients?status=accepted        guardian's connected patients
//   GET  /patients/:patientId/dashboard   PII-stripped read-only view
//
// Alerts endpoint is intentionally NOT mounted in Phase 2.

import { Router } from "express";
import { requireAuth } from "../../shared/middleware/auth.js";
import { requirePrimary } from "../../shared/middleware/require-primary.js";
import { validateBody, validateQuery } from "../../shared/validate.js";
import {
  inviteCreateSchema,
  inviteRespondSchema,
  privacyUpdateSchema,
  listPatientsQuerySchema,
} from "./family.validation.js";
import * as controller from "./family.controller.js";

export const familyRouter: Router = Router();

familyRouter.use(requireAuth);

// Every family endpoint represents an action only the household primary
// can take. Patient-side calls (invite, privacy) are issued by the
// primary on behalf of a household profile via `targetUserId`; the
// guardian-side calls (invites/respond, patients, dashboard) only make
// sense for a primary who actually holds guardian links. Sub-profiles
// have no JWT today, but `requirePrimary` locks the invariant so a
// future refactor cannot silently widen the surface.
familyRouter.use(requirePrimary);

familyRouter.post("/invite", validateBody(inviteCreateSchema), controller.postInvite);

familyRouter.get("/invites", controller.getInvites);

familyRouter.post(
  "/invites/:linkId/respond",
  validateBody(inviteRespondSchema),
  controller.postInviteRespond,
);

familyRouter.put(
  "/links/:linkId/privacy",
  validateBody(privacyUpdateSchema),
  controller.putLinkPrivacy,
);

familyRouter.get("/patients", validateQuery(listPatientsQuerySchema), controller.getPatients);

familyRouter.get("/patients/:patientId/dashboard", controller.getPatientDashboard);
