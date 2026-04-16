import { View, Text } from "react-native";
import { useRouter } from "expo-router";
import { Button } from "@/components/ui/Button";

export default function MedicationsOnboarding(): JSX.Element {
  const router = useRouter();
  const finish = (): void => router.replace("/(tabs)/dashboard");

  return (
    <View className="flex-1 justify-center gap-4 bg-white p-6">
      <Text className="text-hero font-bold">Dawaiyan add karni hain?</Text>
      <Text className="text-important">Baad mein bhi kar sakte hain.</Text>
      <Button label="Haan, add karein" onPress={() => router.push("/(tabs)/medications")} />
      <Button label="Abhi skip" variant="ghost" onPress={finish} />
    </View>
  );
}
