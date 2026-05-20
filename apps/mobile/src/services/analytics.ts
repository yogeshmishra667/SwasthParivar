import PostHog from "posthog-react-native";
import Constants from "expo-constants";
import axios from "axios";

const extra = Constants.expoConfig?.extra as
  | { posthogKey?: string; posthogHost?: string }
  | undefined;

const stringFromEnvOrExtra = (
  envName: string,
  extraValue: string | undefined,
): string | undefined => {
  const envValue: unknown = process.env[envName];
  if (typeof envValue === "string" && envValue.length > 0) return envValue;
  if (typeof extraValue === "string" && extraValue.length > 0) return extraValue;
  return undefined;
};

// Var name follows docs/SETUP.md ("Step 3 — Option B"). Mobile uses
// EXPO_PUBLIC_POSTHOG_KEY (NOT _API_KEY) so it visually matches the
// EAS env command we tell teammates to run.
const apiKey = stringFromEnvOrExtra("EXPO_PUBLIC_POSTHOG_KEY", extra?.posthogKey);

// Default to the US ingest host to match `apps/server/src/shared/
// analytics/posthog.ts`. EU teams override via `EXPO_PUBLIC_POSTHOG_HOST`
// or `app.json` → `extra.posthogHost = "https://eu.i.posthog.com"`.
const host =
  stringFromEnvOrExtra("EXPO_PUBLIC_POSTHOG_HOST", extra?.posthogHost) ??
  "https://us.i.posthog.com";

export const analytics = apiKey ? new PostHog(apiKey, { host }) : null;

type JsonPrimitive = string | number | boolean | null;
export type EventProps = Record<string, JsonPrimitive | JsonPrimitive[]>;

export const track = (event: string, props?: EventProps): void => {
  analytics?.capture(event, props);
};

export const logError = (screen: string, error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  const props: EventProps = { screen, message };

  // An axios "Network Error" / timeout carries no useful message on its
  // own. Pull the request target + HTTP detail so PostHog and the dev
  // console show *what* failed (which URL, which status), not just that
  // something did — e.g. a stale dev-server IP surfaces as the `request`
  // host with `errorCode: ERR_NETWORK`.
  if (axios.isAxiosError(error)) {
    if (error.code !== undefined) props.errorCode = error.code;
    const cfg = error.config;
    if (cfg?.url !== undefined) {
      props.request = `${(cfg.method ?? "get").toUpperCase()} ${cfg.baseURL ?? ""}${cfg.url}`;
    }
    if (error.response !== undefined) {
      props.httpStatus = error.response.status;
      const data = error.response.data as { error?: { code?: string } } | undefined;
      if (data?.error?.code !== undefined) props.serverCode = data.error.code;
    }
  }

  if (__DEV__) {
    console.warn(`[${screen}] ${message}`, props);
  }
  track("error_caught", props);
};
