import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

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
      setLanguage: (language) => set({ language }),
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
        if (state) state.hydrated = true;
      },
    },
  ),
);
