import { create } from "zustand";

export type Language = "hi" | "en";
export type Theme = "light" | "dark" | "high-contrast";

interface PreferencesState {
  language: Language;
  theme: Theme;
  largeText: boolean;
  reduceMotion: boolean;
  setLanguage: (lang: Language) => void;
  setTheme: (theme: Theme) => void;
  setLargeText: (on: boolean) => void;
  setReduceMotion: (on: boolean) => void;
}

export const usePreferencesStore = create<PreferencesState>((set) => ({
  language: "hi",
  theme: "light",
  largeText: false,
  reduceMotion: false,
  setLanguage: (language) => set({ language }),
  setTheme: (theme) => set({ theme }),
  setLargeText: (largeText) => set({ largeText }),
  setReduceMotion: (reduceMotion) => set({ reduceMotion }),
}));
