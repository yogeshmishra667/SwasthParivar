import { Model } from "@nozbe/watermelondb";
import { field, date, readonly } from "@nozbe/watermelondb/decorators";

export class GlucoseReadingModel extends Model {
  static table = "glucose_readings";

  @field("client_uuid") clientUuid!: string;
  @field("user_id") userId!: string;
  @field("value_mg_dl") valueMgDl!: number;
  @field("reading_type") readingType!: string;
  @field("context") context?: string;
  @field("notes") notes?: string;
  @field("source") source!: string;
  @field("measured_at") measuredAt!: number;
  @field("streak_credited_to") streakCreditedTo!: string;
  @field("version") version!: number;
  @field("synced_at") syncedAt?: number;
  @readonly @date("created_at") createdAt!: Date;
  @readonly @date("updated_at") updatedAt!: Date;
}
