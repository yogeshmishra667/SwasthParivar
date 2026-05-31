import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";

export const GuardianEmptyState = (): JSX.Element => {
  const { t } = useTranslation();
  return (
    <View className="flex-1 px-4 py-8">
      <Card className="items-center border-green-100 bg-green-50 py-8 dark:border-emerald-800 dark:bg-emerald-950/40">
        <View className="h-16 w-16 rounded-full bg-green-100 items-center justify-center mb-4">
          <Icon name="shield-checkmark" size={32} color="#16A34A" />
        </View>
        <Text className="text-hero font-bold text-gray-900 dark:text-gray-100 mb-2 text-center">
          {t("guardian.emptyState.title", { defaultValue: "All Safe & Sound" })}
        </Text>
        <Text className="text-body text-gray-700 dark:text-gray-300 text-center px-4">
          {t("guardian.emptyState.desc", {
            defaultValue:
              "Your family members have not had any critical health alerts recently. We are monitoring their logs and will notify you if anything needs your attention.",
          })}
        </Text>
      </Card>

      <Text className="mt-8 mb-4 text-important font-bold text-gray-900 dark:text-gray-100">
        {t("guardian.emptyState.howItWorks", { defaultValue: "How Family Alerts Work" })}
      </Text>

      <View className="gap-3">
        <View className="flex-row gap-3 items-center">
          <View className="h-10 w-10 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-950/60">
            <Icon name="phone-portrait-outline" size={20} color="#2563EB" />
          </View>
          <Text className="flex-1 text-body text-gray-700 dark:text-gray-300">
            {t("guardian.emptyState.step1", {
              defaultValue: "They log their sugar or vitals on their device.",
            })}
          </Text>
        </View>
        <View className="flex-row gap-3 items-center">
          <View className="h-10 w-10 items-center justify-center rounded-full bg-amber-50 dark:bg-amber-950/60">
            <Icon name="analytics-outline" size={20} color="#D97706" />
          </View>
          <Text className="flex-1 text-body text-gray-700 dark:text-gray-300">
            {t("guardian.emptyState.step2", { defaultValue: "We detect concerning patterns." })}
          </Text>
        </View>
        <View className="flex-row gap-3 items-center">
          <View className="h-10 w-10 items-center justify-center rounded-full bg-red-50 dark:bg-red-950/60">
            <Icon name="notifications-outline" size={20} color="#DC2626" />
          </View>
          <Text className="flex-1 text-body text-gray-700 dark:text-gray-300">
            {t("guardian.emptyState.step3", {
              defaultValue: "You receive an immediate alert here.",
            })}
          </Text>
        </View>
      </View>
    </View>
  );
};
