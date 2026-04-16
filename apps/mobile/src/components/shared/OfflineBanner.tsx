import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { useOfflineStatus } from "@/hooks/useOfflineStatus";

export const OfflineBanner = (): JSX.Element | null => {
  const { t } = useTranslation();
  const { showBanner } = useOfflineStatus();
  if (!showBanner) return null;

  return (
    <View className="bg-warning px-4 py-2">
      <Text className="text-body font-semibold text-white">{t("offline.banner")}</Text>
    </View>
  );
};
