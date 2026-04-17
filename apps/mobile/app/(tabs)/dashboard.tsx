import { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ActiveProfileBadge } from "@/components/profile/ActiveProfileBadge";
import { ProfileSwitcher } from "@/components/profile/ProfileSwitcher";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useActiveProfile } from "@/hooks/useActiveProfile";
import { api } from "@/services/api";

interface DashboardData {
  streak: { currentStreakDays: number };
  latestReading: { valueMgDl: number; readingType: string; measuredAt: string } | null;
  todayReadingCount: number;
  medications: { id: string; medicineName: string }[];
}

const EMPTY: DashboardData = {
  streak: { currentStreakDays: 0 },
  latestReading: null,
  todayReadingCount: 0,
  medications: [],
};

export default function DashboardScreen(): JSX.Element {
  const router = useRouter();
  const profile = useActiveProfile();
  const [data, setData] = useState<DashboardData>(EMPTY);
  const [refreshing, setRefreshing] = useState(false);
  const [stale, setStale] = useState(false);

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await api.get<{ success: boolean; data: DashboardData }>("/dashboard");
      setData(res.data);
      setStale(false);
    } catch {
      setStale(true);
    }
  }, []);

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  const onRefresh = async (): Promise<void> => {
    setRefreshing(true);
    await fetchDashboard();
    setRefreshing(false);
  };

  const greeting = profile?.name ? `Namaste, ${profile.name} ji` : "Namaste";
  const streak = data.streak.currentStreakDays;
  const latest = data.latestReading;

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <View className="flex-row items-center justify-between px-4 py-3">
        <Text className="text-hero font-bold" numberOfLines={1}>
          {greeting}
        </Text>
        <ActiveProfileBadge />
      </View>
      <ProfileSwitcher />

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 16 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
        }
      >
        {stale && (
          <Text className="text-body text-warning">
            Purana data dikh raha hai — pull to refresh.
          </Text>
        )}

        <Card>
          <Text className="text-body text-neutral">Aaj ki streak</Text>
          <View className="mt-1 flex-row items-center gap-2">
            <Icon name="flame" size={28} color="#F59E0B" />
            <Text className="text-hero font-bold">{streak}</Text>
            <Text className="text-body text-neutral">din</Text>
          </View>
        </Card>

        <Card>
          <Text className="text-body text-neutral">Aakhri reading</Text>
          {latest ? (
            <>
              <Text className="text-hero font-bold">{latest.valueMgDl} mg/dL</Text>
              <Text className="text-body text-neutral">
                {latest.readingType === "fasting" ? "Fasting" : "Post-meal"}
              </Text>
            </>
          ) : (
            <Text className="text-body text-neutral">
              Koi reading nahi — abhi log karein.
            </Text>
          )}
        </Card>

        <Card>
          <Text className="text-body text-neutral">Aaj ki readings</Text>
          <Text className="text-hero font-bold">{data.todayReadingCount}</Text>
        </Card>

        <Button label="Reading log karein" onPress={() => router.push("/(tabs)/log")} />
      </ScrollView>
    </SafeAreaView>
  );
}
