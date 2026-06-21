import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "Inter", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "Georgia", "serif"],
      },
      colors: {
        ink:      "#161616",
        paper:    "#f5f3ee",
        rule:     "#d8d0c2",
        cobalt:   "#1a3a7a",
        signal:   "#f6c445",
        mint:     "#4fbf87",
        coral:    "#e45c3a",
        midnight: "#0d1117",
        accent:   "#c8102e",
      }
    },
  },
  plugins: [],
};

export default config;
