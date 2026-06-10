// Phase 4 §F.6 — `/api/v1/medicines` router. Currently a single route:
//
//   POST /medicines/:id/photo   post-schedule routine bottle cross-check
//
// `:id` is a `MedicationSchedule.id`. The handler stores one bottle
// photo (`uploadedAt: post_schedule_routine_check`) and enqueues
// `MEDICINE_PHOTO_CROSS_CHECK`, which compares the AI-read bottle name
// to the schedule's `medicineName` and writes `matchStatus`. Mismatch is
// FLAG-ONLY — it never auto-disables a schedule (phase4.md §F.8).
//
// Lives in the prescriptions module because it shares the MedicinePhoto
// model, the cross-check worker, and the photo-upload pipeline. Mounted
// under its own `/medicines` prefix to match the CLAUDE.md API contract.

import { type NextFunction, type Request, type Response, Router } from "express";

import { requireAuth } from "../../shared/middleware/auth.js";
import { mapMulterError, singlePhotoMultipart } from "../../shared/middleware/multipart.js";
import * as controller from "./prescriptions.controller.js";

export const medicinesRouter: Router = Router();

medicinesRouter.use(requireAuth);

const wrapMulter =
  (mw: (req: Request, res: Response, next: NextFunction) => void) =>
  (req: Request, res: Response, next: NextFunction): void => {
    mw(req, res, (err: unknown) => {
      if (!err) return next();
      const mapped = mapMulterError(err);
      next(mapped ?? err);
    });
  };

medicinesRouter.post("/:id/photo", wrapMulter(singlePhotoMultipart), controller.postMedicinePhoto);
