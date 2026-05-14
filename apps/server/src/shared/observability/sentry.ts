import * as Sentry from "@sentry/node";
import { env, isProd } from "../../config/env.js";

let initialised = false;

export const initSentry = (): void => {
  if (initialised) return;
  if (!env.SENTRY_DSN) return;

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
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
