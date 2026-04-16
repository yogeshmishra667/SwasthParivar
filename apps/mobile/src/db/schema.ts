import { appSchema, tableSchema } from "@nozbe/watermelondb";

export const dbSchema = appSchema({
  version: 1,
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
  ],
});
