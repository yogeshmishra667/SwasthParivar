// Phase 2 — Guardian's read-only view of a patient's dashboard.
// Reuses the same Phase 2 dashboard widgets (summary, BP, meals,
// health score) — the server already strips PII / sensitive fields
// (`buildDashboard` with `notes` + medication photos / quantities
// dropped, patient phone never echoed).

import { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { SummaryCard } from "@/components/dashboard/SummaryCard";
import { BPCard } from "@/components/dashboard/BPCard";
import { MealsTodayCard } from "@/components/dashboard/MealsTodayCard";
import { HealthScoreCard } from "@/components/dashboard/HealthScoreCard";
import { getPatientDashboard, type PatientDashboardView } from "@/services/family";

export default function PatientDashboardScreen(): JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const patientId = typeof params.id === "string" ? params.id : "";
  const patientName = typeof params.name === "string" && params.name.length > 0 ? params.name : "—";

  const [view, setView] = useState<PatientDashboardView | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [fetchedAtIso, setFetchedAtIso] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!patientId) return;
    const data = await getPatientDashboard(patientId);
    setView(data);
    setFetchedAtIso(new Date().toISOString());
    setLoaded(true);
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = async (): Promise<void> => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <Stack.Screen options={{ title: patientName, headerBackTitle: "Back" }} />
      <View className="flex-row items-center justify-between px-4 py-3">
        <Text className="text-hero font-bold" numberOfLines={1}>
          {patientName}
        </Text>
        <View className="rounded-full bg-blue-50 px-3 py-1">
          <Text className="text-body font-semibold text-blue-700">
            {t("family.guardianHeader")}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 16 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
        }
      >
        {loaded && view === null ? (
          <Card>
            <View className="items-center gap-3 py-4">
              <Icon name="cloud-offline" size={32} color="#D97706" />
              <Text className="text-important text-center text-amber-900">
                {t("family.loadFailed")}
              </Text>
              <Button label={t("common.retry")} onPress={() => void onRefresh()} />
            </View>
          </Card>
        ) : view ? (
          <>
            <SummaryCard
              headline={view.summary.headline}
              details={view.summary.details}
              coldStart={view.summary.coldStart}
            />

            <Card>
              <Text className="text-body text-neutral">{t("dashboard.lastReading")}</Text>
              {view.latestReading ? (
                <View className="mt-1 flex-row items-baseline gap-2">
                  <Text className="text-5xl font-bold tracking-tight text-gray-900">
                    {view.latestReading.valueMgDl}
                  </Text>
                  <Text className="text-important text-neutral">mg/dL</Text>
                </View>
              ) : (
                <Text className="mt-2 text-important text-neutral">
                  {t("dashboard.noReadings")}
                </Text>
              )}
            </Card>

            <View className="flex-row gap-3">
              <View className="flex-1">
                <Card>
                  <Text className="text-body text-neutral">{t("dashboard.todayStreak")}</Text>
                  <View className="mt-1 flex-row items-center gap-1.5">
                    <Icon name="flame" size={24} color="#F59E0B" />
                    <Text className="text-3xl font-bold">{view.streak.currentStreakDays}</Text>
                    <Text className="text-body text-neutral">{t("common.days")}</Text>
                  </View>
                </Card>
              </View>
              <View className="flex-1">
                <Card>
                  <Text className="text-body text-neutral">{t("dashboard.todayReadings")}</Text>
                  <Text className="mt-1 text-3xl font-bold">{view.todayReadingCount}</Text>
                </Card>
              </View>
            </View>

            <BPCard latest={view.bpLatest} />
            <MealsTodayCard mealsToday={view.mealsToday} />

            {view.healthScore && (
              <HealthScoreCard
                score={view.healthScore.score}
                components={view.healthScore.components}
                computedForDate={view.healthScore.computedForDate}
              />
            )}

            {fetchedAtIso !== null && (
              <Text className="text-body text-neutral">
                {t("family.lastUpdated", { time: new Date(fetchedAtIso).toLocaleTimeString() })}
              </Text>
            )}

            <Button
              label={t("common.dashboard")}
              variant="ghost"
              onPress={() => router.replace("/(tabs)/family")}
            />
          </>
        ) : (
          <Card>
            <Text className="text-body text-neutral">{t("common.loading")}</Text>
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
