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

export const sendExpoPush = async (
  messages: ExpoPushMessage[],
): Promise<ExpoPushResult[]> => {
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
      logger.error({ status: res.status }, "expo push http error");
      return messages.map((m) => ({ token: m.to, success: false, errorCode: "HTTP_ERROR" }));
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
