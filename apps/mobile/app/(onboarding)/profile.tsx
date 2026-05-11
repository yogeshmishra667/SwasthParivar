import { useState } from "react";
import { View, Text, TextInput, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { api } from "@/services/api";
import { logError } from "@/services/analytics";
import { TOUCH_TARGET_MIN } from "@/utils/constants";

export default function ProfileScreen(): JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [saving, setSaving] = useState(false);

  const canContinue = name.trim().length >= 2 && Number(age) >= 18 && Number(age) <= 110;

  const submit = async (): Promise<void> => {
    setSaving(true);
    try {
      await api.patch("/users/me", {
        name: name.trim(),
        age: Number(age),
        onboardingStep: 3,
      });
    } catch (e) {
      logError("onboarding/profile", e);
    }
    setSaving(false);
    router.push("/(onboarding)/first-reading");
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View className="mb-10 items-center">
            <View className="mb-4 h-24 w-24 items-center justify-center rounded-full bg-blue-50">
              <Icon name="person" size={48} color="#2563EB" />
            </View>
            <Text className="text-3xl font-bold tracking-tight text-gray-900">
              {t("onboarding.tellUs")}
            </Text>
            <Text className="mt-2 text-center text-body text-gray-500">
              {t("onboarding.tellUsSubtitle", {
                defaultValue: "Hum aapko behtar care de sakein, iske liye thodi jaankari chahiye.",
              })}
            </Text>
          </View>

          {/* Name Input */}
          <View className="mb-4">
            <Text className="mb-2 text-important font-semibold text-gray-800">
              {t("onboarding.nameLabel", { defaultValue: "Aapka naam" })}
            </Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder={t("onboarding.namePlaceholder")}
              placeholderTextColor="#9CA3AF"
              autoCorrect={false}
              accessibilityLabel="Name"
              style={{ minHeight: TOUCH_TARGET_MIN }}
              className="rounded-2xl border border-gray-300 bg-gray-50 px-4 py-3 text-important font-semibold text-gray-900"
            />
          </View>

          {/* Age Input */}
          <View className="mb-6">
            <Text className="mb-2 text-important font-semibold text-gray-800">
              {t("onboarding.ageLabel", { defaultValue: "Aapki umar" })}
            </Text>
            <TextInput
              value={age}
              onChangeText={(v) => setAge(v.replace(/[^0-9]/g, ""))}
              placeholder={t("onboarding.agePlaceholder")}
              placeholderTextColor="#9CA3AF"
              keyboardType="number-pad"
              maxLength={3}
              accessibilityLabel="Age"
              style={{ minHeight: TOUCH_TARGET_MIN }}
              className="rounded-2xl border border-gray-300 bg-gray-50 px-4 py-3 text-important font-semibold text-gray-900"
            />
          </View>

          <Button
            label={t("common.next")}
            onPress={() => void submit()}
            disabled={!canContinue || saving}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
