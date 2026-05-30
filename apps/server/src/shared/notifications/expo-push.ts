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
}

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

// Per-token Expo errors that mean "this token row is structurally broken
// and will never deliver again — delete it so the next mobile-app launch
// can register a clean one." Distinct from transient errors
// (`MessageRateExceeded`) which we want to retry, and from server-config
// errors (`InvalidCredentials`) which would delete every token.
//
//   DeviceNotRegistered      → token was uninstalled / revoked
//   PushTooManyExperienceIds → token is bound to multiple Expo projects
//                              (typically Expo Go + dev/prod build mix);
//                              Enhanced Security refuses to deliver
//   MismatchSenderId         → token's FCM sender ID doesn't match the
//                              project the server is sending from
const PERMANENT_TOKEN_FAILURE_CODES: ReadonlySet<string> = new Set([
  "DeviceNotRegistered",
  "PushTooManyExperienceIds",
  "MismatchSenderId",
]);

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
      // Include the HTTP status in the errorCode so the admin UI and
      // server logs both have enough context to diagnose without a
      // separate server-log grep. Common codes:
      //   401 → EXPO_ACCESS_TOKEN wrong / expired / belongs to wrong project
      //   429 → rate-limited by Expo
      //   500 → Expo service error (retry)
      const errorCode = `HTTP_${res.status}`;
      logger.error({ status: res.status, errorCode }, "expo push http error");
      return messages.map((m) => ({ token: m.to, success: false, errorCode }));
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
      .filter((r) => r.errorCode !== undefined && PERMANENT_TOKEN_FAILURE_CODES.has(r.errorCode))
      .map((r) => r.token);
    if (invalidTokens.length > 0) {
      try {
        const deleted = await prisma.pushToken.deleteMany({
          where: { token: { in: invalidTokens } },
        });
        logger.info(
          {
            count: deleted.count,
            errorCodes: [...new Set(results.map((r) => r.errorCode).filter(Boolean))],
          },
          "pruned permanently-broken push tokens",
        );
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
