import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { i18n } from "@/i18n/config";
import type { CheckFrequency } from "@/utils/checkFrequency";

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
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
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
      setTheme: (theme) => set({ theme }),
      setLargeText: (largeText) => set({ largeText }),
      setReduceMotion: (reduceMotion) => set({ reduceMotion }),
      setCheckFrequency: (checkFrequency) => set({ checkFrequency }),
      setNotificationsEnabled: (notificationsEnabled) => set({ notificationsEnabled }),
      setReminderTime: (reminderTime) => set({ reminderTime }),
      setPushTokenStatus: (pushTokenStatus) => set({ pushTokenStatus }),
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
        }
      },
    },
  ),
);
