import { Model } from "@nozbe/watermelondb";
import { field, date, readonly } from "@nozbe/watermelondb/decorators";

export class MedicationLogModel extends Model {
  static table = "medication_logs";

  @field("schedule_id") scheduleId!: string;
  @field("user_id") userId!: string;
  @field("status") status!: string;
  @field("scheduled_for") scheduledFor!: number;
  @field("responded_at") respondedAt?: number;
  @readonly @date("created_at") createdAt!: Date;
  @readonly @date("updated_at") updatedAt!: Date;
}
