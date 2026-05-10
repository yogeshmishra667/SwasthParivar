/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        primary: "#2563EB",
        success: "#16A34A",
        warning: "#D97706",
        critical: "#DC2626",
        celebration: "#8B5CF6",
        streak: "#F59E0B",
        neutral: "#6B7280",
      },
      // Font sizes resolve from CSS variables set on the root via `vars()`.
      // The `<FontScaleProvider>` in app/_layout.tsx supplies values for the
      // current scale (normal vs largeText). Defaults are the normal-mode sizes.
      fontSize: {
        body: "var(--fs-body, 14px)",
        important: "var(--fs-important, 16px)",
        number: "var(--fs-number, 24px)",
        hero: "var(--fs-hero, 36px)",
      },
      minHeight: {
        touch: "48px",
      },
      minWidth: {
        touch: "48px",
      },
    },
  },
  plugins: [],
};
