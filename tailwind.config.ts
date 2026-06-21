import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans:  ["var(--font-sans)", "Inter", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "Georgia", "serif"],
      },
      colors: {
        ink:      "#131313",
        paper:    "#F6F5F1",
        rule:     "#E0DDD6",
        caption:  "#8C8881",
        cobalt:   "#1a3a7a",
        signal:   "#f6c445",
        mint:     "#4fbf87",
        coral:    "#e45c3a",
        midnight: "#0d1117",
        accent:   "#C41230",
      },
    },
  },
  plugins: [],
};

export default config;
