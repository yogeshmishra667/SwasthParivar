import * as Sentry from "@sentry/react-native";
import Constants from "expo-constants";

let initialised = false;

const resolveDsn = (): string | undefined => {
  // EXPO_PUBLIC_SENTRY_DSN is inlined at build time by the Expo bundler.
  // app.json `extra.sentryDsn` is the runtime fallback if a release pipeline
  // sets it there instead.
  const envValue: unknown = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (typeof envValue === "string" && envValue.length > 0) return envValue;
  const extra: unknown = Constants.expoConfig?.extra;
  if (extra && typeof extra === "object" && "sentryDsn" in extra) {
    const v = (extra as { sentryDsn?: unknown }).sentryDsn;
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
};

export const initSentry = (): void => {
  if (initialised) return;
  const dsn = resolveDsn();
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: __DEV__ ? "development" : "production",
    // Tracing off by default — pure error capture for now. Bump to 0.1 once
    // we have a release pipeline + can correlate traces with backend Sentry.
    tracesSampleRate: 0,
    // Do not send default PII. Phone/name/Aadhaar/DOB are user-data that
    // never belong in error reports. Matches the server-side policy.
    sendDefaultPii: false,
    // Strip auth headers if axios attaches them to a captured exception.
    beforeSend: (event) => {
      if (event.request?.headers) {
        delete event.request.headers.authorization;
        delete event.request.headers.cookie;
      }
      // Drop the URL query string — it may contain target user ids etc.
      if (event.request?.url) {
        const [pathOnly] = event.request.url.split("?");
        if (pathOnly) event.request.url = pathOnly;
      }
      return event;
    },
  });

  initialised = true;
};

export const captureError = (err: unknown, context?: Record<string, unknown>): void => {
  if (!initialised) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
};

export const isSentryEnabled = (): boolean => initialised;
