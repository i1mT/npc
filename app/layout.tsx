import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AGI Daily NPC",
  description: "Simulated AGI Daily newsroom and operations dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
