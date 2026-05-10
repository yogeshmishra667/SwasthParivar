import AsyncStorage from "@react-native-async-storage/async-storage";
import { logError } from "@/services/analytics";

/**
 * Persisted dashboard cache.
 *
 * CLAUDE.md "Offline" rule: WatermelonDB local-first, sync silently
 * when connected. CLAUDE.md fail-safe rule: "Dashboard load fails →
 * Last cached dashboard + 'Purana data dikh raha hai'. Never empty
 * screen."
 *
 * The dashboard summary (streak, last reading, today count) is a
 * server-computed projection over `glucose_readings` + `user_streaks`
 * + `medication_schedules`. We could rebuild it from local Watermelon
 * data, but PR #2 only ships the WRITE side of sync — pulling all
 * server rows down isn't there yet. Cache-aside on AsyncStorage is
 * sufficient for "never empty screen" and survives app kills.
 *
 * Key shape: `swasth.dashboardCache.v1`. Bump the suffix on
 * incompatible schema changes.
 */

export interface CachedDashboard {
  streak: { currentStreakDays: number };
  latestReading: { valueMgDl: number; readingType: string; measuredAt: string } | null;
  todayReadingCount: number;
  medications: { id: string; medicineName: string }[];
  /** ISO timestamp of the last successful API fetch. */
  fetchedAt: string;
}

const KEY = "swasth.dashboardCache.v1";

export const loadDashboardCache = async (): Promise<CachedDashboard | null> => {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw === null) return null;
    return JSON.parse(raw) as CachedDashboard;
  } catch (err) {
    logError("dashboard-cache.load", err);
    return null;
  }
};

export const saveDashboardCache = async (cache: CachedDashboard): Promise<void> => {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(cache));
  } catch (err) {
    logError("dashboard-cache.save", err);
  }
};

export const clearDashboardCache = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch (err) {
    logError("dashboard-cache.clear", err);
  }
};

/**
 * Days between today and the latest reading's `measuredAt`. Returns
 * Infinity when there's no reading yet.
 *
 * Used by the welcome-back banner: ≥ 3 days inactivity → show.
 * Mirrors the server's re-engagement worker thresholds (PR #7) so
 * the user sees consistent messaging across in-app banner + push.
 */
export const daysSinceLatestReading = (cache: CachedDashboard | null): number => {
  if (!cache?.latestReading) return Infinity;
  const lastMs = new Date(cache.latestReading.measuredAt).getTime();
  if (Number.isNaN(lastMs)) return Infinity;
  const today = new Date();
  const todayMidnightMs = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  const lastDate = new Date(lastMs);
  const lastMidnightMs = Date.UTC(
    lastDate.getUTCFullYear(),
    lastDate.getUTCMonth(),
    lastDate.getUTCDate(),
  );
  return Math.max(0, Math.floor((todayMidnightMs - lastMidnightMs) / 86_400_000));
};
