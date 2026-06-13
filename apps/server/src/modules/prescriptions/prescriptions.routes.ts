// Phase 4 §F.5 / §F.6 prescription router. Routes:
//
//   POST   /upload                         multipart, paired upload
//   GET    /                               list (status-filtered; dashboard nudge)
//   GET    /:id                            full prescription detail
//   POST   /:id/photos                     append missed pages/bottles (§F.10b.2)
//   POST   /:id/items                      approver manual-add (§F.10b.3)
//   POST   /:id/items/:itemId/clarify      mid-approval clarification
//   POST   /:id/approve                    per-item decisions
//   POST   /:id/reject                     whole-prescription reject
//
// Auth: `requireAuth` on the whole router — JWT carries the household
// and user id. Per-action authority (caller vs resolved approver vs
// household read) is enforced in the service layer.

import { type NextFunction, type Request, type Response, Router } from "express";

import { requireAuth } from "../../shared/middleware/auth.js";
import {
  mapMulterError,
  prescriptionUploadMultipart,
  singlePhotoMultipart,
} from "../../shared/middleware/multipart.js";
import * as controller from "./prescriptions.controller.js";

export const prescriptionsRouter: Router = Router();

prescriptionsRouter.use(requireAuth);

/**
 * Wrap multer's callback-style middleware so its errors run through the
 * `mapMulterError` mapper before reaching the global error handler.
 * Without this, `LIMIT_FILE_SIZE` would surface as `INTERNAL_ERROR`.
 */
const wrapMulter =
  (mw: (req: Request, res: Response, next: NextFunction) => void) =>
  (req: Request, res: Response, next: NextFunction): void => {
    mw(req, res, (err: unknown) => {
      if (!err) return next();
      const mapped = mapMulterError(err);
      next(mapped ?? err);
    });
  };

prescriptionsRouter.post("/upload", wrapMulter(prescriptionUploadMultipart), controller.postUpload);

// List MUST be registered before "/:id" so "/" isn't captured as an id.
prescriptionsRouter.get("/", controller.list);

prescriptionsRouter.get("/:id", controller.getOne);

prescriptionsRouter.post(
  "/:id/photos",
  wrapMulter(prescriptionUploadMultipart),
  controller.postAppendPhotos,
);

prescriptionsRouter.post("/:id/items", controller.postManualItem);

prescriptionsRouter.post(
  "/:id/items/:itemId/clarify",
  wrapMulter(singlePhotoMultipart),
  controller.postClarify,
);

prescriptionsRouter.post("/:id/approve", controller.postApprove);

prescriptionsRouter.post("/:id/reject", controller.postReject);
