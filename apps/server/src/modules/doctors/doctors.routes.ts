// Phase 4 Feature G.2 — /api/v1/doctors router.
//
// Endpoint map:
//   GET  /              list caller's (or sub-profile's) doctors
//   POST /              create a doctor profile
//   PUT  /:doctorId     edit a doctor profile
//
// All require `requireAuth`. The kill-switch (`doctor_portal_enabled`)
// is enforced in the service layer (mirrors cardiac/respiratory) so a
// disabled portal returns 503 DOCTOR_PORTAL_DISABLED with auth still
// checked first. No DELETE: deleting a doctor would orphan appointments
// and the prescriptions.doctor_id FK; the address-book entry is cheap to
// keep, and Phase 4 has no delete requirement.

import { Router } from "express";
import { requireAuth } from "../../shared/middleware/auth.js";
import { validateBody, validateQuery } from "../../shared/validate.js";
import {
  createDoctorSchema,
  listDoctorsQuerySchema,
  updateDoctorSchema,
} from "./doctors.validation.js";
import * as controller from "./doctors.controller.js";

export const doctorsRouter: Router = Router();

doctorsRouter.use(requireAuth);

doctorsRouter.get("/", validateQuery(listDoctorsQuerySchema), controller.getDoctors);
doctorsRouter.post("/", validateBody(createDoctorSchema), controller.postDoctor);
doctorsRouter.put("/:doctorId", validateBody(updateDoctorSchema), controller.putDoctor);
