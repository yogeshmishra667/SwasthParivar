import { useState } from "react";
import { View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { AddProfileModal } from "@/components/profile/AddProfileModal";
import { useAuthStore } from "@/stores/auth.store";
import { useProfileStore, type Profile } from "@/stores/profile.store";
import { usePreferencesStore } from "@/stores/preferences.store";
import { api } from "@/services/api";
import { logError } from "@/services/analytics";
import { useRouter } from "expo-router";

const AVATAR_COLORS = ["#2563EB", "#16A34A", "#D97706", "#DC2626", "#8B5CF6"];

export default function SettingsScreen(): JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const clear = useAuthStore((s) => s.clear);
  const largeText = usePreferencesStore((s) => s.largeText);
  const setLargeText = usePreferencesStore((s) => s.setLargeText);
  const language = usePreferencesStore((s) => s.language);
  const setLanguage = usePreferencesStore((s) => s.setLanguage);
  const profiles = useProfileStore((s) => s.profiles);
  const householdId = useProfileStore((s) => s.householdId);
  const primaryUserId = useProfileStore((s) => s.primaryUserId);
  const setHousehold = useProfileStore((s) => s.setHousehold);
  const switchProfile = useProfileStore((s) => s.switchProfile);
  const [showAddProfile, setShowAddProfile] = useState(false);

  const onProfileAdded = (created: {
    id: string;
    name: string;
    age: number;
    conditions: string[];
  }): void => {
    if (!householdId) return;
    // Splice the newly-created profile into the local household list and
    // make it active immediately. Avoids a round-trip to /users/me.
    const next: Profile = {
      id: created.id,
      name: created.name,
      avatarColor: AVATAR_COLORS[profiles.length % AVATAR_COLORS.length] ?? "#6B7280",
      conditions: created.conditions,
    };
    setHousehold(householdId, [...profiles, next], primaryUserId);
    switchProfile(created.id);
    setShowAddProfile(false);
  };

  return (
    <SafeAreaView className="flex-1 gap-4 bg-white p-6">
      <Text className="text-hero font-bold">{t("settings.title")}</Text>

      <Button
        label={language === "hi" ? t("settings.switchToEnglish") : t("settings.switchToHindi")}
        variant="ghost"
        onPress={() => {
          const next = language === "hi" ? "en" : "hi";
          setLanguage(next); // also calls i18n.changeLanguage internally
          // Sync to server so server-composed copy (dashboard summary etc.)
          // also switches language.
          void api.patch("/users/me", { preferredLanguage: next }).catch((err) => {
            logError("settings.language", err);
          });
        }}
      />

      <Button
        label={largeText ? t("settings.normalText") : t("settings.largeText")}
        variant="ghost"
        onPress={() => setLargeText(!largeText)}
      />

      <View className="mt-2 gap-2">
        <Text className="text-important font-semibold">
          {t("settings.householdSection", { defaultValue: "Family on this device" })}
        </Text>
        <Text className="text-body text-neutral">
          {t("settings.householdHint", {
            count: profiles.length,
            defaultValue: `${profiles.length} profile${profiles.length === 1 ? "" : "s"}`,
          })}
        </Text>
        <Button
          label={`+ ${t("settings.addProfile", { defaultValue: "Add another profile" })}`}
          variant="secondary"
          onPress={() => setShowAddProfile(true)}
        />
      </View>

      <View className="mt-6">
        <Button
          label={t("common.logout")}
          variant="critical"
          onPress={() => {
            void clear().then(() => router.replace("/(auth)/login"));
          }}
        />
      </View>

      <AddProfileModal
        visible={showAddProfile}
        onClose={() => setShowAddProfile(false)}
        onSuccess={onProfileAdded}
      />
    </SafeAreaView>
  );
}
