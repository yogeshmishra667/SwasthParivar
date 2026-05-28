import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { i18n } from "@/i18n/config";

export type Language = "hi" | "en";
export type Theme = "light" | "dark" | "high-contrast";

interface PreferencesState {
  language: Language;
  theme: Theme;
  largeText: boolean;
  reduceMotion: boolean;
  hydrated: boolean;
  setLanguage: (lang: Language) => void;
  setTheme: (theme: Theme) => void;
  setLargeText: (on: boolean) => void;
  setReduceMotion: (on: boolean) => void;
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      language: "hi",
      theme: "light",
      largeText: false,
      reduceMotion: false,
      hydrated: false,
      setLanguage: (language) => {
        set({ language });
        void i18n.changeLanguage(language);
      },
      setTheme: (theme) => set({ theme }),
      setLargeText: (largeText) => set({ largeText }),
      setReduceMotion: (reduceMotion) => set({ reduceMotion }),
    }),
    {
      name: "swasth.preferences",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        language: state.language,
        theme: state.theme,
        largeText: state.largeText,
        reduceMotion: state.reduceMotion,
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
