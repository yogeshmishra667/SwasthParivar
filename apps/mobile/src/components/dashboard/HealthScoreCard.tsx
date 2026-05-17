// Phase 2 — Health score card. Compact 0-100 display with a tiny bar
// strip showing the 5 components (logging/stability/trend/medication/
// streak). Tap → /insights for the explainer.

import { View, Text, Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";

import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { TOUCH_TARGET_MIN } from "@/utils/constants";

interface HealthScoreCardProps {
  score: number;
  components: {
    logging: number;
    stability: number;
    trend: number;
    medication: number;
    streak: number;
  };
  computedForDate: string;
}

const colorForScore = (score: number): string => {
  if (score >= 80) return "text-success";
  if (score >= 60) return "text-blue-700";
  if (score >= 40) return "text-warning";
  return "text-critical";
};

const barColorForScore = (score: number): string => {
  if (score >= 80) return "bg-success";
  if (score >= 60) return "bg-primary";
  if (score >= 40) return "bg-warning";
  return "bg-critical";
};

export const HealthScoreCard = ({
  score,
  components,
  computedForDate,
}: HealthScoreCardProps): JSX.Element => {
  const { t } = useTranslation();
  const router = useRouter();

  const items: readonly { key: keyof typeof components; label: string; max: number }[] = [
    { key: "logging", label: t("healthScore.components.logging"), max: 20 },
    { key: "stability", label: t("healthScore.components.stability"), max: 25 },
    { key: "trend", label: t("healthScore.components.trend"), max: 25 },
    { key: "medication", label: t("healthScore.components.medication"), max: 20 },
    { key: "streak", label: t("healthScore.components.streak"), max: 10 },
  ];

  return (
    <Pressable
      onPress={() => router.push("/(tabs)/insights")}
      accessibilityRole="button"
      accessibilityLabel={t("healthScore.title")}
      style={{ minHeight: TOUCH_TARGET_MIN }}
    >
      <Card>
        <View className="flex-row items-center justify-between">
          <Text className="text-body text-neutral">{t("healthScore.title")}</Text>
          <Icon name="information-circle-outline" size={16} color="#6B7280" />
        </View>

        <View className="mt-1 flex-row items-baseline gap-2">
          <Text className={`text-5xl font-bold tracking-tight ${colorForScore(score)}`}>
            {score}
          </Text>
          <Text className="text-body text-neutral">{t("healthScore.of100")}</Text>
        </View>

        <View className="mt-3 gap-2">
          {items.map((item) => {
            const value = Math.max(0, Math.min(item.max, components[item.key]));
            const pct = item.max > 0 ? value / item.max : 0;
            return (
              <View key={item.key}>
                <View className="flex-row items-center justify-between">
                  <Text className="text-body text-neutral">{item.label}</Text>
                  <Text className="text-body text-gray-700">
                    {value}/{item.max}
                  </Text>
                </View>
                <View className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
                  <View
                    className={`h-full ${barColorForScore(score)}`}
                    style={{ width: `${pct * 100}%` }}
                  />
                </View>
              </View>
            );
          })}
        </View>

        <Text className="mt-3 text-body text-neutral">
          {t("healthScore.asOf", { date: computedForDate })}
        </Text>
      </Card>
    </Pressable>
  );
};
