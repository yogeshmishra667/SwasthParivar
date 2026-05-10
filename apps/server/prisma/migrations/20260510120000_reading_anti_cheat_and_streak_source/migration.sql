-- Adds two columns to glucose_readings used by the streak engine and
-- post-hoc analytics:
--
--   anti_cheat_flags                jsonb     — flags raised on save
--                                              (e.g. ["same_value_3_consecutive"]).
--                                              Empty array when none.
--
--   streak_credited_at_server_time  boolean  — true when streak credit
--                                              fell back to the server clock
--                                              because the user has crossed
--                                              time_anomaly_count >= 2 (Patch #18).
--
-- Both columns are NOT NULL with safe defaults so the migration is
-- non-blocking on existing rows.

ALTER TABLE "glucose_readings"
  ADD COLUMN "anti_cheat_flags" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "streak_credited_at_server_time" boolean NOT NULL DEFAULT false;
