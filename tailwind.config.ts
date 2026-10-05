import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        canvas: "var(--canvas)",
        sidebar: "var(--sidebar)",
        surface: "var(--surface)",
        raised: "var(--raised)",
        line: "var(--line)",
        "line-strong": "var(--line-strong)",
        ink: "var(--ink)",
        dim: "var(--dim)",
        faint: "var(--faint)",
        accent: "var(--accent)",
        "accent-hover": "var(--accent-hover)",
        "accent-ink": "var(--accent-ink)",
        "accent-soft": "var(--accent-soft)",
        wash: "var(--wash)",
        danger: "var(--danger)",
        success: "var(--success)",
        warning: "var(--warning)",
      },
      fontSize: {
        xxs: ["11px", "16px"],
        xs2: ["12px", "16px"],
        sm2: ["13px", "20px"],
      },
      boxShadow: {
        pop: "0 0 0 1px var(--line), 0 4px 12px hsl(var(--shadow-color) / 0.08), 0 16px 40px hsl(var(--shadow-color) / 0.12)",
        modal: "0 0 0 1px var(--line), 0 24px 64px hsl(var(--shadow-color) / 0.28)",
        card: "0 1px 2px hsl(var(--shadow-color) / 0.06)",
        panel: "-8px 0 32px hsl(var(--shadow-color) / 0.10)",
      },
    },
  },
  plugins: [],
};
export default config;
