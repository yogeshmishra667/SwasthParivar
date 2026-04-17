import PostHog from "posthog-react-native";
import Constants from "expo-constants";

const apiKey = (Constants.expoConfig?.extra as { posthogKey?: string } | undefined)?.posthogKey;

export const analytics = apiKey
  ? new PostHog(apiKey, { host: "https://app.posthog.com" })
  : null;

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
