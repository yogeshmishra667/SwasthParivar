import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Tracks festive-tag usage on the device for the rolling 7-day cap.
 *
 * `CLAUDE.md` Festive Tag rules:
 *   - MAX 2 per week per user
 *   - Stored as GlucoseReading.context: "festive"
 *   - When ON: feedback engine flips gentle_warn → festiveSkip copy
 *
 * The cap is enforced *client-side* — the server happily accepts any
 * `context: "festive"` reading, and the cap is a UX concession (don't
 * let users mark every reading festive). Persisted via AsyncStorage so
 * the count survives app restarts within the week.
 */

interface Use {
  /** ISO timestamp at which the festive tag was applied. */
  at: string;
}

interface FestiveState {
  uses: Use[];
  hydrated: boolean;
  recordUse: () => void;
  /** Current count of uses inside the trailing 7-day window. */
  recentUses: () => number;
  /** Whether the user can still tag a reading festive. */
  canUseFestive: () => boolean;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PER_WEEK = 2;

const pruneOld = (uses: Use[], nowMs: number): Use[] =>
  uses.filter((u) => nowMs - new Date(u.at).getTime() < WEEK_MS);

export const useFestiveStore = create<FestiveState>()(
  persist(
    (set, get) => ({
      uses: [],
      hydrated: false,
      recordUse: () => {
        const nowMs = Date.now();
        set((s) => ({ uses: [...pruneOld(s.uses, nowMs), { at: new Date(nowMs).toISOString() }] }));
      },
      recentUses: () => pruneOld(get().uses, Date.now()).length,
      canUseFestive: () => pruneOld(get().uses, Date.now()).length < MAX_PER_WEEK,
    }),
    {
      name: "swasth.festive",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ uses: state.uses }),
      onRehydrateStorage: () => (state) => {
        if (state) state.hydrated = true;
      },
    },
  ),
);

export const FESTIVE_MAX_PER_WEEK = MAX_PER_WEEK;
