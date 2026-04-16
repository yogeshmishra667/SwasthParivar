import { View, Text } from "react-native";
import { useRouter } from "expo-router";
import { Button } from "@/components/ui/Button";
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
    <View className="flex-1 justify-center gap-4 bg-white p-6">
      <Text className="text-hero font-bold">Bhasha chunein / Choose language</Text>
      <Button label="हिन्दी (Hindi)" onPress={() => choose("hi")} />
      <Button label="English" variant="secondary" onPress={() => choose("en")} />
    </View>
  );
}
