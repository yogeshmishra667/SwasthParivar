// Cloudflare R2 storage helper — S3-compatible client wrapping
// `@aws-sdk/client-s3`. Used by Phase 4 §F.5 upload routes (prescription
// photos + medicine-bottle photos) and any future image surfaces.
//
// Design notes:
//   • The SDK client is lazily instantiated so a server without R2 env
//     vars (dev / test) doesn't crash at import time — the cost is paid
//     on the first real upload.
//   • R2 exposes an S3-compatible endpoint at
//     `https://<account-id>.r2.cloudflarestorage.com`. Region is "auto"
//     per Cloudflare docs — the SDK still requires a non-empty value.
//   • EXIF stripping happens in the upload route via `sharp`, not here.
//     This helper assumes the buffer is already sanitised.
//   • Public-URL strategy: if `R2_PUBLIC_BASE_URL` is set (recommended:
//     a Cloudflare-managed custom domain), we return a stable
//     `${base}/${key}` URL. If unset, we mint a presigned GET URL with
//     a 1-hour TTL so the Vision worker can still fetch the object
//     before approval — this is the dev-loop fallback.
//
// Failure modes:
//   • Missing env → `STORAGE_UNAVAILABLE` 503 at the upload boundary.
//   • PutObject throw → propagates; the upload route surfaces as 503
//     with the underlying SDK error logged.

import type { Buffer } from "node:buffer";

import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { DomainError } from "@swasth/shared-types";

import { env } from "../../config/env.js";
import { logger } from "../logger.js";

let client: S3Client | null = null;

const getClient = (): S3Client => {
  if (client) return client;
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY || !env.R2_SECRET_KEY || !env.R2_BUCKET) {
    throw new DomainError(
      "STORAGE_UNAVAILABLE",
      "R2 storage is not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET",
    );
  }
  client = new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY,
      secretAccessKey: env.R2_SECRET_KEY,
    },
  });
  return client;
};

/** Test hook — call with `null` to reset to the production lazy path. */
export const __setR2ClientForTests = (override: S3Client | null): void => {
  client = override;
};

export interface UploadObjectInput {
  readonly key: string;
  readonly body: Buffer;
  readonly contentType: string;
  /**
   * Cache-Control header to write on the object. R2 forwards this on
   * Cloudflare-served reads. Prescription photos are immutable per id —
   * a 1-year cache is safe.
   */
  readonly cacheControl?: string;
}

export interface UploadedObject {
  readonly key: string;
  readonly url: string;
  readonly bytes: number;
  readonly contentType: string;
}

/**
 * Upload a buffer to R2 under the given key and return a fetchable URL.
 * The URL is stable+public when `R2_PUBLIC_BASE_URL` is set, otherwise
 * a 1-hour presigned GET URL.
 */
export const uploadObject = async (input: UploadObjectInput): Promise<UploadedObject> => {
  const c = getClient();
  await c.send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET!,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
      CacheControl: input.cacheControl ?? "private, max-age=86400",
    }),
  );
  const url = await resolveObjectUrl(input.key);
  return {
    key: input.key,
    url,
    bytes: input.body.byteLength,
    contentType: input.contentType,
  };
};

const resolveObjectUrl = async (key: string): Promise<string> => {
  if (env.R2_PUBLIC_BASE_URL) {
    return `${env.R2_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}`;
  }
  // Presigned fallback. 1 hour is long enough for the OCR worker to
  // fetch the image once before BullMQ retries land.
  return await getSignedUrl(
    getClient(),
    new GetObjectCommand({ Bucket: env.R2_BUCKET!, Key: key }),
    { expiresIn: 3600 },
  );
};

/**
 * Refresh the fetchable URL for an existing object — used by the
 * detail-fetch endpoint when serving stored photos to the approver
 * after the original presigned TTL has lapsed.
 */
export const refreshObjectUrl = async (key: string): Promise<string> => await resolveObjectUrl(key);

/**
 * Sanity-check that storage is reachable. Used by `/health/deep` and
 * during boot logging. Never throws; logs + returns false on failure
 * so the health check can summarise.
 */
export const isStorageReachable = (): boolean => {
  try {
    getClient();
    return true;
  } catch (err) {
    logger.warn({ err }, "R2 not reachable");
    return false;
  }
};
