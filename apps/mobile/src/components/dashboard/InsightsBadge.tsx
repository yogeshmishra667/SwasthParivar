// Phase 2 — Inline tappable badge on the dashboard pointing at the
// Insights tab. Hidden when there are zero unacknowledged insights so
// the dashboard doesn't add visual noise on first-week onboarding.

import { View, Text, Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";

import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { TOUCH_TARGET_MIN } from "@/utils/constants";

interface InsightsBadgeProps {
  count: number;
}

export const InsightsBadge = ({ count }: InsightsBadgeProps): JSX.Element | null => {
  const { t } = useTranslation();
  const router = useRouter();
  if (count <= 0) return null;
  return (
    <Pressable
      onPress={() => router.push("/(tabs)/insights")}
      accessibilityRole="button"
      accessibilityLabel={t("insights.title")}
      style={{ minHeight: TOUCH_TARGET_MIN }}
    >
      <Card className="border border-celebration/30 bg-violet-50">
        <View className="flex-row items-center gap-3">
          <Icon name="bulb" size={24} color="#8B5CF6" />
          <View className="flex-1">
            <Text className="text-important font-semibold text-gray-900">
              {t("insights.title")}
            </Text>
            <Text className="text-body text-neutral">{t("insights.unread", { count })}</Text>
          </View>
          <Icon name="chevron-forward" size={18} color="#8B5CF6" />
        </View>
      </Card>
    </Pressable>
  );
};
