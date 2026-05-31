import { View, Text, ScrollView } from "react-native";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/Card";
import { Icon, type IconName } from "@/components/ui/Icon";

export const TipsCarousel = (): JSX.Element => {
  const { t } = useTranslation();

  const tips: {
    id: string;
    icon: IconName;
    color: string;
    bg: string;
    title: string;
    desc: string;
  }[] = [
    {
      id: "tip1",
      icon: "water-outline",
      color: "#0284C7",
      bg: "bg-sky-50 dark:bg-sky-950/60",
      title: t("insights.tips.water.title", { defaultValue: "Stay Hydrated" }),
      desc: t("insights.tips.water.desc", {
        defaultValue: "Drinking water helps your kidneys flush out excess sugar through urine.",
      }),
    },
    {
      id: "tip2",
      icon: "walk-outline",
      color: "#16A34A",
      bg: "bg-green-50 dark:bg-green-950/60",
      title: t("insights.tips.walk.title", { defaultValue: "Post-Meal Walk" }),
      desc: t("insights.tips.walk.desc", {
        defaultValue:
          "A 10-minute walk after meals can significantly lower your blood sugar spikes.",
      }),
    },
    {
      id: "tip3",
      icon: "restaurant-outline",
      color: "#D97706",
      bg: "bg-amber-50 dark:bg-amber-950/60",
      title: t("insights.tips.fiber.title", { defaultValue: "More Fiber" }),
      desc: t("insights.tips.fiber.desc", {
        defaultValue: "Include more vegetables and whole grains to slow down sugar absorption.",
      }),
    },
  ];

  return (
    <View className="mt-2">
      <Text className="text-important font-bold text-gray-900 dark:text-gray-100 mb-3 ml-1">
        {t("insights.tips.header", { defaultValue: "Daily Health Tips" })}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingRight: 16 }}
      >
        {tips.map((tip) => (
          <View key={tip.id} style={{ width: 260 }} className="mr-3">
            <Card className="h-full border border-gray-100 dark:border-gray-800">
              <View className={`h-10 w-10 rounded-full ${tip.bg} items-center justify-center mb-2`}>
                <Icon name={tip.icon} size={20} color={tip.color} />
              </View>
              <Text className="text-important font-bold text-gray-900 dark:text-gray-100 mb-1">
                {tip.title}
              </Text>
              <Text className="text-sm text-gray-600 dark:text-gray-300">{tip.desc}</Text>
            </Card>
          </View>
        ))}
      </ScrollView>
    </View>
  );
};
