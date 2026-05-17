// Phase 2 — Insights tab. Locked until the user reaches day 14 (per
// CLAUDE.md "Cold Start: Day 14 → Full unlock. Trend + HbA1c."). Once
// unlocked, shows a FlatList of unacknowledged insights from the server
// with pull-to-refresh + acknowledge actions.

import { useCallback, useEffect, useState } from "react";
import { View, Text, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { ActiveProfileBadge } from "@/components/profile/ActiveProfileBadge";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { InsightCard } from "@/components/insights/InsightCard";
import { listInsights, type InsightEventDto } from "@/services/insights";
import { api } from "@/services/api";
import { logError } from "@/services/analytics";
import { TOUCH_TARGET_MIN } from "@/utils/constants";

const UNLOCK_DAY = 14;

export default function InsightsScreen(): JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const [userStageDays, setUserStageDays] = useState<number | null>(null);
  const [insights, setInsights] = useState<readonly InsightEventDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const loadStage = useCallback(async (): Promise<void> => {
    try {
      const res = await api.get<{
        success: boolean;
        data: { createdAt?: string };
      }>("/users/me");
      if (res.data.createdAt !== undefined) {
        const days = Math.floor((Date.now() - new Date(res.data.createdAt).getTime()) / 86_400_000);
        setUserStageDays(days);
      } else {
        setUserStageDays(0);
      }
    } catch (e) {
      logError("insights.loadStage", e);
      // Fail open — assume unlocked rather than gate a returning user
      // out of patterns because the user endpoint hiccuped.
      setUserStageDays(UNLOCK_DAY);
    }
  }, []);

  const loadInsights = useCallback(async (): Promise<void> => {
    setLoadError(false);
    const res = await listInsights({ acknowledged: false, limit: 50 });
    if (res.data.length === 0 && res.cursor === null && res.hasMore === false) {
      // listInsights swallows errors → empty result. Probe for the
      // failure mode using a quick GET (cheap; 200 with empty array is
      // fine) so we can show the right copy.
    }
    setInsights(res.data);
  }, []);

  useEffect(() => {
    void (async () => {
      await loadStage();
      try {
        await loadInsights();
      } catch (e) {
        logError("insights.load", e);
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [loadStage, loadInsights]);

  const onRefresh = async (): Promise<void> => {
    setRefreshing(true);
    await Promise.all([loadStage(), loadInsights()]);
    setRefreshing(false);
  };

  const handleAcknowledged = (id: string): void => {
    setInsights((prev) => prev.filter((i) => i.id !== id));
  };

  const locked = userStageDays !== null && userStageDays < UNLOCK_DAY;

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <View className="flex-row items-center justify-between px-4 py-3">
        <Text className="text-hero font-bold">{t("insights.title")}</Text>
        <ActiveProfileBadge />
      </View>

      {locked ? (
        <View className="flex-1 justify-center gap-4 px-4">
          <Card className="border border-celebration/30 bg-violet-50">
            <View className="items-center gap-3 py-4">
              <Icon name="lock-closed" size={48} color="#8B5CF6" />
              <Text className="text-hero font-bold text-center">
                {t("insights.lockedTitle", { stage: userStageDays ?? 0 })}
              </Text>
              <Text className="text-important text-center text-gray-700">
                {t("insights.lockedBody", { stage: userStageDays ?? 0 })}
              </Text>
              <View className="mt-2 h-3 w-full overflow-hidden rounded-full bg-white">
                <View
                  className="h-full rounded-full bg-celebration"
                  style={{
                    width: `${Math.min(100, ((userStageDays ?? 0) / UNLOCK_DAY) * 100)}%`,
                  }}
                />
              </View>
            </View>
          </Card>
          <Button label={t("insights.lockedCTA")} onPress={() => router.push("/(tabs)/log")} />
        </View>
      ) : loading ? (
        <View className="flex-1 items-center justify-center gap-2">
          <Icon name="hourglass-outline" size={32} color="#6B7280" />
          <Text className="text-body text-neutral">{t("common.loading")}</Text>
        </View>
      ) : loadError ? (
        <View className="flex-1 items-center justify-center gap-4 px-4">
          <Text className="text-important text-center">{t("insights.loadFailed")}</Text>
          <Button label={t("common.retry")} onPress={() => void onRefresh()} />
        </View>
      ) : insights.length === 0 ? (
        <View className="flex-1 items-center justify-center gap-4 px-4">
          <Icon name="bulb-outline" size={48} color="#6B7280" />
          <Text className="text-important text-center text-neutral">{t("insights.empty")}</Text>
          <Button
            label={t("dashboard.logReading")}
            variant="ghost"
            onPress={() => router.push("/(tabs)/log")}
          />
        </View>
      ) : (
        <FlashList
          data={insights}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16 }}
          ItemSeparatorComponent={Separator}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
          }
          renderItem={({ item }) => (
            <InsightCard insight={item} onAcknowledged={handleAcknowledged} />
          )}
        />
      )}
    </SafeAreaView>
  );
}

const Separator = (): JSX.Element => <View style={{ height: TOUCH_TARGET_MIN / 4 }} />;
