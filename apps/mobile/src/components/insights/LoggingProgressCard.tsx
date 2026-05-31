import { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/Card";
import { api } from "@/services/api";
import { logError } from "@/services/analytics";

const WINDOW_DAYS = 7;

interface GlucoseReadingRow {
  measuredAt: string;
}

interface ListResponse {
  success: boolean;
  data: { data: GlucoseReadingRow[] };
}

// Bucket the user's last-7-days readings into local calendar days, then
// surface "X of 7 days logged" as a real consistency signal. Cheap fetch
// scoped to this card so the parent insights screen stays untouched.
const distinctDayCount = (readings: readonly GlucoseReadingRow[]): number => {
  const days = new Set<string>();
  for (const r of readings) {
    const d = new Date(r.measuredAt);
    days.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
  }
  return Math.min(WINDOW_DAYS, days.size);
};

export const LoggingProgressCard = (): JSX.Element | null => {
  const { t } = useTranslation();
  const [daysLogged, setDaysLogged] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const fromIso = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
        const res = await api.get<ListResponse>("/readings/glucose", {
          params: { from: fromIso, limit: 100 },
        });
        setDaysLogged(distinctDayCount(res.data.data));
      } catch (e) {
        logError("LoggingProgressCard.fetch", e);
        setFailed(true);
      }
    })();
  }, []);

  // Soft-hide on failure rather than render a broken card on the
  // insights empty state — the screen has other content.
  if (failed) return null;
  if (daysLogged === null) return null;

  const pct = Math.round((daysLogged / WINDOW_DAYS) * 100);
  const barColor = pct >= 70 ? "bg-success" : pct >= 40 ? "bg-warning" : "bg-critical";
  const textColor = pct >= 70 ? "text-success" : pct >= 40 ? "text-warning" : "text-critical";

  const descKey =
    pct >= 70
      ? "insights.loggingProgress.descGood"
      : pct >= 40
        ? "insights.loggingProgress.descOk"
        : "insights.loggingProgress.descLow";

  return (
    <Card>
      <Text className="mb-2 text-important font-bold text-gray-900 dark:text-gray-100">
        {t("insights.loggingProgress.title", { defaultValue: "Logging consistency" })}
      </Text>
      <View className="flex-row items-center gap-3">
        <View className="h-3 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
          <View className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
        </View>
        <Text className={`text-body font-bold ${textColor}`}>{pct}%</Text>
      </View>
      <Text className="mt-2 text-sm text-neutral dark:text-gray-400">
        {t(descKey, {
          logged: daysLogged,
          total: WINDOW_DAYS,
          defaultValue: `Logged ${daysLogged} of ${WINDOW_DAYS} days this week.`,
        })}
      </Text>
    </Card>
  );
};
