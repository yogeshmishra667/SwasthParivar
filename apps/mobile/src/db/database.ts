import type { Database } from "@nozbe/watermelondb";
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
    /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    const wmdb = require("@nozbe/watermelondb") as typeof import("@nozbe/watermelondb");
    const SQLiteAdapter = (
      require("@nozbe/watermelondb/adapters/sqlite") as {
        default: typeof import("@nozbe/watermelondb/adapters/sqlite").default;
      }
    ).default;
    const { dbSchema } = require("./schema") as typeof import("./schema");
    const { GlucoseReadingModel } =
      require("./models/GlucoseReading") as typeof import("./models/GlucoseReading");
    const { MedicationScheduleModel } =
      require("./models/MedicationSchedule") as typeof import("./models/MedicationSchedule");
    const { MedicationLogModel } =
      require("./models/MedicationLog") as typeof import("./models/MedicationLog");
    const { UserStreakModel } =
      require("./models/UserStreak") as typeof import("./models/UserStreak");
    /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

    const adapter = new SQLiteAdapter({
      schema: dbSchema,
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
