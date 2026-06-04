import { useState } from "react";
import { View, Text, ScrollView, Pressable, Switch } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { AddProfileModal } from "@/components/profile/AddProfileModal";
import { EditProfileModal } from "@/components/profile/EditProfileModal";
import { CheckFrequencyPicker } from "@/components/settings/CheckFrequencyPicker";
import { ReminderTimePicker } from "@/components/settings/ReminderTimePicker";
import { NotificationToggle } from "@/components/settings/NotificationToggle";
import { AnimatedThemeToggle } from "@/components/settings/AnimatedThemeToggle";
import { useAuthStore } from "@/stores/auth.store";
import { useProfileStore, type Profile } from "@/stores/profile.store";
import { usePreferencesStore } from "@/stores/preferences.store";
import { api } from "@/services/api";
import { logError } from "@/services/analytics";
import { useRouter } from "expo-router";
import { getFirstName } from "@/utils/getFirstName";
import { TOUCH_TARGET_MIN } from "@/utils/constants";

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
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);

  const onProfileAdded = (created: {
    id: string;
    name: string;
    age: number;
    conditions: string[];
  }): void => {
    if (!householdId) return;
    const next: Profile = {
      id: created.id,
      name: created.name,
      avatarColor: AVATAR_COLORS[profiles.length % AVATAR_COLORS.length] ?? "#6B7280",
      conditions: created.conditions,
      age: created.age,
    };
    setHousehold(householdId, [...profiles, next], primaryUserId);
    switchProfile(created.id);
    setShowAddProfile(false);
  };

  const onProfileEdited = (updatedProfile: Profile): void => {
    if (!householdId) return;
    const updatedProfiles = profiles.map((p) => (p.id === updatedProfile.id ? updatedProfile : p));
    setHousehold(householdId, updatedProfiles, primaryUserId);
    setEditingProfile(null);
  };

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-gray-900">
      <ScrollView
        contentContainerStyle={{ padding: 24, paddingBottom: 64 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-row items-center justify-between mb-6">
          <Text className="text-hero font-bold dark:text-white">{t("settings.title")}</Text>
          <AnimatedThemeToggle />
        </View>

        <View className="mb-8">
          <Text className="text-important font-bold text-gray-900 dark:text-gray-100 mb-2">
            {t("settings.preferences", { defaultValue: "App Preferences" })}
          </Text>
          <View className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-800 px-4">
            <CheckFrequencyPicker />
            <ReminderTimePicker />
            <NotificationToggle />

            <View
              className="flex-row items-center justify-between border-b border-gray-100 dark:border-gray-700 py-4"
              style={{ minHeight: TOUCH_TARGET_MIN }}
            >
              <View>
                <Text className="text-important font-semibold text-gray-900 dark:text-gray-100">
                  {t("settings.language", { defaultValue: "Language" })}
                </Text>
                <Text className="mt-1 text-body text-neutral dark:text-gray-400">
                  {language === "hi" ? "हिंदी (Hindi)" : "English"}
                </Text>
              </View>
              <Button
                label={
                  language === "hi" ? t("settings.switchToEnglish") : t("settings.switchToHindi")
                }
                variant="secondary"
                onPress={() => {
                  const next = language === "hi" ? "en" : "hi";
                  setLanguage(next);
                  void api.patch("/users/me", { preferredLanguage: next }).catch((err) => {
                    logError("settings.language", err);
                  });
                }}
              />
            </View>

            <View
              className="flex-row items-center justify-between py-4"
              style={{ minHeight: TOUCH_TARGET_MIN }}
            >
              <View>
                <Text className="text-important font-semibold text-gray-900 dark:text-gray-100">
                  {t("settings.accessibility", { defaultValue: "Large Text" })}
                </Text>
                <Text className="mt-1 text-body text-neutral dark:text-gray-400">
                  {largeText
                    ? t("settings.largeTextOn", { defaultValue: "On" })
                    : t("settings.largeTextOff", { defaultValue: "Off" })}
                </Text>
              </View>
              <Switch
                value={largeText}
                onValueChange={setLargeText}
                trackColor={{ false: "#D1D5DB", true: "#93C5FD" }}
                thumbColor={largeText ? "#2563EB" : "#F3F4F6"}
              />
            </View>
          </View>
        </View>

        <View className="mb-8">
          <Text className="text-important font-bold text-gray-900 dark:text-gray-100 mb-2">
            {t("settings.householdSection", { defaultValue: "Family on this device" })}
          </Text>
          <View className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-800">
            {profiles.map((p, index) => (
              <View
                key={p.id}
                className={`flex-row items-center justify-between p-4 ${index !== profiles.length - 1 ? "border-b border-gray-100 dark:border-gray-700" : ""}`}
                style={{ minHeight: TOUCH_TARGET_MIN }}
              >
                <View className="flex-row items-center gap-3">
                  <View
                    className="h-10 w-10 items-center justify-center rounded-full"
                    style={{ backgroundColor: p.avatarColor }}
                  >
                    <Text className="font-bold text-white">{p.name.charAt(0).toUpperCase()}</Text>
                  </View>
                  <View>
                    <Text className="text-important font-semibold text-gray-900 dark:text-gray-100">
                      {getFirstName(p.name)}
                    </Text>
                    {p.id === primaryUserId && (
                      <Text className="text-sm text-neutral dark:text-gray-400">
                        {t("settings.primaryProfile", { defaultValue: "Primary" })}
                      </Text>
                    )}
                  </View>
                </View>
                <Pressable
                  onPress={() => setEditingProfile(p)}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${p.name}`}
                  className="px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg"
                >
                  <Text className="text-body font-medium text-gray-700 dark:text-gray-200">
                    {t("common.edit", { defaultValue: "Edit" })}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
          <View className="mt-4">
            <Button
              label={`+ ${t("settings.addProfile", { defaultValue: "Add another profile" })}`}
              variant="secondary"
              onPress={() => setShowAddProfile(true)}
            />
          </View>
        </View>

        <View className="mb-8">
          <Text className="text-important font-bold text-gray-900 dark:text-gray-100 mb-2">
            {t("settings.safetySection", { defaultValue: "Safety" })}
          </Text>
          <View className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-800">
            <Pressable
              onPress={() => router.push("/settings/emergency-contacts")}
              accessibilityRole="button"
              accessibilityLabel={t("emergencyContacts.title", {
                defaultValue: "Emergency Contacts",
              })}
              style={{ minHeight: TOUCH_TARGET_MIN }}
              className="flex-row items-center gap-3 p-4"
            >
              <View className="h-10 w-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/40">
                <Icon name="alert-circle" size={22} color="#DC2626" />
              </View>
              <View className="flex-1">
                <Text className="text-important font-semibold text-gray-900 dark:text-gray-100">
                  {t("emergencyContacts.title", { defaultValue: "Emergency Contacts" })}
                </Text>
                <Text className="text-body text-neutral dark:text-gray-400">
                  {t("emergencyContacts.settingsHint", {
                    defaultValue: "Critical alert mein jinhe call kiya jayega",
                  })}
                </Text>
              </View>
              <Icon name="chevron-forward" size={20} color="#9CA3AF" />
            </Pressable>
          </View>
        </View>

        <View className="mt-4 mb-8">
          <Button
            label={t("common.logout")}
            variant="critical"
            onPress={() => {
              void clear().then(() => router.replace("/(auth)/login"));
            }}
          />
        </View>
      </ScrollView>

      <AddProfileModal
        visible={showAddProfile}
        onClose={() => setShowAddProfile(false)}
        onSuccess={onProfileAdded}
      />

      <EditProfileModal
        visible={!!editingProfile}
        profile={editingProfile}
        isPrimary={editingProfile?.id === primaryUserId}
        onClose={() => setEditingProfile(null)}
        onSuccess={onProfileEdited}
      />
    </SafeAreaView>
  );
}
