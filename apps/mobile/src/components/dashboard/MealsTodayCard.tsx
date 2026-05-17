// Phase 2 — Today's meals strip. Compact view showing how many meals
// have been logged and a one-line category strip.

import { View, Text, Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";

import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { TOUCH_TARGET_MIN } from "@/utils/constants";

interface MealsTodayCardProps {
  mealsToday: readonly {
    id: string;
    mealType: string;
    mealCategory: string;
  }[];
}

const CATEGORY_EMOJI: Record<string, string> = {
  light: "🥗",
  normal: "🍛",
  heavy_fried: "🍟",
};

export const MealsTodayCard = ({ mealsToday }: MealsTodayCardProps): JSX.Element => {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <Pressable
      onPress={() => router.push("/(tabs)/log")}
      accessibilityRole="button"
      accessibilityLabel={t("meals.title")}
      style={{ minHeight: TOUCH_TARGET_MIN }}
    >
      <Card>
        <View className="flex-row items-center justify-between">
          <Text className="text-body text-neutral">{t("meals.title")}</Text>
          <Icon name="chevron-forward" size={16} color="#6B7280" />
        </View>
        {mealsToday.length > 0 ? (
          <>
            <Text className="mt-1 text-2xl font-bold">
              {t("meals.todayCount", { count: mealsToday.length })}
            </Text>
            <View className="mt-2 flex-row flex-wrap gap-2">
              {mealsToday.map((m) => (
                <View
                  key={m.id}
                  className="flex-row items-center gap-1 rounded-full bg-gray-100 px-3 py-1"
                >
                  <Text className="text-base">{CATEGORY_EMOJI[m.mealCategory] ?? "🍽️"}</Text>
                  <Text className="text-body">{t(`meals.type.${m.mealType}`)}</Text>
                </View>
              ))}
            </View>
          </>
        ) : (
          <Text className="mt-1 text-body text-neutral">{t("meals.noMealsToday")}</Text>
        )}
      </Card>
    </Pressable>
  );
};
