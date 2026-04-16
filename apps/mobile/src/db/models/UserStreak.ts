import { Model } from "@nozbe/watermelondb";
import { field, date, readonly } from "@nozbe/watermelondb/decorators";

export class UserStreakModel extends Model {
  static table = "user_streaks";

  @field("user_id") userId!: string;
  @field("current_streak_days") currentStreakDays!: number;
  @field("longest_streak_days") longestStreakDays!: number;
  @field("last_log_date") lastLogDate?: string;
  @field("total_log_days") totalLogDays!: number;
  @field("milestones_reached_json") milestonesReachedJson!: string;
  @readonly @date("updated_at") updatedAt!: Date;
}
