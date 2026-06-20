import { Suspense } from "react";
import { listDays } from "@/db/sim";
import { SimControlBar, DaySwitcher, DashSidebar } from "@/components/dash-nav";

export const dynamic = "force-dynamic";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const days = listDays().map(d => ({ day: d.day, isBoardDay: d.isBoardDay }));

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#f2f1ee] text-ink">
      {/* ── Global header ── */}
      <header className="shrink-0 flex items-center justify-between gap-4 border-b border-ink bg-ink px-4 py-2 text-paper">
        <div className="flex items-center gap-3">
          <a href="/dashboard" className="text-xs font-black uppercase tracking-[0.3em] text-signal hover:opacity-80">
            AGI DAILY NPC
          </a>
          <span className="text-paper/20">|</span>
          <a href="/" target="_blank" className="text-xs text-paper/40 hover:text-paper/70">前台 →</a>
        </div>

        <div className="flex items-center gap-4">
          <Suspense>
            <SimControlBar />
          </Suspense>
          <div className="h-4 w-px bg-paper/15" />
          <Suspense>
            <DaySwitcher days={days} />
          </Suspense>
        </div>
      </header>

      {/* ── Body: sidebar + content ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        <aside className="w-44 shrink-0 overflow-y-auto border-r border-rule bg-[#eceae6]">
          <Suspense>
            <DashSidebar />
          </Suspense>
        </aside>

        {/* Main content — individual pages manage their own scroll */}
        <main className="flex-1 overflow-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
