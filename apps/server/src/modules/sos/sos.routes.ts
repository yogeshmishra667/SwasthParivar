// Phase 4 Feature D' — /api/v1/sos router.
//
// Endpoint map (CLAUDE.md "SOS"):
//   POST /trigger                 patient presses SOS
//   POST /:id/cancel              patient/guardian aborts the chain
//   POST /:id/resolve             patient/guardian/admin marks resolved
//   GET  /active                  most-recent non-terminal SOS for re-render
//   POST /webhooks/exotel/status  Exotel call status callback (vendor → us)
//   POST /webhooks/exotel/applet  Exotel applet TwiML response (vendor → us)
//   POST /webhooks/twilio/status  Twilio call status callback (vendor → us)
//
// The webhook routes are mounted BEFORE `requireAuth` because vendors
// authenticate via signed headers, not JWTs.
//
// `sos_enabled` (Redis flag, default false) is enforced inside the
// service so it kills writes AND the worker tick.

import { Router } from "express";
import { requireAuth } from "../../shared/middleware/auth.js";
import { validateBody, validateParams } from "../../shared/validate.js";
import {
  sosCancelSchema,
  sosGuardianPatientParamSchema,
  sosGuardianTriggerSchema,
  sosIdParamSchema,
  sosResolveSchema,
  sosTriggerSchema,
} from "./sos.validation.js";
import * as controller from "./sos.controller.js";
import * as webhooks from "./sos.webhooks.controller.js";

export const sosRouter: Router = Router();

// ── Vendor webhooks (no JWT — vendors sign their own callbacks) ──
sosRouter.post("/webhooks/exotel/status", webhooks.exotelStatusWebhook);
sosRouter.post("/webhooks/exotel/applet", webhooks.exotelAppletResponse);
sosRouter.post("/webhooks/twilio/status", webhooks.twilioStatusWebhook);

// ── Patient/guardian routes — JWT required ───────────────────────
sosRouter.use(requireAuth);

sosRouter.post("/trigger", validateBody(sosTriggerSchema), controller.postTrigger);

sosRouter.post(
  "/:id/cancel",
  validateParams(sosIdParamSchema),
  validateBody(sosCancelSchema),
  controller.postCancel,
);

sosRouter.post(
  "/:id/resolve",
  validateParams(sosIdParamSchema),
  validateBody(sosResolveSchema),
  controller.postResolve,
);

sosRouter.get("/active", controller.getActive);

// Emergency contacts list — the active-SOS screen calls this to
// render "Call {primary} now" instead of the generic dialer.
sosRouter.get("/contacts", controller.getContacts);

// Phase 4 §D'.2 — guardian-initiated remote pull. The auth subject is
// the guardian; the patient is identified by the path param and
// authorised via an accepted `FamilyLink`. Gated by
// `sos_source_guardian_initiated_enabled` (default false).
sosRouter.post(
  "/guardian/:patientId/trigger",
  validateParams(sosGuardianPatientParamSchema),
  validateBody(sosGuardianTriggerSchema),
  controller.postGuardianTrigger,
);
