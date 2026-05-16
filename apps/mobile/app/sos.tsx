import { View, Text, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { sanitizePhoneForTelUri } from "@/utils/phone";

export default function SosScreen(): JSX.Element {
  const router = useRouter();
  const { phone, name } = useLocalSearchParams<{ phone?: string; name?: string }>();

  const call = (): void => {
    const tel = sanitizePhoneForTelUri(phone);
    if (tel.length === 0) return;
    void Linking.openURL(`tel:${tel}`);
  };

  return (
    <SafeAreaView className="flex-1 items-center justify-center bg-critical p-6">
      <Icon name="warning" size={72} color="#FFFFFF" accessibilityLabel="Emergency" />
      <Text className="mt-4 text-hero font-bold text-white">Emergency</Text>
      <Text className="mt-2 text-important text-white">{name ?? "Contact"} ko call karein</Text>
      <View className="mt-6 w-full gap-3">
        <Button
          label="Abhi call karein"
          onPress={call}
          disabled={sanitizePhoneForTelUri(phone).length === 0}
        />
        <Button label="Close" variant="ghost" onPress={() => router.back()} />
      </View>
    </SafeAreaView>
  );
}
