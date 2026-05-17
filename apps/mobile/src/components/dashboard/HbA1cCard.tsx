// Phase 2 — HbA1c estimate card. ALWAYS renders on the dashboard, but
// presents one of four states depending on user-stage + data:
//   1. Locked (user-stage < 14 days)     → progress bar + "available
//      after day 14" copy.
//   2. Loading                            → small placeholder.
//   3. Insufficient data / server error   → "30+ readings required" copy
//      (the user doesn't need to distinguish those two).
//   4. Estimate available                 → percentage + lab-confirm tag.
//
// Why always render: invisible features confuse users. A locked card
// with a clear unlock condition is dramatically better than nothing.

import { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { getHbA1cEstimate, type HbA1cResult } from "@/services/health";

const UNLOCK_DAY = 14;

interface HbA1cCardProps {
  /**
   * Days since onboarding. The locked state shows progress toward
   * day 14; once unlocked the card fetches and displays the estimate.
   */
  userStageDays: number;
}

export const HbA1cCard = ({ userStageDays }: HbA1cCardProps): JSX.Element => {
  const { t } = useTranslation();
  const unlocked = userStageDays >= UNLOCK_DAY;
  const [result, setResult] = useState<HbA1cResult | "loading">("loading");

  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;
    void (async () => {
      const r = await getHbA1cEstimate();
      if (!cancelled) setResult(r);
    })();
    return () => {
      cancelled = true;
    };
  }, [unlocked]);

  // ── 1. Locked ──────────────────────────────────────────────
  if (!unlocked) {
    const pct = Math.min(100, (userStageDays / UNLOCK_DAY) * 100);
    return (
      <Card className="border border-celebration/30 bg-violet-50">
        <View className="flex-row items-center gap-2">
          <Icon name="lock-closed-outline" size={18} color="#8B5CF6" />
          <Text className="text-body text-neutral">{t("hba1c.title")}</Text>
        </View>
        <Text className="mt-2 text-important text-gray-900">
          {t("insights.lockedTitle", { stage: userStageDays })}
        </Text>
        <Text className="mt-1 text-body text-neutral">
          {t("insights.lockedBody", { stage: userStageDays })}
        </Text>
        <View className="mt-3 h-2 overflow-hidden rounded-full bg-white">
          <View className="h-full rounded-full bg-celebration" style={{ width: `${pct}%` }} />
        </View>
      </Card>
    );
  }

  // ── 2. Loading ────────────────────────────────────────────
  if (result === "loading") {
    return (
      <Card>
        <View className="flex-row items-center gap-2">
          <Icon name="flask-outline" size={18} color="#6B7280" />
          <Text className="text-body text-neutral">{t("hba1c.title")}</Text>
        </View>
        <Text className="mt-2 text-body text-neutral">{t("common.loading")}</Text>
      </Card>
    );
  }

  // ── 3. Insufficient data / server error ───────────────────
  if (result.kind === "insufficient" || result.kind === "error") {
    return (
      <Card>
        <View className="flex-row items-center gap-2">
          <Icon name="flask-outline" size={18} color="#6B7280" />
          <Text className="text-body text-neutral">{t("hba1c.title")}</Text>
        </View>
        <Text className="mt-2 text-body text-neutral">{t("hba1c.insufficient")}</Text>
      </Card>
    );
  }

  // ── 4. Estimate available ─────────────────────────────────
  const { estimate, readingCount } = result.estimate;
  return (
    <Card>
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <Icon name="flask-outline" size={18} color="#2563EB" />
          <Text className="text-body text-neutral">{t("hba1c.title")}</Text>
        </View>
        <View className="rounded-full bg-amber-100 px-2 py-0.5">
          <Text className="text-body text-amber-900">{t("hba1c.estimateTag")}</Text>
        </View>
      </View>
      <Text className="mt-2 text-5xl font-bold tracking-tight text-gray-900">
        {t("hba1c.estimate", { value: estimate.toFixed(1) })}
      </Text>
      <Text className="mt-1 text-body text-neutral">{t("hba1c.asOf")}</Text>
      <Text className="mt-1 text-body text-neutral">
        {t("dashboard.todayReadings")}: {readingCount}
      </Text>
      <Text className="mt-2 text-body text-amber-900">{t("hba1c.learnMore")}</Text>
    </Card>
  );
};
