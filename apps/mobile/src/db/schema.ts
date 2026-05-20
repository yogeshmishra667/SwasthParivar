import { appSchema, tableSchema } from "@nozbe/watermelondb";

// Schema version history:
//   v1 — glucose_readings, medication_schedules, medication_logs, user_streaks
//   v2 — + chat_messages, chat_pending_sends (Phase 3 chat offline layer).
//        Additive only; see ./migrations.ts. Existing-table data is
//        untouched by the v1→v2 migration.
export const dbSchema = appSchema({
  version: 2,
  tables: [
    tableSchema({
      name: "glucose_readings",
      columns: [
        { name: "client_uuid", type: "string", isIndexed: true },
        { name: "user_id", type: "string", isIndexed: true },
        { name: "value_mg_dl", type: "number" },
        { name: "reading_type", type: "string" },
        { name: "context", type: "string", isOptional: true },
        { name: "notes", type: "string", isOptional: true },
        { name: "source", type: "string" },
        { name: "measured_at", type: "number", isIndexed: true },
        { name: "streak_credited_to", type: "string" },
        { name: "version", type: "number" },
        { name: "synced_at", type: "number", isOptional: true },
        { name: "created_at", type: "number" },
        { name: "updated_at", type: "number" },
      ],
    }),
    tableSchema({
      name: "medication_schedules",
      columns: [
        { name: "user_id", type: "string", isIndexed: true },
        { name: "medicine_name", type: "string" },
        { name: "time_slots_json", type: "string" },
        { name: "is_critical", type: "boolean" },
        { name: "active", type: "boolean" },
        { name: "started_at", type: "number" },
        { name: "updated_at", type: "number" },
      ],
    }),
    tableSchema({
      name: "medication_logs",
      columns: [
        { name: "schedule_id", type: "string", isIndexed: true },
        { name: "user_id", type: "string", isIndexed: true },
        { name: "status", type: "string" },
        { name: "scheduled_for", type: "number" },
        { name: "responded_at", type: "number", isOptional: true },
        { name: "created_at", type: "number" },
        { name: "updated_at", type: "number" },
      ],
    }),
    tableSchema({
      name: "user_streaks",
      columns: [
        { name: "user_id", type: "string", isIndexed: true },
        { name: "current_streak_days", type: "number" },
        { name: "longest_streak_days", type: "number" },
        { name: "last_log_date", type: "string", isOptional: true },
        { name: "total_log_days", type: "number" },
        { name: "milestones_reached_json", type: "string" },
        { name: "updated_at", type: "number" },
      ],
    }),
    // Phase 3 — chat message cache. Mirrors the server ChatMessage rows
    // for a session so a thread renders offline (read-only). Pruned to
    // the most recent rows per session on app open.
    tableSchema({
      name: "chat_messages",
      columns: [
        { name: "server_id", type: "string", isIndexed: true },
        { name: "session_id", type: "string", isIndexed: true },
        { name: "user_id", type: "string", isIndexed: true },
        { name: "role", type: "string" },
        { name: "content", type: "string" },
        { name: "cost_tier", type: "string" },
        { name: "flagged", type: "boolean" },
        { name: "flag_reason", type: "string", isOptional: true },
        { name: "server_created_at", type: "number", isIndexed: true },
      ],
    }),
    // Phase 3 — offline send queue. A turn composed offline is queued
    // here and drained to POST /chat/message on reconnect. `client_uuid`
    // is the idempotency key, so a re-drained row is a safe replay.
    tableSchema({
      name: "chat_pending_sends",
      columns: [
        { name: "client_uuid", type: "string", isIndexed: true },
        { name: "session_id", type: "string", isOptional: true },
        { name: "user_id", type: "string", isIndexed: true },
        { name: "message", type: "string" },
        { name: "queued_at", type: "number", isIndexed: true },
      ],
    }),
  ],
});
