import { useState } from "react";
import { View, Text, TextInput } from "react-native";
import { useRouter } from "expo-router";
import { Button } from "@/components/ui/Button";
import { api } from "@/services/api";
import { TOUCH_TARGET_MIN } from "@/utils/constants";

export default function ProfileScreen(): JSX.Element {
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
    } catch {
      // continue even if server unreachable — offline-first
    }
    setSaving(false);
    router.push("/(onboarding)/first-reading");
  };

  return (
    <View className="flex-1 justify-center gap-4 bg-white p-6">
      <Text className="text-hero font-bold">Thoda bataiye</Text>

      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Naam"
        accessibilityLabel="Name"
        style={{ minHeight: TOUCH_TARGET_MIN }}
        className="rounded-2xl border border-neutral px-4 text-important"
      />
      <TextInput
        value={age}
        onChangeText={setAge}
        placeholder="Umar"
        keyboardType="number-pad"
        accessibilityLabel="Age"
        style={{ minHeight: TOUCH_TARGET_MIN }}
        className="rounded-2xl border border-neutral px-4 text-important"
      />

      <Button
        label="Agay badhein"
        onPress={() => void submit()}
        disabled={!canContinue || saving}
      />
    </View>
  );
}
