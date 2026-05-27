import { Modal, View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/Icon";

interface Props {
  active: boolean;
}

export function MaintenanceBanner({ active }: Props): JSX.Element | null {
  const { t } = useTranslation();
  if (!active) return null;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <View className="flex-1 bg-black/60 items-center justify-center px-6">
        <SafeAreaView className="w-full max-w-md">
          <View className="bg-white rounded-3xl px-6 py-8 items-center shadow-2xl">
            <View className="h-20 w-20 rounded-full bg-warning/10 items-center justify-center mb-5">
              <Icon name="construct" size={40} color="#D97706" accessibilityLabel="Maintenance" />
            </View>

            <Text className="text-important font-bold text-neutral mb-2 tracking-wide">
              {t("maintenance.eyebrow")}
            </Text>

            <Text
              className="text-hero font-bold text-gray-900 mb-3 text-center"
              style={{ lineHeight: 38 }}
            >
              {t("maintenance.title")}
            </Text>

            <Text
              className="text-important text-neutral text-center mb-6"
              style={{ lineHeight: 24 }}
            >
              {t("maintenance.fallback")}
            </Text>

            <View className="w-full bg-gray-50 rounded-2xl px-4 py-3 flex-row items-center justify-center">
              <View className="h-2 w-2 rounded-full bg-warning mr-2" />
              <Text className="text-body text-neutral font-medium">
                {t("maintenance.reassurance")}
              </Text>
            </View>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
