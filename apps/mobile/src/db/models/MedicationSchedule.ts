import { Model } from "@nozbe/watermelondb";
import { field, date, readonly } from "@nozbe/watermelondb/decorators";

export class MedicationScheduleModel extends Model {
  static table = "medication_schedules";

  @field("user_id") userId!: string;
  @field("medicine_name") medicineName!: string;
  @field("time_slots_json") timeSlotsJson!: string;
  @field("is_critical") isCritical!: boolean;
  @field("active") active!: boolean;
  @field("started_at") startedAt!: number;
  @readonly @date("updated_at") updatedAt!: Date;
}
