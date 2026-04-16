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
      fontSize: {
        body: "14px",
        important: "16px",
        number: "24px",
        hero: "36px",
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
