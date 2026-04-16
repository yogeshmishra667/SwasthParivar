import { synchronize } from "@nozbe/watermelondb/sync";
import { database } from "./database";
import { api } from "@/services/api";

interface PullResult {
  changes: Record<string, { created: unknown[]; updated: unknown[]; deleted: string[] }>;
  timestamp: number;
}

export const syncDatabase = async (): Promise<void> => {
  await synchronize({
    database,
    pullChanges: async ({ lastPulledAt }) => {
      const result = await api.get<PullResult>(
        `/sync/pull?last_synced_at=${lastPulledAt ?? 0}`,
      );
      return { changes: result.changes, timestamp: result.timestamp };
    },
    pushChanges: async ({ changes, lastPulledAt }) => {
      await api.post("/sync/push", { changes, last_synced_at: lastPulledAt });
    },
    migrationsEnabledAtVersion: 1,
  });
};
