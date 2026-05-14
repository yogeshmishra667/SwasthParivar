import * as Sentry from "@sentry/node";
import { env, isProd } from "../../config/env.js";

let initialised = false;

// Sentry groups errors by `release` so a regression in v1.2.3 stands out
// from background noise. Set GIT_SHA at image-build time (`docker build
// --build-arg GIT_SHA=$(git rev-parse HEAD)` or via CI), or fall back to
// the npm version. Either is fine; "missing release" is what we avoid.
const resolveRelease = (): string | undefined => {
  const sha = process.env.GIT_SHA;
  if (typeof sha === "string" && sha.length > 0) return `swasth-server@${sha.slice(0, 12)}`;
  const pkgVersion = process.env.npm_package_version;
  if (typeof pkgVersion === "string" && pkgVersion.length > 0) {
    return `swasth-server@${pkgVersion}`;
  }
  return undefined;
};

export const initSentry = (): void => {
  if (initialised) return;
  if (!env.SENTRY_DSN) return;

  const release = resolveRelease();

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    ...(release ? { release } : {}),
    tracesSampleRate: 0,
    // PII redaction lives in the Pino logger; do not duplicate user data into Sentry.
    sendDefaultPii: false,
    beforeSend: (event) => {
      if (event.request?.headers) {
        delete event.request.headers.authorization;
        delete event.request.headers.cookie;
      }
      return event;
    },
  });

  initialised = true;
};

export const captureUnhandled = (err: unknown, context?: Record<string, unknown>): void => {
  if (!initialised) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
};

export const isSentryEnabled = (): boolean => initialised;

// In production without a DSN we surface a one-line warning so misconfigured
// deploys don't silently lose error visibility.
export const warnIfMisconfigured = (warn: (msg: string) => void): void => {
  if (isProd && !env.SENTRY_DSN) {
    warn("SENTRY_DSN missing in production — server errors will not be captured");
  }
};
