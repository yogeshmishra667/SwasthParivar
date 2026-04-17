import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ActiveProfileBadge } from "@/components/profile/ActiveProfileBadge";
import { ProfileSwitcher } from "@/components/profile/ProfileSwitcher";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

export default function DashboardScreen(): JSX.Element {
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <View className="flex-row items-center justify-between px-4 py-3">
        <Text className="text-hero font-bold">Namaste</Text>
        <ActiveProfileBadge />
      </View>
      <ProfileSwitcher />

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <Card>
          <Text className="text-body text-neutral">Aaj ki streak</Text>
          <View className="mt-1 flex-row items-center gap-2">
            <Icon name="flame" size={28} color="#F59E0B" />
            <Text className="text-hero font-bold">—</Text>
          </View>
        </Card>

        <Card>
          <Text className="text-body text-neutral">Aakhri reading</Text>
          <Text className="text-hero font-bold">— mg/dL</Text>
          <Text className="text-body text-neutral">
            Koi reading nahi — abhi log karein.
          </Text>
        </Card>

        <Button label="Reading log karein" onPress={() => router.push("/(tabs)/log")} />
      </ScrollView>
    </SafeAreaView>
  );
}
