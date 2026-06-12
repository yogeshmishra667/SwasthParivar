// Phase 4 Feature G.2 — /api/v1/appointments router.
//
// Endpoint map:
//   POST /                       create an appointment
//   GET  /                       list (cursor-paginated, ?from=&to=&status=)
//   PUT  /:appointmentId         edit (reschedule resets reminder flags)
//   POST /:appointmentId/complete  mark the visit completed
//
// All require `requireAuth`; the `doctor_portal_enabled` kill-switch is
// enforced in the service layer (503 DOCTOR_PORTAL_DISABLED when off).

import { Router } from "express";
import { requireAuth } from "../../shared/middleware/auth.js";
import { validateBody, validateQuery } from "../../shared/validate.js";
import {
  createAppointmentSchema,
  listAppointmentsQuerySchema,
  updateAppointmentSchema,
} from "./appointments.validation.js";
import * as controller from "./appointments.controller.js";

export const appointmentsRouter: Router = Router();

appointmentsRouter.use(requireAuth);

appointmentsRouter.post("/", validateBody(createAppointmentSchema), controller.postAppointment);
appointmentsRouter.get("/", validateQuery(listAppointmentsQuerySchema), controller.getAppointments);
appointmentsRouter.put(
  "/:appointmentId",
  validateBody(updateAppointmentSchema),
  controller.putAppointment,
);
appointmentsRouter.post("/:appointmentId/complete", controller.completeAppointmentController);
