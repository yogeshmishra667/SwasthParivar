import { useState } from "react";
import { View, Text, TextInput } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
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
    <View className="flex-1 justify-center gap-4 bg-white p-6">
      <Text className="text-hero font-bold">{t("onboarding.tellUs")}</Text>

      <TextInput
        value={name}
        onChangeText={setName}
        placeholder={t("onboarding.namePlaceholder")}
        accessibilityLabel="Name"
        style={{ minHeight: TOUCH_TARGET_MIN }}
        className="rounded-2xl border border-neutral px-4 text-important"
      />
      <TextInput
        value={age}
        onChangeText={setAge}
        placeholder={t("onboarding.agePlaceholder")}
        keyboardType="number-pad"
        accessibilityLabel="Age"
        style={{ minHeight: TOUCH_TARGET_MIN }}
        className="rounded-2xl border border-neutral px-4 text-important"
      />

      <Button
        label={t("common.next")}
        onPress={() => void submit()}
        disabled={!canContinue || saving}
      />
    </View>
  );
}
