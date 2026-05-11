import { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { ActiveProfileBadge } from "@/components/profile/ActiveProfileBadge";
import { SyncStatusBadge } from "@/components/shared/SyncStatusBadge";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useActiveProfile } from "@/hooks/useActiveProfile";
import { useProfileStore } from "@/stores/profile.store";
import { api } from "@/services/api";
import { logError } from "@/services/analytics";

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

const AVATAR_COLORS = ["#2563EB", "#16A34A", "#D97706", "#DC2626", "#8B5CF6"];

export default function DashboardScreen(): JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const profile = useActiveProfile();
  const setHousehold = useProfileStore((s) => s.setHousehold);
  const [data, setData] = useState<DashboardData>(EMPTY);
  const [refreshing, setRefreshing] = useState(false);
  const [stale, setStale] = useState(false);
  const [timeAnomaly, setTimeAnomaly] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [dashRes, userRes] = await Promise.all([
        api.get<{ success: boolean; data: DashboardData }>("/dashboard"),
        api.get<{ success: boolean; data: { householdId: string; householdProfiles: { id: string; name: string; age: number; conditions: string[] }[]; timeAnomalyCount?: number } }>("/users/me"),
      ]);
      setData(dashRes.data);
      setHousehold(
        userRes.data.householdId,
        userRes.data.householdProfiles.map((p, i) => ({
          id: p.id,
          name: p.name || "User",
          avatarColor: AVATAR_COLORS[i % AVATAR_COLORS.length] ?? "#6B7280",
          conditions: p.conditions,
        })),
      );
      setTimeAnomaly((userRes.data.timeAnomalyCount ?? 0) >= 2);
      setStale(false);
    } catch (e) {
      logError("dashboard", e);
      setStale(true);
    }
  }, [setHousehold]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const onRefresh = async (): Promise<void> => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  };

  const greeting = profile?.name
    ? t("dashboard.greeting", { name: profile.name })
    : t("dashboard.greetingDefault");
  const streak = data.streak.currentStreakDays;
  const latest = data.latestReading;

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <View className="flex-row items-center justify-between px-4 py-3">
        <Text className="text-hero font-bold" numberOfLines={1}>
          {greeting}
        </Text>
        <View className="flex-row items-center gap-2">
          <SyncStatusBadge />
          <ActiveProfileBadge />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 16 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
        }
      >
        {stale && (
          <Text className="text-body text-warning">{t("dashboard.staleData")}</Text>
        )}

        {timeAnomaly && (
          <View className="rounded-lg border border-amber-600 bg-amber-50 p-3">
            <Text className="text-body text-amber-900">{t("timeAnomaly.banner")}</Text>
          </View>
        )}

        <Card>
          <Text className="text-body text-neutral">{t("dashboard.todayStreak")}</Text>
          <View className="mt-1 flex-row items-center gap-2">
            <Icon name="flame" size={28} color="#F59E0B" />
            <Text className="text-hero font-bold">{streak}</Text>
            <Text className="text-body text-neutral">{t("common.days")}</Text>
          </View>
        </Card>

        <Card>
          <Text className="text-body text-neutral">{t("dashboard.lastReading")}</Text>
          {latest ? (
            <>
              <Text className="text-hero font-bold">{latest.valueMgDl} mg/dL</Text>
              <Text className="text-body text-neutral">
                {latest.readingType === "fasting" ? t("logging.fasting") : t("logging.postMeal")}
              </Text>
            </>
          ) : (
            <Text className="text-body text-neutral">{t("dashboard.noReadings")}</Text>
          )}
        </Card>

        <Card>
          <Text className="text-body text-neutral">{t("dashboard.todayReadings")}</Text>
          <Text className="text-hero font-bold">{data.todayReadingCount}</Text>
        </Card>

        <Button label={t("dashboard.logReading")} onPress={() => router.push("/(tabs)/log")} />
      </ScrollView>
    </SafeAreaView>
  );
}
