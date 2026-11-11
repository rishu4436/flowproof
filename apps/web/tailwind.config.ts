import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "var(--ink)",
        elevated: "var(--elevated)",
        card: "var(--card)",
        line: "var(--line)",
        porcelain: "var(--porcelain)",
        cloud: "var(--cloud)",
        teal: "var(--teal)",
        mint: "var(--mint)",
        amber: "var(--amber)",
        coral: "var(--coral)",
        slate: "var(--slate)",
        text: "var(--text)",
        muted: "var(--muted)",
      },
      fontFamily: {
        sans: ["var(--font-geist)", "Segoe UI", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        panel: "0 1px 0 rgba(13,20,24,0.04), 0 16px 40px rgba(13,20,24,0.06)",
      },
    },
  },
  plugins: [],
};

export default config;
