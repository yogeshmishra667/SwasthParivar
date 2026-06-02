// Cross-device sync layer for the `usePreferencesStore`. The store
// itself remains the fast-read path (AsyncStorage-backed), but on
// login + on every setter we reconcile with the server-side
// `user_preferences` row.
//
// Failure mode: any network/auth failure is swallowed. The local store
// continues to be the source of truth for the session; the next
// successful call (setter or hydrate) will reconcile.

import { api } from "@/services/api";
import { logError } from "@/services/analytics";
import type { CheckFrequency } from "@/utils/checkFrequency";
import type { Theme } from "@/stores/preferences.store";

export interface ServerPreferences {
  theme: Theme;
  largeText: boolean;
  reduceMotion: boolean;
  checkFrequency: CheckFrequency;
  notificationsEnabled: boolean;
  reminderTime: string | null;
}

interface Envelope<T> {
  success: boolean;
  data: T;
}

/**
 * Fetch the canonical preferences row for the authenticated user.
 * Returns `null` on any failure so callers fall back to whatever the
 * local store already holds.
 */
export const fetchPreferences = async (): Promise<ServerPreferences | null> => {
  try {
    const res = await api.get<Envelope<ServerPreferences>>("/users/me/preferences");
    return res.data;
  } catch (err) {
    logError("preferences.fetch", err);
    return null;
  }
};

/**
 * Send a partial preferences update. Sent fields only — anything
 * omitted is unchanged on the server. Best-effort: failures are
 * swallowed (the local store already updated).
 */
export const pushPreferences = async (patch: Partial<ServerPreferences>): Promise<void> => {
  try {
    await api.put<Envelope<ServerPreferences>>("/users/me/preferences", patch);
  } catch (err) {
    logError("preferences.push", err);
  }
};
