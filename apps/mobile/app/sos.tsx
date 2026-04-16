import { View, Text, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Button } from "@/components/ui/Button";

export default function SosScreen(): JSX.Element {
  const router = useRouter();
  const { phone, name } = useLocalSearchParams<{ phone?: string; name?: string }>();

  const call = (): void => {
    if (phone) void Linking.openURL(`tel:${phone}`);
  };

  return (
    <SafeAreaView className="flex-1 items-center justify-center bg-critical p-6">
      <Text className="text-6xl">🆘</Text>
      <Text className="mt-4 text-hero font-bold text-white">Emergency</Text>
      <Text className="mt-2 text-important text-white">{name ?? "Contact"} ko call karein</Text>
      <View className="mt-6 w-full gap-3">
        <Button label="📞 Abhi call karein" onPress={call} />
        <Button label="Close" variant="ghost" onPress={() => router.back()} />
      </View>
    </SafeAreaView>
  );
}
