import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { ActiveProfileBadge } from "@/components/profile/ActiveProfileBadge";
import { Card } from "@/components/ui/Card";

export default function MedicationsScreen(): JSX.Element {
  const { t } = useTranslation();

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <View className="flex-row items-center justify-between p-4">
        <Text className="text-hero font-bold">{t("medications.title")}</Text>
        <ActiveProfileBadge />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Card>
          <Text className="text-important">{t("medications.noMedicines")}</Text>
          <Text className="text-body text-neutral">{t("medications.addFromSettings")}</Text>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
