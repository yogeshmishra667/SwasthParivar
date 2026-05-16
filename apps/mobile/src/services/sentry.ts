import * as Sentry from "@sentry/react-native";
import Constants from "expo-constants";

let initialised = false;

const resolveExtra = (): Record<string, unknown> => {
  const extra: unknown = Constants.expoConfig?.extra;
  return extra && typeof extra === "object" ? (extra as Record<string, unknown>) : {};
};

const stringFromEnvOrExtra = (
  envName: string,
  extraKey: string,
  extra: Record<string, unknown>,
): string | undefined => {
  const envValue: unknown = process.env[envName];
  if (typeof envValue === "string" && envValue.length > 0) return envValue;
  const fromExtra = extra[extraKey];
  if (typeof fromExtra === "string" && fromExtra.length > 0) return fromExtra;
  return undefined;
};

const resolveEnvironment = (extra: Record<string, unknown>): string => {
  // Explicit override wins. EAS `preview` and `production` profiles set
  // their own value at build time (see apps/mobile/eas.json). Without
  // it, dev = "development", everything else = "production" — that
  // conflated preview builds with prod, which we now avoid.
  const explicit = stringFromEnvOrExtra("EXPO_PUBLIC_APP_ENV", "environment", extra);
  if (explicit) return explicit;
  return __DEV__ ? "development" : "production";
};

const resolveRelease = (extra: Record<string, unknown>): string | undefined => {
  // Sentry groups errors by release — without it we can't tell "v1.2.3
  // started crashing after the Tuesday deploy" from background noise.
  // Prefer an explicit build-time env, fall back to app version + build
  // number, then return undefined (Sentry will skip the field).
  const explicit = stringFromEnvOrExtra("EXPO_PUBLIC_SENTRY_RELEASE", "sentryRelease", extra);
  if (explicit) return explicit;
  const version = Constants.expoConfig?.version;
  if (typeof version === "string" && version.length > 0) {
    return `swasth-mobile@${version}`;
  }
  return undefined;
};

export const initSentry = (): void => {
  if (initialised) return;
  const extra = resolveExtra();
  const dsn = stringFromEnvOrExtra("EXPO_PUBLIC_SENTRY_DSN", "sentryDsn", extra);
  if (!dsn) return;

  const release = resolveRelease(extra);

  Sentry.init({
    dsn,
    environment: resolveEnvironment(extra),
    ...(release ? { release } : {}),
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
