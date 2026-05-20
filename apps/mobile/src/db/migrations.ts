import { schemaMigrations, createTable } from "@nozbe/watermelondb/Schema/migrations";

/**
 * WatermelonDB schema migrations.
 *
 * SAFETY: WatermelonDB resets the local database (data loss) when the
 * schema `version` increases and no migration covers the gap. This file
 * MUST cover every version bump in `schema.ts`.
 *
 * v1 → v2 (Phase 3 chat offline layer): two `createTable` steps only.
 * `createTable` is purely additive — it never touches the existing
 * `glucose_readings` / `medication_*` / `user_streaks` tables, so a
 * patient's logged readings survive the upgrade intact.
 */
export const dbMigrations = schemaMigrations({
  migrations: [
    {
      toVersion: 2,
      steps: [
        createTable({
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
        createTable({
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
    },
  ],
});
