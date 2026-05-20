import type { Database } from "@nozbe/watermelondb";
import type * as WatermelonModule from "@nozbe/watermelondb";
import type SQLiteAdapterCtor from "@nozbe/watermelondb/adapters/sqlite";
import type * as SchemaModule from "./schema";
import type * as MigrationsModule from "./migrations";
import type * as GlucoseReadingModule from "./models/GlucoseReading";
import type * as MedicationScheduleModule from "./models/MedicationSchedule";
import type * as MedicationLogModule from "./models/MedicationLog";
import type * as UserStreakModule from "./models/UserStreak";
import type * as ChatMessageModule from "./models/ChatMessage";
import type * as ChatPendingSendModule from "./models/ChatPendingSend";
import { logError } from "@/services/analytics";

/**
 * Lazy WatermelonDB initialization.
 *
 * Why lazy:
 *   The SQLite adapter calls `requireNativeModule("WMDatabaseBridge")`
 *   when constructed. In Expo Go on Android the native module isn't
 *   bundled, so eager construction crashes the app at startup. Same
 *   pattern as `VoiceInputNative.tsx` for `expo-speech-recognition`.
 *
 * Contract:
 *   - First call attempts to construct the database. On failure
 *     (Expo Go on Android, simulator without storage, etc.) we cache
 *     `null` and never try again — callers degrade gracefully.
 *   - Subsequent calls return the cached instance (or null).
 *   - Tests can call `__resetDatabaseForTests` to clear the cache.
 *
 * Usage:
 *   const db = getDatabase();
 *   if (!db) {
 *     // offline-first features unavailable in this runtime; fall back
 *     // to API-direct flow.
 *   }
 */

let cached: Database | null | undefined = undefined;

export const getDatabase = (): Database | null => {
  if (cached !== undefined) return cached;

  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const wmdb = require("@nozbe/watermelondb") as typeof WatermelonModule;
    const SQLiteAdapter = (
      require("@nozbe/watermelondb/adapters/sqlite") as {
        default: typeof SQLiteAdapterCtor;
      }
    ).default;
    const { dbSchema } = require("./schema") as typeof SchemaModule;
    const { dbMigrations } = require("./migrations") as typeof MigrationsModule;
    const { GlucoseReadingModel } =
      require("./models/GlucoseReading") as typeof GlucoseReadingModule;
    const { MedicationScheduleModel } =
      require("./models/MedicationSchedule") as typeof MedicationScheduleModule;
    const { MedicationLogModel } = require("./models/MedicationLog") as typeof MedicationLogModule;
    const { UserStreakModel } = require("./models/UserStreak") as typeof UserStreakModule;
    const { ChatMessageModel } = require("./models/ChatMessage") as typeof ChatMessageModule;
    const { ChatPendingSendModel } =
      require("./models/ChatPendingSend") as typeof ChatPendingSendModule;
    /* eslint-enable @typescript-eslint/no-require-imports */

    const adapter = new SQLiteAdapter({
      schema: dbSchema,
      // Migrations MUST be passed — without them a schema version bump
      // resets the database (data loss). See ./migrations.ts.
      migrations: dbMigrations,
      jsi: true,
      dbName: "swasthparivar",
      onSetUpError: (err: unknown) => logError("watermelondb.setup", err),
    });

    cached = new wmdb.Database({
      adapter,
      modelClasses: [
        GlucoseReadingModel,
        MedicationScheduleModel,
        MedicationLogModel,
        UserStreakModel,
        ChatMessageModel,
        ChatPendingSendModel,
      ],
    });
    return cached;
  } catch (err) {
    logError("watermelondb.init", err);
    cached = null;
    return null;
  }
};

export const isLocalDbAvailable = (): boolean => getDatabase() !== null;

export const __resetDatabaseForTests = (): void => {
  cached = undefined;
};
