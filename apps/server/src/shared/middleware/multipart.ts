// multer factory shared across Phase 4 §F.5 upload routes (prescription
// upload, append-photos, clarify, medicine routine-check).
//
// We use `memoryStorage()` so files arrive as Buffers; the
// `shared/storage/photo-upload` pipeline re-encodes (sharp) and pushes
// to R2. memory storage is fine for 10 MB ceilings — a single Node
// process handles dozens of concurrent uploads without spilling.
//
// Per-file caps mirror CLAUDE.md "File Upload" (Rx 10 MB, strips 5 MB).
// multer enforces them at the wire boundary so a hostile client can't
// stream a multi-GB file before we reject.

import { type Request, type RequestHandler } from "express";
import multer, { type Field, type FileFilterCallback } from "multer";
import { DomainError } from "@swasth/shared-types";

import { MEDICINE_PHOTO_MAX_BYTES, PRESCRIPTION_PHOTO_MAX_BYTES } from "../storage/photo-upload.js";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

const fileFilter = (_req: Request, file: Express.Multer.File, cb: FileFilterCallback): void => {
  if (!ALLOWED_MIME.has(file.mimetype.toLowerCase())) {
    cb(new DomainError("VALIDATION_ERROR", `unsupported content-type ${file.mimetype}`));
    return;
  }
  cb(null, true);
};

const baseLimits = {
  // multer's per-file ceiling. The application layer additionally
  // enforces the kind-specific limit (prescription vs medicine) AFTER
  // multer accepts the file — see `photo-upload.processPhoto`.
  fileSize: Math.max(PRESCRIPTION_PHOTO_MAX_BYTES, MEDICINE_PHOTO_MAX_BYTES),
  // 3 prescription pages + 5 bottle photos = 8. One headroom slot for
  // any future field; multer will still reject the 9th.
  files: 9,
  fields: 32,
} as const;

/**
 * Two-field multipart parser used by `POST /prescriptions/upload` and
 * `POST /prescriptions/:id/photos`. Both arrays are optional — the
 * route enforces "at least one present" at the application layer so
 * the parser stays reusable.
 */
export const prescriptionUploadMultipart: RequestHandler = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: baseLimits,
}).fields([
  { name: "prescriptionPhotos", maxCount: 3 },
  { name: "medicinePhotos", maxCount: 5 },
] satisfies Field[]);

/**
 * Single-photo parser used by `POST /prescriptions/:id/items/:itemId/clarify`
 * (one new bottle photo) and `POST /medicines/:id/photo` (one routine-
 * check photo). multer field name is `photo` in both cases for
 * simplicity at the mobile layer.
 */
export const singlePhotoMultipart: RequestHandler = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: {
    fileSize: MEDICINE_PHOTO_MAX_BYTES,
    files: 1,
    fields: 16,
  },
}).single("photo");

/**
 * Map multer-thrown errors (`LIMIT_FILE_SIZE`, `LIMIT_FILE_COUNT`,
 * `LIMIT_UNEXPECTED_FILE`) into typed DomainErrors. multer raises
 * `MulterError` instances with a `.code` field; we map the codes we
 * actually emit and pass everything else through to the global error
 * handler.
 */
export const mapMulterError = (err: unknown): Error | undefined => {
  if (err instanceof DomainError) return err;
  if (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    (err as { name?: string }).name === "MulterError"
  ) {
    const code = (err as { code?: string }).code;
    if (code === "LIMIT_FILE_SIZE") {
      return new DomainError("UPLOAD_TOO_LARGE", "file exceeds size limit");
    }
    if (code === "LIMIT_FILE_COUNT") {
      return new DomainError("VALIDATION_ERROR", "too many files in one request");
    }
    if (code === "LIMIT_UNEXPECTED_FILE") {
      return new DomainError("VALIDATION_ERROR", "unexpected file field");
    }
  }
  return undefined;
};
