// Phase 3 — chat offline layer (WatermelonDB). Two concerns:
//
//   1. Message cache (`chat_messages`) — a read-only mirror of a
//      session's server messages so a thread renders instantly and
//      works offline. Written after a successful online load.
//   2. Pending-send queue (`chat_pending_sends`) — a turn whose send
//      failed transiently (network dropped mid-request) is queued and
//      replayed by `drainPendingChatSends` on reconnect. The send is
//      idempotent on `clientUuid`, so a replay is always safe.
//
// Every function degrades to a no-op when `getDatabase()` is null
// (Expo Go on Android, or a runtime without SQLite).

import type { Q as QType } from "@nozbe/watermelondb";
import { getDatabase } from "@/db/database";
import type { ChatMessageModel } from "@/db/models/ChatMessage";
import type { ChatPendingSendModel } from "@/db/models/ChatPendingSend";
import { logError } from "@/services/analytics";
import {
  sendChatMessage,
  type ChatMessageDto,
  type ChatRole,
  type ChatTier,
} from "@/services/chat";

const MESSAGES_TABLE = "chat_messages";
const PENDING_TABLE = "chat_pending_sends";

const loadQ = (): typeof QType => {
  /* eslint-disable-next-line @typescript-eslint/no-require-imports */
  return (require("@nozbe/watermelondb") as { Q: typeof QType }).Q;
};

/** Cached messages for a session, oldest-first. Empty when no local DB. */
export const loadCachedMessages = async (sessionId: string): Promise<ChatMessageDto[]> => {
  const db = getDatabase();
  if (!db) return [];
  try {
    const Q = loadQ();
    const rows = await db.collections
      .get<ChatMessageModel>(MESSAGES_TABLE)
      .query(Q.where("session_id", sessionId), Q.sortBy("server_created_at", Q.asc))
      .fetch();
    return rows.map((r) => ({
      id: r.serverId,
      sessionId: r.sessionId,
      role: r.role as ChatRole,
      content: r.content,
      costTier: r.costTier as ChatTier,
      flagged: r.flagged,
      flagReason: r.flagReason ?? null,
      createdAt: new Date(r.serverCreatedAt).toISOString(),
    }));
  } catch (err) {
    logError("chat-offline.loadCachedMessages", err);
    return [];
  }
};

/** Mirror a session's server messages locally. New `server_id`s only. */
export const cacheSessionMessages = async (
  userId: string,
  messages: readonly ChatMessageDto[],
): Promise<void> => {
  const db = getDatabase();
  if (!db || messages.length === 0) return;
  try {
    const Q = loadQ();
    const collection = db.collections.get<ChatMessageModel>(MESSAGES_TABLE);
    const sessionId = messages[0]?.sessionId;
    if (sessionId === undefined) return;
    const existing = await collection.query(Q.where("session_id", sessionId)).fetch();
    const known = new Set(existing.map((r) => r.serverId));
    const fresh = messages.filter((m) => !known.has(m.id));
    if (fresh.length === 0) return;
    await db.write(async () => {
      await Promise.all(
        fresh.map((m) =>
          collection.create((row) => {
            row.serverId = m.id;
            row.sessionId = m.sessionId;
            row.userId = userId;
            row.role = m.role;
            row.content = m.content;
            row.costTier = m.costTier;
            row.flagged = m.flagged;
            if (m.flagReason !== null) row.flagReason = m.flagReason;
            row.serverCreatedAt = new Date(m.createdAt).getTime();
          }),
        ),
      );
    });
  } catch (err) {
    logError("chat-offline.cacheSessionMessages", err);
  }
};

/** Queue a turn whose send failed transiently. */
export const enqueuePendingSend = async (input: {
  clientUuid: string;
  sessionId?: string;
  userId: string;
  message: string;
}): Promise<void> => {
  const db = getDatabase();
  if (!db) return;
  try {
    const collection = db.collections.get<ChatPendingSendModel>(PENDING_TABLE);
    await db.write(async () => {
      await collection.create((row) => {
        row.clientUuid = input.clientUuid;
        if (input.sessionId !== undefined) row.sessionId = input.sessionId;
        row.userId = input.userId;
        row.message = input.message;
        row.queuedAt = Date.now();
      });
    });
  } catch (err) {
    logError("chat-offline.enqueuePendingSend", err);
  }
};

/**
 * Replay queued sends oldest-first. A success or a definitive server
 * rejection drops the row; a transient failure stops the drain so the
 * next trigger retries. Safe to call repeatedly.
 */
export const drainPendingChatSends = async (): Promise<{ sent: number }> => {
  const db = getDatabase();
  if (!db) return { sent: 0 };
  let sent = 0;
  try {
    const Q = loadQ();
    const collection = db.collections.get<ChatPendingSendModel>(PENDING_TABLE);
    const pending = await collection.query(Q.sortBy("queued_at", Q.asc)).fetch();
    for (const row of pending) {
      const outcome = await sendChatMessage({
        clientUuid: row.clientUuid,
        version: 1,
        // WatermelonDB returns `null` (not `undefined`) for an unset
        // optional column, so test truthiness — covers null/empty too.
        ...(row.sessionId ? { sessionId: row.sessionId } : {}),
        message: row.message,
      });
      if (outcome.ok) {
        await db.write(async () => {
          await row.markAsDeleted();
        });
        sent += 1;
      } else if (outcome.code === "UNKNOWN") {
        // Still offline / transient — stop; a later trigger retries.
        break;
      } else {
        // Definitive rejection (rate-limit, disabled, …) — retrying
        // won't help, so drop the row rather than block the queue.
        await db.write(async () => {
          await row.markAsDeleted();
        });
      }
    }
  } catch (err) {
    logError("chat-offline.drainPendingChatSends", err);
  }
  return { sent };
};
