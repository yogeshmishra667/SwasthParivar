import { useState } from "react";
import { View, Text } from "react-native";
import { useRouter } from "expo-router";
import { Button } from "@/components/ui/Button";
import { api } from "@/services/api";

export default function MedicationsOnboarding(): JSX.Element {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const completeOnboarding = async (): Promise<void> => {
    setSaving(true);
    try {
      await api.patch("/users/me", {
        onboardingComplete: true,
        onboardingStep: 5,
      });
    } catch {
      // offline-first — proceed to dashboard
    }
    setSaving(false);
    router.replace("/(tabs)/dashboard");
  };

  return (
    <View className="flex-1 justify-center gap-4 bg-white p-6">
      <Text className="text-hero font-bold">Dawaiyan add karni hain?</Text>
      <Text className="text-important">Baad mein bhi kar sakte hain.</Text>
      <Button
        label="Haan, add karein"
        onPress={() => router.push("/(tabs)/medications")}
        disabled={saving}
      />
      <Button
        label="Abhi skip"
        variant="ghost"
        onPress={() => void completeOnboarding()}
        disabled={saving}
      />
    </View>
  );
}
