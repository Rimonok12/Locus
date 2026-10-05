import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        canvas: "var(--canvas)",
        surface: "var(--surface)",
        raised: "var(--raised)",
        line: "var(--line)",
        ink: "var(--ink)",
        dim: "var(--dim)",
        faint: "var(--faint)",
        accent: "var(--accent)",
        "accent-ink": "var(--accent-ink)",
        wash: "var(--wash)"
      },
      fontSize: {
        xxs: ["0.6875rem", "1rem"]
      },
      boxShadow: {
        pop: "0 8px 30px rgba(17,45,78,0.16), 0 2px 8px rgba(17,45,78,0.08)",
        panel: "-12px 0 32px rgba(17,45,78,0.10)"
      }
    }
  },
  plugins: []
};
export default config;
