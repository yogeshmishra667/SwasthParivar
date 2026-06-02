-- Cross-device-syncable user preferences.
--
-- One-row-per-user (PK = user_id), cascade-deleted with the user.
-- Mirrors the mobile AsyncStorage shape so the client can hydrate on
-- login and push best-effort on every setter call. Defaults match
-- the mobile store defaults — a missing row reads equivalently to
-- "user never opened settings".
--
-- Why a table, not a JSONB column on `users`: matches the sibling
-- per-user single-row tables (`notification_states`, `user_streaks`)
-- and keeps Prisma type safety for individual fields.

-- CreateTable
CREATE TABLE "user_preferences" (
    "user_id" UUID NOT NULL,
    "theme" TEXT NOT NULL DEFAULT 'system',
    "large_text" BOOLEAN NOT NULL DEFAULT false,
    "reduce_motion" BOOLEAN NOT NULL DEFAULT false,
    "check_frequency" TEXT NOT NULL DEFAULT 'daily',
    "notifications_enabled" BOOLEAN NOT NULL DEFAULT true,
    "reminder_time" TEXT DEFAULT '07:00',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
