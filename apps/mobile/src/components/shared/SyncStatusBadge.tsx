import { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { Icon } from "@/components/ui/Icon";
import { useSyncStore } from "@/stores/sync.store";

/**
 * Tiny inline badge that surfaces sync state to the user.
 *
 *   pending > 0           → "💾 N saved locally"        (warning amber)
 *   phase === "draining"  → "↻ Sync ho raha hai"
 *   recent sync (<3s)     → "☁️ Synced"                 (success green)
 *   otherwise             → null (avoids visual noise when nothing's happening)
 */
const SYNCED_VISIBLE_MS = 3000;

export const SyncStatusBadge = (): JSX.Element | null => {
  const phase = useSyncStore((s) => s.phase);
  const pendingCount = useSyncStore((s) => s.pendingCount);
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
        accessibilityRole="text"
        accessibilityLabel={`${pendingCount} reading${pendingCount === 1 ? "" : "s"} saved locally, sync pending`}
        className="flex-row items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1"
      >
        <Icon name="cloud-offline" size={14} color="#92400E" />
        <Text className="text-body text-amber-900">
          {pendingCount} locally saved
        </Text>
      </View>
    );
  }

  if (phase === "draining") {
    return (
      <View
        accessibilityRole="text"
        accessibilityLabel="Syncing"
        className="flex-row items-center gap-1.5 rounded-full bg-blue-100 px-2.5 py-1"
      >
        <Icon name="sync" size={14} color="#1E40AF" />
        <Text className="text-body text-blue-900">Sync ho raha hai...</Text>
      </View>
    );
  }

  if (showSynced) {
    return (
      <View
        accessibilityRole="text"
        accessibilityLabel="Synced"
        className="flex-row items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1"
      >
        <Icon name="cloud-done" size={14} color="#166534" />
        <Text className="text-body text-green-900">Synced</Text>
      </View>
    );
  }

  return null;
};
