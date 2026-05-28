import { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, RefreshControl, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { ActiveProfileBadge } from "@/components/profile/ActiveProfileBadge";
import { SyncStatusBadge } from "@/components/shared/SyncStatusBadge";
import { WelcomeBackBanner } from "@/components/dashboard/WelcomeBackBanner";
import { SummaryCard } from "@/components/dashboard/SummaryCard";
import { BPCard } from "@/components/dashboard/BPCard";
import { MealsTodayCard } from "@/components/dashboard/MealsTodayCard";
import { HealthScoreCard } from "@/components/dashboard/HealthScoreCard";
import { HbA1cCard } from "@/components/dashboard/HbA1cCard";
import { InsightsBadge } from "@/components/dashboard/InsightsBadge";
import { GlucoseTrendChart, type TrendPoint } from "@/components/dashboard/GlucoseTrendChart";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useActiveProfile } from "@/hooks/useActiveProfile";
import { useProfileStore } from "@/stores/profile.store";
import { api } from "@/services/api";
import { logError } from "@/services/analytics";
import {
  type CachedDashboard,
  type CachedDashboardSummary,
  daysSinceLatestReading,
  loadDashboardCache,
  saveDashboardCache,
} from "@/services/dashboard-cache";

interface DashboardData {
  summary?: CachedDashboardSummary;
  streak: { currentStreakDays: number };
  latestReading: { valueMgDl: number; readingType: string; measuredAt: string } | null;
  todayReadingCount: number;
  medications: { id: string; medicineName: string }[];
  bpLatest: {
    systolic: number;
    diastolic: number;
    pulse: number | null;
    measuredAt: string;
  } | null;
  mealsToday: { id: string; mealType: string; mealCategory: string; loggedAt: string }[];
  insightsUnacknowledgedCount: number;
  healthScore: {
    score: number;
    components: {
      logging: number;
      stability: number;
      trend: number;
      medication: number;
      streak: number;
    };
    computedForDate: string;
  } | null;
}

const EMPTY: DashboardData = {
  streak: { currentStreakDays: 0 },
  latestReading: null,
  todayReadingCount: 0,
  medications: [],
  bpLatest: null,
  mealsToday: [],
  insightsUnacknowledgedCount: 0,
  healthScore: null,
};

const AVATAR_COLORS = ["#2563EB", "#16A34A", "#D97706", "#DC2626", "#8B5CF6"];

const STALE_THRESHOLD_MS = 60 * 60 * 1000;

const formatRelativeTime = (iso: string): string => {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
};

