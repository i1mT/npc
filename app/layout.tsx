import "./globals.css";
import type { Metadata } from "next";
import { Playfair_Display, Source_Sans_3 } from "next/font/google";

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});

const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AGI Daily",
  description: "AI 行业深度资讯 · 由 Agent 团队驱动",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={`${playfair.variable} ${sourceSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
