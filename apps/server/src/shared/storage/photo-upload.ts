// Photo-upload pipeline shared by Phase 4 §F.5 prescription routes.
// multer hands us in-memory buffers; this module strips EXIF, normalises
// the image, uploads to R2, and returns the photo URL + key + size.
//
// EXIF strip is mandatory — Indian-Android cameras embed GPS in the
// EXIF block by default. A prescription photo with location metadata
// would let an exfiltration of the R2 bucket reveal where the patient
// lives. `sharp({ failOn: "truncated" }).rotate().toFormat(...)` does
// the strip implicitly (sharp does NOT copy EXIF unless asked).
//
// We re-encode JPEG-or-better at quality 88 — high enough for Vision
// OCR to read handwriting, low enough that a 4MB phone photo lands at
// ~600KB in R2. PNG/WEBP pass through their respective re-encoders.
//
// Scope limits per CLAUDE.md "File Upload":
//   • Prescription pages: ≤ 10MB per file, max 3 pages per request.
//   • Medicine bottles:   ≤ 5MB per file, max 5 bottles per request.
// Enforced both by multer (server-side max) AND by the explicit count
// checks in `validateUploadCounts()` — multer cannot reject by count.

import { randomUUID } from "node:crypto";
import type { Buffer } from "node:buffer";

import sharp from "sharp";
import { DomainError } from "@swasth/shared-types";

import { logger } from "../logger.js";
import { uploadObject, type UploadedObject } from "./r2.js";

export const PRESCRIPTION_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const MEDICINE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const MAX_PRESCRIPTION_PHOTOS_PER_UPLOAD = 3;
export const MAX_MEDICINE_PHOTOS_PER_UPLOAD = 5;

const ALLOWED_INPUT_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export type PhotoKind = "prescription" | "medicine_bottle";

export interface ProcessedPhoto {
  readonly key: string;
  readonly url: string;
  readonly bytes: number;
  readonly contentType: string;
  readonly width: number;
  readonly height: number;
}

interface ProcessPhotoInput {
  readonly buffer: Buffer;
  readonly mimeType: string;
  readonly kind: PhotoKind;
  /**
   * Anchor identifier for the R2 key — typically the prescriptionId so
   * every artifact of one upload lives under the same prefix and
   * `aws s3 ls s3://bucket/prescriptions/${rxId}/` lists everything.
   */
  readonly scopeId: string;
}

const sizeLimitFor = (kind: PhotoKind): number =>
  kind === "prescription" ? PRESCRIPTION_PHOTO_MAX_BYTES : MEDICINE_PHOTO_MAX_BYTES;

const r2KeyFor = (kind: PhotoKind, scopeId: string, ext: string): string => {
  // Top-level prefix mirrors the lifecycle (prescriptions vs medicines)
  // so bucket-policy filtering + retention rules can target one without
  // touching the other.
  const prefix = kind === "prescription" ? "prescriptions" : "medicine-photos";
  return `${prefix}/${scopeId}/${randomUUID()}.${ext}`;
};

/**
 * Run one buffer through the EXIF-strip + re-encode + R2-upload
 * pipeline. Throws `UPLOAD_TOO_LARGE` if oversized; `VALIDATION_ERROR`
 * on an unsupported MIME; storage failures bubble as
 * `STORAGE_UNAVAILABLE`.
 */
export const processPhoto = async (input: ProcessPhotoInput): Promise<ProcessedPhoto> => {
  if (input.buffer.byteLength > sizeLimitFor(input.kind)) {
    throw new DomainError(
      "UPLOAD_TOO_LARGE",
      `${input.kind} photo exceeds ${sizeLimitFor(input.kind)} bytes`,
    );
  }
  if (!ALLOWED_INPUT_MIME.has(input.mimeType.toLowerCase())) {
    throw new DomainError(
      "VALIDATION_ERROR",
      `unsupported photo content-type ${input.mimeType} — must be jpeg/png/webp`,
    );
  }

  let outBuffer: Buffer;
  let outMime: string;
  let outExt: string;
  let metadata: sharp.Metadata;

  try {
    const pipeline = sharp(input.buffer, { failOn: "truncated" }).rotate();
    if (input.mimeType === "image/png") {
      const out = await pipeline.png({ compressionLevel: 8 }).toBuffer({ resolveWithObject: true });
      outBuffer = out.data;
      outMime = "image/png";
      outExt = "png";
      metadata = out.info as unknown as sharp.Metadata;
    } else if (input.mimeType === "image/webp") {
      const out = await pipeline.webp({ quality: 88 }).toBuffer({ resolveWithObject: true });
      outBuffer = out.data;
      outMime = "image/webp";
      outExt = "webp";
      metadata = out.info as unknown as sharp.Metadata;
    } else {
      const out = await pipeline
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
      outBuffer = out.data;
      outMime = "image/jpeg";
      outExt = "jpg";
      metadata = out.info as unknown as sharp.Metadata;
    }
  } catch (err) {
    logger.warn({ err, kind: input.kind }, "sharp re-encode failed — rejecting upload");
    throw new DomainError(
      "VALIDATION_ERROR",
      "photo is corrupt or could not be re-encoded — try again",
    );
  }

  const uploaded: UploadedObject = await uploadObject({
    key: r2KeyFor(input.kind, input.scopeId, outExt),
    body: outBuffer,
    contentType: outMime,
  });

  return {
    key: uploaded.key,
    url: uploaded.url,
    bytes: uploaded.bytes,
    contentType: uploaded.contentType,
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
  };
};

/**
 * Server-side defence-in-depth on the per-array counts. multer can cap
 * total bytes but not per-field array length, so we enforce here.
 */
export const validateUploadCounts = (input: {
  prescriptionCount: number;
  medicineCount: number;
}): void => {
  if (input.prescriptionCount === 0 && input.medicineCount === 0) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "at least one prescription photo OR one medicine photo is required",
    );
  }
  if (input.prescriptionCount > MAX_PRESCRIPTION_PHOTOS_PER_UPLOAD) {
    throw new DomainError(
      "VALIDATION_ERROR",
      `too many prescription photos — max ${MAX_PRESCRIPTION_PHOTOS_PER_UPLOAD}`,
    );
  }
  if (input.medicineCount > MAX_MEDICINE_PHOTOS_PER_UPLOAD) {
    throw new DomainError(
      "VALIDATION_ERROR",
      `too many medicine photos — max ${MAX_MEDICINE_PHOTOS_PER_UPLOAD}`,
    );
  }
};
