import PostHog from "posthog-react-native";
import Constants from "expo-constants";

const extra = Constants.expoConfig?.extra as
  | { posthogKey?: string; posthogHost?: string }
  | undefined;

const apiKey = extra?.posthogKey;

// Default to the US ingest host to match `apps/server/src/shared/
// analytics/posthog.ts`. EU teams override via `app.json` →
// `extra.posthogHost = "https://eu.i.posthog.com"`. (The legacy
// `app.posthog.com` URL still resolves but is route-deprecated; matching
// the server URL keeps both surfaces in lockstep when we change region.)
const host = extra?.posthogHost ?? "https://us.i.posthog.com";

export const analytics = apiKey ? new PostHog(apiKey, { host }) : null;

type JsonPrimitive = string | number | boolean | null;
export type EventProps = Record<string, JsonPrimitive | JsonPrimitive[]>;

export const track = (event: string, props?: EventProps): void => {
  analytics?.capture(event, props);
};

export const logError = (screen: string, error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  if (__DEV__) {
    console.warn(`[${screen}]`, message);
  }
  track("error_caught", { screen, message });
};
