export type CheckFrequency = "daily" | "twice_weekly" | "weekly" | "biweekly" | "monthly";

export const CHECK_FREQUENCY_OPTIONS: {
  value: CheckFrequency;
  labelKey: string;
  descKey: string;
}[] = [
  {
    value: "daily",
    labelKey: "settings.frequency.daily",
    descKey: "settings.frequency.dailyDesc",
  },
  {
    value: "twice_weekly",
    labelKey: "settings.frequency.twice_weekly",
    descKey: "settings.frequency.twice_weeklyDesc",
  },
  {
    value: "weekly",
    labelKey: "settings.frequency.weekly",
    descKey: "settings.frequency.weeklyDesc",
  },
  {
    value: "biweekly",
    labelKey: "settings.frequency.biweekly",
    descKey: "settings.frequency.biweeklyDesc",
  },
  {
    value: "monthly",
    labelKey: "settings.frequency.monthly",
    descKey: "settings.frequency.monthlyDesc",
  },
];
