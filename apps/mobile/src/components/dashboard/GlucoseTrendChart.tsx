// Phase 2 — Glucose trend chart. Last-14-days line of fasting readings
// rendered with Victory Native XL (Skia-accelerated). For elderly
// users we keep the axes minimal: just bottom dates and a left value
// scale. Missing days fall back to the previous reading so the line
// stays continuous and visually calming.

import { useMemo } from "react";
import { View, Text } from "react-native";
import { CartesianChart, Line } from "victory-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/ui/Card";

export interface TrendPoint {
  measuredAt: string;
  valueMgDl: number;
}

interface GlucoseTrendChartProps {
  points: readonly TrendPoint[];
  height?: number;
}

// Victory Native expects `Record<string, unknown>` for every row; we
// keep `hasData` numeric (1/0) so callers can index on the flag if
// they want to overlay dots on real-reading days later.
type DailyDatum = { day: number; value: number; hasData: number } & Record<string, unknown>;

// Pre-bucket readings into 14 daily slots and forward-fill missing
// days so the chart stays continuous. The `hasData` flag is preserved
// for callers that want to render dots only on real readings.
const bucketByDay = (points: readonly TrendPoint[]): DailyDatum[] => {
  const days = 14;
  const today = new Date();
  let lastSeen = 0;
  const result: DailyDatum[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const dayStart = d.getTime();
    const dayEnd = dayStart + 86_400_000;
    const today_points = points.filter((p) => {
      const t = new Date(p.measuredAt).getTime();
      return t >= dayStart && t < dayEnd;
    });
    if (today_points.length > 0) {
      const mean = today_points.reduce((acc, p) => acc + p.valueMgDl, 0) / today_points.length;
      lastSeen = mean;
      result.push({ day: dayStart, value: mean, hasData: 1 });
    } else {
      // Forward-fill so the line doesn't dip to zero on missed days.
      result.push({ day: dayStart, value: lastSeen, hasData: 0 });
    }
  }
  return result;
};

export const GlucoseTrendChart = ({
  points,
  height = 180,
}: GlucoseTrendChartProps): JSX.Element => {
  const { t } = useTranslation();
  const data = useMemo(() => bucketByDay(points), [points]);
  const hasAnyData = data.some((d) => d.hasData === 1);

  if (!hasAnyData) {
    return (
      <Card>
        <Text className="text-body text-neutral">{t("dashboard.lastReading")} — 14d</Text>
        <View style={{ height, alignItems: "center", justifyContent: "center" }}>
          <Text className="text-body text-neutral">{t("dashboard.noReadings")}</Text>
        </View>
      </Card>
    );
  }

  return (
    <Card>
      <Text className="text-body text-neutral">{t("dashboard.lastReading")} — 14d</Text>
      <View style={{ height, marginTop: 8 }}>
        <CartesianChart
          data={data}
          xKey="day"
          yKeys={["value"]}
          domainPadding={{ top: 20, bottom: 12, left: 12, right: 12 }}
        >
          {({ points: rendered }) => (
            <Line
              points={rendered.value}
              color="#2563EB"
              strokeWidth={3}
              curveType="monotoneX"
              animate={{ type: "timing", duration: 300 }}
            />
          )}
        </CartesianChart>
      </View>
    </Card>
  );
};
