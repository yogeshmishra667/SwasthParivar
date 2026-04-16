import { View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/ui/Button";
import { useAuthStore } from "@/stores/auth.store";
import { usePreferencesStore } from "@/stores/preferences.store";
import { i18n } from "@/i18n/config";
import { useRouter } from "expo-router";

export default function SettingsScreen(): JSX.Element {
  const router = useRouter();
  const clear = useAuthStore((s) => s.clear);
  const largeText = usePreferencesStore((s) => s.largeText);
  const setLargeText = usePreferencesStore((s) => s.setLargeText);
  const language = usePreferencesStore((s) => s.language);
  const setLanguage = usePreferencesStore((s) => s.setLanguage);

  return (
    <SafeAreaView className="flex-1 gap-4 bg-white p-6">
      <Text className="text-hero font-bold">Settings</Text>

      <Button
        label={language === "hi" ? "Switch to English" : "हिन्दी par switch karein"}
        variant="ghost"
        onPress={() => {
          const next = language === "hi" ? "en" : "hi";
          setLanguage(next);
          void i18n.changeLanguage(next);
        }}
      />

      <Button
        label={largeText ? "Normal text" : "Bada text (1.3×)"}
        variant="ghost"
        onPress={() => setLargeText(!largeText)}
      />

      <View className="mt-6">
        <Button
          label="Logout"
          variant="critical"
          onPress={() => {
            void clear().then(() => router.replace("/(auth)/login"));
          }}
        />
      </View>
    </SafeAreaView>
  );
}
