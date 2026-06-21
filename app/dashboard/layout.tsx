import { Suspense } from "react";
import type { Metadata } from "next";
import { listDays } from "@/db/sim";
import { BrandLogo } from "@/components/brand/brand-logo";
import { SimControlBar, DaySwitcher, DashSidebar } from "@/components/dash-nav";
import { SITE_NAME } from "@/lib/brand";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    default: "运营控制台",
    template: `%s | ${SITE_NAME} 运营控制台`,
  },
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const days = (await listDays()).map(d => ({ day: d.day, isBoardDay: d.isBoardDay }));

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-paper text-ink">
      {/* ── Global header ── */}
      <header className="shrink-0 flex items-center justify-between gap-4 border-b border-ink bg-ink px-5 py-2.5 text-paper">
        <div className="flex items-center gap-4">
          <BrandLogo
            href="/dashboard"
            imageClassName="h-7 w-7 rounded-sm"
            textClassName="font-serif text-base text-paper/80 tracking-tight"
            className="hover:text-paper transition-colors"
          />
          <span className="text-paper/15 text-sm">|</span>
          <a
            href="/"
            target="_blank"
            className="text-[9px] font-bold uppercase tracking-[0.3em] text-paper/25 hover:text-paper/55 transition-colors"
          >
            前台 →
          </a>
        </div>

        <div className="flex items-center gap-5">
          <Suspense>
            <SimControlBar />
          </Suspense>
          <div className="h-3 w-px bg-paper/10" />
          <Suspense>
            <DaySwitcher days={days} />
          </Suspense>
        </div>
      </header>

      {/* ── Body: sidebar + content ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        <aside className="w-44 shrink-0 overflow-y-auto border-r border-rule bg-paper">
          <Suspense>
            <DashSidebar />
          </Suspense>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-hidden bg-[#EEEDE9]">
          {children}
        </main>
      </div>
    </div>
  );
}
