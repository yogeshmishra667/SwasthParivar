import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";

export const FamilyQuickSummary = (): JSX.Element => {
  const { t } = useTranslation();
  return (
    <Card className="mb-4 border-indigo-100 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/40">
      <View className="mb-2 flex-row items-center gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900">
          <Icon name="heart-half-outline" size={24} color="#818CF8" />
        </View>
        <Text className="flex-1 text-important font-bold text-gray-900 dark:text-gray-100">
          {t("family.quickSummary.title", { defaultValue: "Family Health Network" })}
        </Text>
      </View>
      <Text className="text-body text-gray-700 dark:text-gray-300">
        {t("family.quickSummary.desc", {
          defaultValue:
            "Connect with your loved ones to share health logs and receive alerts when critical patterns are detected. Your family's well-being, monitored together.",
        })}
      </Text>
    </Card>
  );
};
