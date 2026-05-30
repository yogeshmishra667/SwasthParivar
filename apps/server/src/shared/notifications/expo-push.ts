import { env } from "../../config/env.js";
import { logger } from "../logger.js";
import { prisma } from "../database.js";

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default";
  priority?: "high" | "default";
  channelId?: string;
}

export interface ExpoPushResult {
  token: string;
  success: boolean;
  errorCode?: string;
  /** Human-readable error from Expo's response body, when available.
   * Surfaces in the admin test-push UI so operators can diagnose
   * project-scope / token-misconfiguration failures without grepping
   * server logs. */
  errorMessage?: string;
}

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

interface ExpoTicketOk {
  status: "ok";
  id: string;
}

interface ExpoTicketError {
  status: "error";
  message: string;
  details?: { error?: string };
}

type ExpoTicket = ExpoTicketOk | ExpoTicketError;

export const sendExpoPush = async (messages: ExpoPushMessage[]): Promise<ExpoPushResult[]> => {
  if (messages.length === 0) return [];

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
  };
  if (env.EXPO_ACCESS_TOKEN) {
    headers.Authorization = `Bearer ${env.EXPO_ACCESS_TOKEN}`;
  }

  try {
    const res = await fetch(EXPO_PUSH_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(messages),
    });

    if (!res.ok) {
      // Capture Expo's error body so the admin UI and server logs both
      // surface the actual reason, not just an opaque "HTTP_400". Expo's
      // error responses look like:
      //   { "errors": [{ "code": "VALIDATION_ERROR", "message": "..." }] }
      // for batch-level failures (bad payload, missing/invalid token,
      // project mismatch with Enhanced Security on). The body is small
      // (typically < 1KB) — parsing it is cheap.
      //
      // Common HTTP codes:
      //   400 → payload validation OR project-scoped Enhanced Security
      //         rejects an unscoped / wrong-account access token
      //   401 → EXPO_ACCESS_TOKEN wrong / expired / belongs to wrong project
      //   429 → rate-limited by Expo
      //   500 → Expo service error (retry)
      let expoErrorCode: string | undefined;
      let expoErrorMessage: string | undefined;
      let bodyText: string | undefined;
      try {
        bodyText = await res.text();
        const parsed = JSON.parse(bodyText) as {
          errors?: { code?: string; message?: string }[];
        };
        const firstError = parsed.errors?.[0];
        expoErrorCode = firstError?.code;
        expoErrorMessage = firstError?.message;
      } catch {
        // Non-JSON body (rare). `bodyText` may still be populated for
        // the log line below.
      }
      const errorCode = expoErrorCode ?? `HTTP_${res.status}`;
      logger.error(
        {
          status: res.status,
          errorCode,
          expoErrorCode,
          expoErrorMessage,
          // Keep the raw body around (truncated) so unexpected shapes
          // are still diagnosable from logs.
          body: bodyText?.slice(0, 500),
        },
        "expo push http error",
      );
      return messages.map((m) => ({
        token: m.to,
        success: false,
        errorCode,
        ...(expoErrorMessage ? { errorMessage: expoErrorMessage } : {}),
      }));
    }

    const json = (await res.json()) as { data?: ExpoTicket[] };
    const tickets = json.data ?? [];

    const results: ExpoPushResult[] = messages.map((m, i) => {
      const t = tickets[i];
      if (!t) return { token: m.to, success: false, errorCode: "NO_TICKET" };
      if (t.status === "ok") return { token: m.to, success: true };
      return {
        token: m.to,
        success: false,
        errorCode: t.details?.error ?? "UNKNOWN",
      };
    });

    const invalidTokens = results
      .filter((r) => r.errorCode === "DeviceNotRegistered")
      .map((r) => r.token);
    if (invalidTokens.length > 0) {
      try {
        const deleted = await prisma.pushToken.deleteMany({
          where: { token: { in: invalidTokens } },
        });
        logger.info({ count: deleted.count }, "pruned invalid push tokens");
      } catch (err) {
        logger.warn({ err }, "failed to prune invalid push tokens");
      }
    }

    return results;
  } catch (err) {
    logger.error({ err }, "expo push request failed");
    return messages.map((m) => ({ token: m.to, success: false, errorCode: "NETWORK_ERROR" }));
  }
};
