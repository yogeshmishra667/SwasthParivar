import { create } from "zustand";

/**
 * Tiny in-memory store for surfacing sync state to the UI.
 * Written and cleared by the readings service + sync drain hook.
 *
 * Not persisted — restarting the app revisits Watermelon to count
 * pending rows accurately on boot.
 */
export type SyncPhase = "idle" | "draining" | "synced" | "error";

interface SyncState {
  pendingCount: number;
  phase: SyncPhase;
  lastSyncedAt: number | null;
  lastError: string | null;
  setPendingCount: (n: number) => void;
  setPhase: (phase: SyncPhase, error?: string | null) => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  pendingCount: 0,
  phase: "idle",
  lastSyncedAt: null,
  lastError: null,
  setPendingCount: (pendingCount) => set({ pendingCount }),
  setPhase: (phase, error = null) =>
    set((s) => ({
      phase,
      lastError: phase === "error" ? error : null,
      lastSyncedAt: phase === "synced" ? Date.now() : s.lastSyncedAt,
    })),
}));
