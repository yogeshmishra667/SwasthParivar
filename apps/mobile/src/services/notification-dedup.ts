import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "@swasth/seen_notification_ids";
const MAX_ENTRIES = 100;

let seen: string[] | null = null;
let hydrating: Promise<void> | null = null;

const hydrate = async (): Promise<void> => {
  if (seen) return;
  if (hydrating) return hydrating;
  hydrating = (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      seen = raw ? (JSON.parse(raw) as string[]).slice(-MAX_ENTRIES) : [];
    } catch {
      seen = [];
    }
  })();
  return hydrating;
};

const persist = (): void => {
  if (!seen) return;
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(seen)).catch(() => {});
};

/**
 * Returns true if this id was newly recorded (caller should show notification).
 * Returns false if already seen (caller should suppress — duplicate from another device).
 */
export const markNotificationSeen = async (id: string | undefined): Promise<boolean> => {
  if (!id) return true; // no id → can't dedup, allow display
  await hydrate();
  if (!seen) return true;
  if (seen.includes(id)) return false;
  seen.push(id);
  if (seen.length > MAX_ENTRIES) seen = seen.slice(-MAX_ENTRIES);
  persist();
  return true;
};
