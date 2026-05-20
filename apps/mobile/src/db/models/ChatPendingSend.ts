import { Model } from "@nozbe/watermelondb";
import { field } from "@nozbe/watermelondb/decorators";

// Phase 3 — a chat turn composed offline, queued for sending. Drained
// to POST /chat/message on reconnect. `clientUuid` is the server-side
// idempotency key, so a re-drained row never produces a duplicate.
//
// `sessionId` is optional — a turn started in a brand-new chat has no
// session yet. POST /chat/message mints a session when none is sent,
// so the drain posts such a row as-is (omitting `session_id`).
export class ChatPendingSendModel extends Model {
  static table = "chat_pending_sends";

  @field("client_uuid") clientUuid!: string;
  @field("session_id") sessionId?: string;
  @field("user_id") userId!: string;
  @field("message") message!: string;
  @field("queued_at") queuedAt!: number;
}
