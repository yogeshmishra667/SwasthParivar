import { Database } from "@nozbe/watermelondb";
import SQLiteAdapter from "@nozbe/watermelondb/adapters/sqlite";
import { dbSchema } from "./schema";
import { GlucoseReadingModel } from "./models/GlucoseReading";
import { MedicationScheduleModel } from "./models/MedicationSchedule";
import { MedicationLogModel } from "./models/MedicationLog";
import { UserStreakModel } from "./models/UserStreak";

const adapter = new SQLiteAdapter({
  schema: dbSchema,
  jsi: true,
  dbName: "swasthparivar",
  onSetUpError: (error) => {
    console.error("WatermelonDB setup failed", error);
  },
});

export const database = new Database({
  adapter,
  modelClasses: [
    GlucoseReadingModel,
    MedicationScheduleModel,
    MedicationLogModel,
    UserStreakModel,
  ],
});
