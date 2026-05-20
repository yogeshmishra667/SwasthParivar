import { Model } from "@nozbe/watermelondb";
import { field } from "@nozbe/watermelondb/decorators";

// Phase 3 — local cache of a server ChatMessage row (read-only mirror).
//
// This table intentionally has NO WatermelonDB-managed `created_at` /
// `updated_at` columns — it is a read-only cache, never WatermelonDB-
// synced. `serverCreatedAt` holds the SERVER timestamp so thread
// ordering matches the server regardless of when the row was cached.
// Order queries MUST use `Q.sortBy('server_created_at')` — a
// `Q.sortBy('created_at')` would silently sort every row by 0.
export class ChatMessageModel extends Model {
  static table = "chat_messages";

  @field("server_id") serverId!: string;
  @field("session_id") sessionId!: string;
  @field("user_id") userId!: string;
  @field("role") role!: string;
  @field("content") content!: string;
  @field("cost_tier") costTier!: string;
  @field("flagged") flagged!: boolean;
  @field("flag_reason") flagReason?: string;
  @field("server_created_at") serverCreatedAt!: number;
}
