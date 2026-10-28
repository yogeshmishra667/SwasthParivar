import { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/Icon";
import { useSyncStore } from "@/stores/sync.store";

/**
 * Tiny inline badge that surfaces sync state to the user.
 *
 *   pending > 0           → "N locally saved" — glucose + other logs (amber)
 *   phase === "draining"  → "↻ Sync ho raha hai"
 *   recent sync (<3s)     → "☁️ Synced"                 (success green)
 *   otherwise             → null (avoids visual noise when nothing's happening)
 */
const SYNCED_VISIBLE_MS = 3000;

export const SyncStatusBadge = (): JSX.Element | null => {
  const { t } = useTranslation();
  const phase = useSyncStore((s) => s.phase);
  // Glucose readings plus the other logs (BP, cardiac, respiratory, meals).
  const pendingCount = useSyncStore((s) => s.pendingCount + s.outboxCount);
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt);
  const [showSynced, setShowSynced] = useState(false);

  useEffect(() => {
    if (phase !== "synced" || lastSyncedAt === null) return;
    setShowSynced(true);
    const t = setTimeout(() => setShowSynced(false), SYNCED_VISIBLE_MS);
    return () => clearTimeout(t);
  }, [phase, lastSyncedAt]);

  if (pendingCount > 0) {
    return (
      <View
        accessible
        accessibilityRole="text"
        accessibilityLabel={t("sync.pendingA11y", { count: pendingCount })}
        className="flex-row items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1"
      >
        <Icon name="cloud-offline" size={14} color="#92400E" />
        <Text className="text-body text-amber-900">
          {t("sync.pending", { count: pendingCount })}
        </Text>
      </View>
    );
  }

  if (phase === "draining") {
    return (
      <View
        accessible
        accessibilityRole="text"
        accessibilityLabel={t("sync.draining")}
        className="flex-row items-center gap-1.5 rounded-full bg-blue-100 px-2.5 py-1"
      >
        <Icon name="sync" size={14} color="#1E40AF" />
        <Text className="text-body text-blue-900">{t("sync.draining")}</Text>
      </View>
    );
  }

  if (showSynced) {
    return (
      <View
        accessible
        accessibilityRole="text"
        accessibilityLabel={t("common.synced")}
        className="flex-row items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1"
      >
        <Icon name="cloud-done" size={14} color="#166534" />
        <Text className="text-body text-green-900">{t("common.synced")}</Text>
      </View>
    );
  }

  return null;
};
