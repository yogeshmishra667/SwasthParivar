import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { i18n } from "@/i18n/config";
import type { CheckFrequency } from "@/utils/checkFrequency";
import { syncCheckReminders } from "@/services/check-reminders";
import { fetchPreferences, pushPreferences } from "@/services/preferences";

export type Language = "hi" | "en";
export type Theme = "light" | "dark" | "system" | "high-contrast";

interface PreferencesState {
  language: Language;
  theme: Theme;
  largeText: boolean;
  reduceMotion: boolean;
  hydrated: boolean;
  checkFrequency: CheckFrequency;
  notificationsEnabled: boolean;
  reminderTime: string | null;
  pushTokenStatus: string | null;
  setLanguage: (lang: Language) => void;
  setTheme: (theme: Theme) => void;
  setLargeText: (on: boolean) => void;
  setReduceMotion: (on: boolean) => void;
  setCheckFrequency: (freq: CheckFrequency) => void;
  setNotificationsEnabled: (on: boolean) => void;
  setReminderTime: (time: string | null) => void;
  setPushTokenStatus: (status: string | null) => void;
  /**
   * Pull canonical preferences from the server and reconcile (server
   * wins). Called once after auth lands. Safe no-op on failure — the
   * AsyncStorage copy keeps serving as the local source of truth.
   */
  hydrateFromServer: () => Promise<void>;
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set, get) => ({
      language: "hi",
      theme: "system",
      largeText: false,
      reduceMotion: false,
      hydrated: false,
      checkFrequency: "daily",
      notificationsEnabled: true,
      reminderTime: "07:00",
      pushTokenStatus: null,
      setLanguage: (language) => {
        set({ language });
        void i18n.changeLanguage(language);
      },
      setTheme: (theme) => {
        set({ theme });
        void pushPreferences({ theme });
      },
      setLargeText: (largeText) => {
        set({ largeText });
        void pushPreferences({ largeText });
      },
      setReduceMotion: (reduceMotion) => {
        set({ reduceMotion });
        void pushPreferences({ reduceMotion });
      },
      // The three setters below also resync the local glucose-check
      // reminder schedule. Reading current state via `get()` keeps the
      // schedule consistent when only one preference changes at a
      // time, while still picking up any concurrent edits.
      setCheckFrequency: (checkFrequency) => {
        set({ checkFrequency });
        const { notificationsEnabled, reminderTime } = get();
        void syncCheckReminders({
          enabled: notificationsEnabled,
          frequency: checkFrequency,
          reminderTime,
        });
        void pushPreferences({ checkFrequency });
      },
      setNotificationsEnabled: (notificationsEnabled) => {
        set({ notificationsEnabled });
        const { checkFrequency, reminderTime } = get();
        void syncCheckReminders({
          enabled: notificationsEnabled,
          frequency: checkFrequency,
          reminderTime,
        });
        void pushPreferences({ notificationsEnabled });
      },
      setReminderTime: (reminderTime) => {
        set({ reminderTime });
        const { notificationsEnabled, checkFrequency } = get();
        void syncCheckReminders({
          enabled: notificationsEnabled,
          frequency: checkFrequency,
          reminderTime,
        });
        void pushPreferences({ reminderTime });
      },
      setPushTokenStatus: (pushTokenStatus) => set({ pushTokenStatus }),
      hydrateFromServer: async () => {
        const server = await fetchPreferences();
        if (server === null) return;
        const local = get();
        // Server wins for cross-device consistency. Skip the write if
        // every field already matches so we don't re-trigger reminder
        // resync needlessly.
        const changed =
          server.theme !== local.theme ||
          server.largeText !== local.largeText ||
          server.reduceMotion !== local.reduceMotion ||
          server.checkFrequency !== local.checkFrequency ||
          server.notificationsEnabled !== local.notificationsEnabled ||
          server.reminderTime !== local.reminderTime;
        if (!changed) return;
        set({
          theme: server.theme,
          largeText: server.largeText,
          reduceMotion: server.reduceMotion,
          checkFrequency: server.checkFrequency,
          notificationsEnabled: server.notificationsEnabled,
          reminderTime: server.reminderTime,
        });
        // Local reminder schedule was tied to the previous values —
        // resync to match the new (server-canonical) ones.
        void syncCheckReminders({
          enabled: server.notificationsEnabled,
          frequency: server.checkFrequency,
          reminderTime: server.reminderTime,
        });
      },
    }),
    {
      name: "swasth.preferences",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        language: state.language,
        theme: state.theme,
        largeText: state.largeText,
        reduceMotion: state.reduceMotion,
        checkFrequency: state.checkFrequency,
        notificationsEnabled: state.notificationsEnabled,
        reminderTime: state.reminderTime,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.hydrated = true;
          // Apply the persisted language to i18n so a cold-start after
          // the user chose English doesn't fall back to device locale.
          void i18n.changeLanguage(state.language);
          // Resync local glucose-check reminders on every cold start —
          // catches reinstalls and refills the biweekly DATE-trigger
          // queue before the pre-stocked instances run out.
          void syncCheckReminders({
            enabled: state.notificationsEnabled,
            frequency: state.checkFrequency,
            reminderTime: state.reminderTime,
          });
        }
      },
    },
  ),
);
