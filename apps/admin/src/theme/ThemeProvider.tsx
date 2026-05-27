import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  /** What's actually applied right now (resolves `system` against the OS). */
  resolved: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "admin.theme";

const readStored = (): Theme => {
  if (typeof window === "undefined") return "system";
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
};

const computeResolved = (theme: Theme): ResolvedTheme => {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

interface ThemeProviderProps {
  children: ReactNode;
}

/**
 * Owns the `theme` selection (light/dark/system) and applies it by
 * toggling `.dark` on <html>. Persists to localStorage; reacts to OS
 * theme changes when `theme === "system"`.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(readStored);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => computeResolved(theme));

  const setTheme = useCallback((next: Theme): void => {
    setThemeState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  // Apply the class whenever the resolved theme changes.
  useEffect(() => {
    const next = computeResolved(theme);
    setResolved(next);
    document.documentElement.classList.toggle("dark", next === "dark");
  }, [theme]);

  // Track OS theme when in `system` mode.
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (): void => {
      setResolved(mq.matches ? "dark" : "light");
    };
    mq.addEventListener("change", handler);
    return (): void => {
      mq.removeEventListener("change", handler);
    };
  }, [theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolved, setTheme }),
    [theme, resolved, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme() must be used inside <ThemeProvider>");
  return ctx;
}
