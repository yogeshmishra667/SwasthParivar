/**
 * Lazy Firebase Admin SDK initializer.
 *
 * Loaded only when the OTP provider flag is "firebase" (see
 * `apps/server/src/modules/auth/auth.service.ts`). Keeping init lazy
 * means dev environments without `FIREBASE_SERVICE_ACCOUNT_JSON` set
 * boot fine, and the test suite never accidentally touches the
 * Firebase REST endpoints.
 *
 * The service account JSON comes from a single env var rather than
 * three fields so it can be injected as one secret manager entry. The
 * structure matches what Firebase Console → Service Accounts →
 * Generate new private key produces.
 */
import { cert, deleteApp, getApp, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import { DomainError } from "@swasth/shared-types";
import { env } from "../../config/env.js";
import { logger } from "../logger.js";

const APP_NAME = "swasth-auth";

interface ServiceAccountShape {
  project_id: string;
  client_email: string;
  private_key: string;
}

let cachedApp: App | null = null;

const initApp = (): App => {
  if (cachedApp) return cachedApp;

  // Reuse if the test harness (or hot-reload) already initialised the
  // named app under us. getApps() with no arg returns the default app;
  // we use a named app so other Firebase usage (if added later) doesn't
  // collide.
  const existing = getApps().find((a) => a.name === APP_NAME);
  if (existing) {
    cachedApp = existing;
    return existing;
  }

  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    throw new DomainError(
      "INTERNAL_ERROR",
      "FIREBASE_SERVICE_ACCOUNT_JSON missing — set the env var or flip auth.otp.provider away from firebase",
    );
  }

  let parsed: ServiceAccountShape;
  try {
    parsed = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON) as ServiceAccountShape;
  } catch (err) {
    logger.error({ err }, "FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON");
    throw new DomainError("INTERNAL_ERROR", "firebase service account JSON malformed");
  }

  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new DomainError(
      "INTERNAL_ERROR",
      "firebase service account JSON missing required fields",
    );
  }

  cachedApp = initializeApp(
    {
      credential: cert({
        projectId: parsed.project_id,
        clientEmail: parsed.client_email,
        // Newlines in the private key are usually escaped (\\n) when the
        // JSON is stored as a single-line env var. Unescape so the JWT
        // signer can use them.
        privateKey: parsed.private_key.replace(/\\n/g, "\n"),
      }),
      projectId: parsed.project_id,
    },
    APP_NAME,
  );

  logger.info({ projectId: parsed.project_id }, "firebase-admin initialised");
  return cachedApp;
};

/**
 * Verify a Firebase ID token issued by the mobile app's
 * `@react-native-firebase/auth` Phone Auth flow. Returns the decoded
 * token (includes the verified `phone_number` claim) or throws
 * `AUTH_OTP_INVALID` for any verification failure — same error code we
 * use for our own OTP path, so the client UX is identical.
 */
export const verifyFirebaseIdToken = async (idToken: string): Promise<DecodedIdToken> => {
  const app = initApp();
  try {
    return await getAuth(app).verifyIdToken(idToken, /* checkRevoked */ true);
  } catch (err) {
    logger.warn({ err }, "firebase id token verification failed");
    throw new DomainError("AUTH_OTP_INVALID", "invalid firebase id token");
  }
};

// Test seam — let integration tests reset the lazy app between suites.
export const __resetFirebaseAdmin = async (): Promise<void> => {
  cachedApp = null;
  // Detach the named app so initializeApp doesn't throw on next init.
  try {
    const existing = getApp(APP_NAME);
    await deleteApp(existing);
  } catch {
    // not initialised — nothing to clean up
  }
};
