import { env } from "../config/env.js";
import { logger } from "./logger.js";

export interface HogQLResponse<T = unknown[]> {
  results: T[];
  columns: string[];
  types: string[];
}

/**
 * Executes a HogQL query against the PostHog API.
 * Returns null if the required Personal API Key or Project ID is missing.
 */
export const executeHogQL = async <T = unknown[]>(
  query: string,
): Promise<HogQLResponse<T> | null> => {
  if (!env.POSTHOG_PERSONAL_API_KEY || !env.POSTHOG_PROJECT_ID) {
    return null;
  }

  const url = `https://app.posthog.com/api/projects/${env.POSTHOG_PROJECT_ID}/query/`;
  const payload = {
    query: {
      kind: "HogQLQuery",
      query,
    },
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.POSTHOG_PERSONAL_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      logger.error({ status: response.status, text }, "PostHog HogQL query failed");
      throw new Error(`PostHog HogQL query failed: ${response.status}`);
    }

    return (await response.json()) as HogQLResponse<T>;
  } catch (error) {
    logger.error(error, "PostHog query execution error");
    throw error;
  }
};
