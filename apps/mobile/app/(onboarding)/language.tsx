import { View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { usePreferencesStore, type Language } from "@/stores/preferences.store";
import { i18n } from "@/i18n/config";

export default function LanguageScreen(): JSX.Element {
  const router = useRouter();
  const setLanguage = usePreferencesStore((s) => s.setLanguage);

  const choose = (lang: Language): void => {
    setLanguage(lang);
    void i18n.changeLanguage(lang);
    router.push("/(onboarding)/condition");
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 items-center justify-center px-6">
        {/* Header */}
        <View className="mb-10 items-center">
          <View className="mb-4 h-24 w-24 items-center justify-center rounded-full bg-blue-50">
            <Icon name="language" size={48} color="#2563EB" />
          </View>
          <Text className="text-3xl font-bold tracking-tight text-gray-900">Bhasha chunein</Text>
          <Text className="mt-2 text-center text-body text-gray-500">Choose your language</Text>
        </View>

        {/* Buttons */}
        <View className="w-full gap-3">
          <Button label="हिन्दी (Hindi)" onPress={() => choose("hi")} />
          <Button label="English" variant="secondary" onPress={() => choose("en")} />
        </View>
      </View>
    </SafeAreaView>
  );
}
