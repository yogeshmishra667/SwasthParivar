import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";

export const PatternSummaryCard = (): JSX.Element => {
  const { t } = useTranslation();
  return (
    <Card className="border-blue-100 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/40">
      <View className="flex-row items-center gap-3 mb-3">
        <View className="h-10 w-10 rounded-full bg-blue-100 items-center justify-center">
          <Icon name="analytics" size={24} color="#2563EB" />
        </View>
        <Text className="text-important font-bold text-gray-900 dark:text-gray-100 flex-1">
          {t("insights.emptyState.title", { defaultValue: "Your health patterns look stable" })}
        </Text>
      </View>
      <Text className="text-body text-gray-700 dark:text-gray-300">
        {t("insights.emptyState.desc", {
          defaultValue:
            "We are continuously analyzing your readings. If any concerning patterns like consistent high sugar or frequent missed doses appear, you will see them here.",
        })}
      </Text>
    </Card>
  );
};
