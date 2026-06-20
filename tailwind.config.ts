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
        ink: "#161616",
        paper: "#f7f3ea",
        rule: "#d8d0c2",
        cobalt: "#254edb",
        signal: "#f6c445",
        mint: "#4fbf87",
        coral: "#e45c3a"
      }
    },
  },
  plugins: [],
};

export default config;