export default function DashboardScreen(): JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const profile = useActiveProfile();
  const setHousehold = useProfileStore((s) => s.setHousehold);
  const [data, setData] = useState<DashboardData>(EMPTY);
  const [refreshing, setRefreshing] = useState(false);
  const [cacheFetchedAt, setCacheFetchedAt] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [hydratedFromCache, setHydratedFromCache] = useState(false);
  const [timeAnomaly, setTimeAnomaly] = useState(false);
  const [userStageDays, setUserStageDays] = useState(0);
  const [trendPoints, setTrendPoints] = useState<readonly TrendPoint[]>([]);

  useEffect(() => {
    void (async () => {
      const cache = await loadDashboardCache();
      if (cache) {
        setData({
          streak: cache.streak,
          latestReading: cache.latestReading,
          todayReadingCount: cache.todayReadingCount,
          medications: cache.medications,
          ...(cache.summary ? { summary: cache.summary } : {}),
          bpLatest: cache.bpLatest ?? null,
          mealsToday: cache.mealsToday ?? [],
          insightsUnacknowledgedCount: cache.insightsUnacknowledgedCount ?? 0,
          healthScore: cache.healthScore ?? null,
        });
        setCacheFetchedAt(cache.fetchedAt);
        setHydratedFromCache(true);
      }
    })();
  }, []);

  const activeProfileId = profile?.id ?? null;

  const fetchAll = useCallback(async () => {
    try {
      const [dashRes, userRes] = await Promise.all([
        api.get<{
          success: boolean;
          data: DashboardData & { summary?: CachedDashboardSummary };
        }>("/dashboard", {
          params: activeProfileId ? { targetUserId: activeProfileId } : undefined,
        }),
        api.get<{
          success: boolean;
          data: {
            householdId: string;
            primaryUserId: string | null;
            householdProfiles: { id: string; name: string; age: number; conditions: string[] }[];
            timeAnomalyCount?: number;
            createdAt?: string;
          };
        }>("/users/me"),
      ]);
      const fresh = dashRes.data;
      setData(fresh);
      setHousehold(
        userRes.data.householdId,
        userRes.data.householdProfiles.map((p, i) => ({
          id: p.id,
          name: p.name || "User",
          avatarColor: AVATAR_COLORS[i % AVATAR_COLORS.length] ?? "#6B7280",
          conditions: p.conditions,
        })),
        userRes.data.primaryUserId,
      );
      setTimeAnomaly((userRes.data.timeAnomalyCount ?? 0) >= 2);

      if (userRes.data.createdAt !== undefined) {
        const days = Math.floor(
          (Date.now() - new Date(userRes.data.createdAt).getTime()) / 86_400_000,
        );
        setUserStageDays(days);
      }

      // Fetch trend points (last 14 days). Cheap to grab alongside the
      // dashboard; failures here are non-fatal (chart shows empty state).
      try {
        const fromIso = new Date(Date.now() - 14 * 86_400_000).toISOString();
        const trendRes = await api.get<{
          success: boolean;
          data: { data: TrendPoint[] };
        }>("/readings/glucose", { params: { from: fromIso, limit: 100 } });
        setTrendPoints(trendRes.data.data);
      } catch (e) {
        logError("dashboard.trend", e);
      }

      setStale(false);

      const fetchedAt = new Date().toISOString();
      setCacheFetchedAt(fetchedAt);
      const next: CachedDashboard = {
        streak: fresh.streak,
        latestReading: fresh.latestReading,
        todayReadingCount: fresh.todayReadingCount,
        medications: fresh.medications,
        ...(fresh.summary ? { summary: fresh.summary } : {}),
        bpLatest: fresh.bpLatest,
        mealsToday: fresh.mealsToday,
        insightsUnacknowledgedCount: fresh.insightsUnacknowledgedCount,
        healthScore: fresh.healthScore,
        fetchedAt,
      };
      void saveDashboardCache(next);
    } catch (e) {
      logError("dashboard", e);
      setStale(true);
    }
  }, [setHousehold, activeProfileId]);

  // Refetch whenever the tab regains focus — tab screens stay mounted,
  // so a reading logged elsewhere wouldn't otherwise reflect on return.
  useFocusEffect(
    useCallback(() => {
      void fetchAll();
    }, [fetchAll]),
  );

  const onRefresh = async (): Promise<void> => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  };

  const profileName = profile?.name && profile.name.trim().length > 0 ? profile.name : null;
  const greeting = profileName
    ? t("dashboard.greeting", { name: profileName })
    : t("dashboard.greetingDefault", { defaultValue: "Namaste 🙏" });
  const streak = data.streak.currentStreakDays;
  const latest = data.latestReading;

  const cacheCache: CachedDashboard | null = data.latestReading
    ? {
        streak: data.streak,
        latestReading: data.latestReading,
        todayReadingCount: data.todayReadingCount,
        medications: data.medications,
        fetchedAt: cacheFetchedAt ?? new Date().toISOString(),
      }
    : null;
  const daysSinceLatest = daysSinceLatestReading(cacheCache);
  const cacheAgeMs = cacheFetchedAt ? Date.now() - new Date(cacheFetchedAt).getTime() : 0;
  const showStale = stale && hydratedFromCache && cacheAgeMs >= STALE_THRESHOLD_MS;

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
        {showStale && cacheFetchedAt && (
          <View className="rounded-lg border border-warning bg-amber-50 p-3">
            <Text className="text-body text-amber-900">{t("dashboard.staleData")}</Text>
            <Text className="mt-0.5 text-body text-neutral">
              {t("dashboard.lastUpdated", {
                time: formatRelativeTime(cacheFetchedAt),
                defaultValue: `Last updated: ${formatRelativeTime(cacheFetchedAt)}`,
              })}
            </Text>
          </View>
        )}

        {timeAnomaly && (
          <View className="rounded-lg border border-amber-600 bg-amber-50 p-3">
            <Text className="text-body text-amber-900">{t("timeAnomaly.banner")}</Text>
          </View>
        )}

        <WelcomeBackBanner
          daysSinceLatest={daysSinceLatest}
          loggedToday={data.todayReadingCount > 0}
        />

        {/* Phase 2: server-composed natural-language summary. Top-of-fold
            because it answers "how am I today?" in one glance. */}
        {data.summary && (
          <SummaryCard
            headline={data.summary.headline}
            details={data.summary.details}
            coldStart={data.summary.coldStart}
          />
        )}

        <InsightsBadge count={data.insightsUnacknowledgedCount} />

        {/* Hero — latest glucose reading. */}
        <Card>
          <Text className="text-body text-neutral">{t("dashboard.lastReading")}</Text>
          {latest ? (
            <>
              <View className="mt-1 flex-row items-baseline gap-2">
                <Text className="text-5xl font-bold tracking-tight text-gray-900">
                  {latest.valueMgDl}
                </Text>
                <Text className="text-important text-neutral">mg/dL</Text>
              </View>
              <View className="mt-2 self-start rounded-full bg-blue-50 px-3 py-1">
                <Text className="text-body font-semibold text-blue-700">
                  {latest.readingType === "fasting"
                    ? t("logging.fasting")
                    : latest.readingType === "post_meal"
                      ? t("logging.postMeal")
                      : latest.readingType}
                </Text>
              </View>
            </>
          ) : (
            <Text className="mt-2 text-important text-neutral">{t("dashboard.noReadings")}</Text>
          )}
        </Card>

        {/* Stat strip — streak | today's logs */}
        <View className="flex-row gap-3">
          <View className="flex-1">
            <Card>
              <Text className="text-body text-neutral">{t("dashboard.todayStreak")}</Text>
              <View className="mt-1 flex-row items-center gap-1.5">
                <Icon name="flame" size={24} color="#F59E0B" />
                <Text className="text-3xl font-bold">{streak}</Text>
                <Text className="text-body text-neutral">{t("common.days")}</Text>
              </View>
            </Card>
          </View>
          <View className="flex-1">
            <Card>
              <Text className="text-body text-neutral">{t("dashboard.todayReadings")}</Text>
              <Text className="mt-1 text-3xl font-bold">{data.todayReadingCount}</Text>
            </Card>
          </View>
        </View>

        {/* 14-day glucose trend chart — Skia-accelerated Victory Native. */}
        <GlucoseTrendChart points={trendPoints} />

        {/* Phase 2 — BP latest + today's meals strip. */}
        <BPCard latest={data.bpLatest} />
        <MealsTodayCard mealsToday={data.mealsToday} />

        {data.healthScore && (
          <HealthScoreCard
            score={data.healthScore.score}
            components={data.healthScore.components}
            computedForDate={data.healthScore.computedForDate}
          />
        )}

        {/* HbA1c estimate — always renders. Shows a locked progress
            card before day 14, then the estimate (or "need more
            readings" copy) once unlocked. */}
        <HbA1cCard userStageDays={userStageDays} />

        {/* AI chat entry — placed below the medical cards so the
            glucose reading stays top-of-fold. */}
        <Pressable
          onPress={() => router.push("/chat")}
          accessibilityRole="button"
          accessibilityLabel={t("chat.dashboardEntry")}
          className="min-h-touch flex-row items-center gap-3 rounded-2xl bg-white px-4 py-3 active:opacity-80"
        >
          <View className="h-12 w-12 items-center justify-center rounded-full bg-blue-100">
            <Icon name="chatbubbles-outline" size={24} color="#2563EB" />
          </View>
          <Text className="flex-1 text-important font-semibold text-gray-900">
            {t("chat.dashboardEntry")}
          </Text>
          <Icon name="chevron-forward" size={20} color="#6B7280" />
        </Pressable>

        <Button label={t("dashboard.logReading")} onPress={() => router.push("/(tabs)/log")} />
      </ScrollView>
    </SafeAreaView>
  );
}
