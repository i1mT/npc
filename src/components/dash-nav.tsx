"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart2, Bot, BookOpen, Home, LayoutGrid, Layers,
  Play, Shield, Square, Users, Zap, ChevronRight, Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { dayToShortDate } from "@/lib/dates";

// ─── Sim control bar (polls /api/sim/status) ────────────────────────────────

type SimStatus = { day: number; status: "idle" | "running" | "paused" };

export function SimControlBar() {
  const [sim, setSim]                 = useState<SimStatus | null>(null);
  const [boardPending, setBoardPending] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const poll = async () => {
      const [sr, br] = await Promise.all([
        fetch("/api/sim/status",       { cache: "no-store" }),
        fetch("/api/sim/board-meeting", { cache: "no-store" }),
      ]);
      if (sr.ok) setSim(await sr.json());
      if (br.ok) {
        const { meeting } = await br.json() as { meeting: { day: number } | null };
        setBoardPending(meeting !== null);
      }
    };
    void poll();
    const t = setInterval(poll, 3000);
    return () => clearInterval(t);
  }, []);

  const isRunning = sim?.status === "running";
  const canRun    = !isRunning && !boardPending;

  async function run(days: number) {
    if (!canRun) return;
    const nextDay = (sim?.day ?? 0) + 1;
    // Navigate first so the view is ready when events start streaming
    router.push(`/dashboard/work?day=${nextDay}`);
    await fetch("/api/sim/start", { method: "POST", body: JSON.stringify({ days }) });
    setTimeout(async () => {
      const r = await fetch("/api/sim/status", { cache: "no-store" });
      if (r.ok) setSim(await r.json());
    }, 600);
  }
  async function advance() {
    if (!canRun) return;
    const nextDay = (sim?.day ?? 0) + 1;
    router.push(`/dashboard/work?day=${nextDay}`);
    await fetch("/api/sim/advance", { method: "POST" });
  }
  async function stop() { await fetch("/api/sim/stop", { method: "POST" }); }

  return (
    <div className="flex items-center gap-2">
      <span className={cn(
        "rounded px-2 py-0.5 text-[10px] font-bold uppercase",
        isRunning           ? "bg-mint animate-pulse text-white" :
        sim?.status === "paused" ? "bg-signal text-ink" :
        boardPending        ? "bg-amber-400 text-amber-900" :
        "bg-paper/15 text-paper/50"
      )}>
        {boardPending && !isRunning ? "待决策" : (sim?.status ?? "…")}
      </span>
      {sim?.day && <span className="text-xs text-paper/40">Day {sim.day}</span>}
      <div className="flex gap-1">
        <button
          onClick={() => run(1)}
          disabled={!canRun}
          title={boardPending ? "请先完成董事会决策" : "运行 1 天"}
          className={cn(
            "flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-bold transition-opacity",
            canRun ? "bg-signal text-ink hover:bg-signal/80" : "bg-signal/30 text-ink/40 cursor-not-allowed"
          )}>
          <Play className="h-3 w-3" />1天
        </button>
        <button
          onClick={() => run(3)}
          disabled={!canRun}
          title={boardPending ? "请先完成董事会决策" : "运行 3 天"}
          className={cn(
            "flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-bold transition-opacity",
            canRun ? "bg-signal/70 text-ink hover:bg-signal/50" : "bg-signal/20 text-ink/40 cursor-not-allowed"
          )}>
          <Play className="h-3 w-3" />3天
        </button>
        <button onClick={advance} title="推进一步"
          className="rounded border border-paper/20 px-2.5 py-1 text-[11px] text-paper/70 hover:bg-paper/10">
          推进
        </button>
        <button onClick={stop} title="暂停"
          className="rounded border border-paper/20 px-2 py-1 text-paper/70 hover:bg-paper/10">
          <Square className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// ─── Global day switcher ──────────────────────────────────────────────────────

export function DaySwitcher({ days }: { days: { day: number; isBoardDay: boolean }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [runningDay, setRunningDay] = useState<number | null>(null);

  // Poll sim status to surface the currently-running day even before it completes
  useEffect(() => {
    const poll = async () => {
      const r = await fetch("/api/sim/status", { cache: "no-store" });
      if (!r.ok) return;
      const st = await r.json() as { day: number; status: string };
      setRunningDay(st.status === "running" ? st.day : null);
    };
    void poll();
    const t = setInterval(poll, 3000);
    return () => clearInterval(t);
  }, []);

  // Merge: completed days from SSR + live running day (if not already present)
  const allDays = [...days];
  if (runningDay && !allDays.find(d => d.day === runningDay)) {
    allDays.unshift({ day: runningDay, isBoardDay: false });
  }

  const currentDay = Number(searchParams.get("day") ?? allDays[0]?.day ?? 1);

  function go(day: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("day", String(day));
    router.push(`${pathname}?${params.toString()}`);
  }

  if (!allDays.length) return null;

  const idx  = allDays.findIndex(d => d.day === currentDay);
  const prev = allDays[idx + 1];
  const next = allDays[idx - 1];

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-bold uppercase tracking-wider text-paper/40">时间</span>
      <select
        value={currentDay}
        onChange={e => go(Number(e.target.value))}
        className="rounded border border-paper/20 bg-paper/10 px-2 py-0.5 text-xs text-paper/80 focus:outline-none"
      >
        {allDays.map(d => (
          <option key={d.day} value={d.day} className="bg-ink text-paper">
            {d.isBoardDay ? "★ " : ""}
            {d.day === runningDay && !days.find(c => c.day === d.day) ? "⏺ " : ""}
            {dayToShortDate(d.day)} (D{d.day})
          </option>
        ))}
      </select>
      {allDays.length > 1 && (
        <div className="flex gap-0.5">
          {prev && <button onClick={() => go(prev.day)} className="rounded px-1.5 py-0.5 text-xs text-paper/50 hover:text-paper">‹</button>}
          {next && <button onClick={() => go(next.day)} className="rounded px-1.5 py-0.5 text-xs text-paper/50 hover:text-paper">›</button>}
        </div>
      )}
    </div>
  );
}

// ─── Sidebar navigation ───────────────────────────────────────────────────────

const NAV_GROUPS = [
  {
    label: "主菜单",
    items: [
      { href: "/dashboard",        label: "总览",    Icon: Home },
      { href: "/dashboard/work",   label: "工作日志", Icon: Bot },
      { href: "/dashboard/org",    label: "组织架构", Icon: LayoutGrid },
      { href: "/dashboard/rules",  label: "规则",    Icon: Shield },
      { href: "/dashboard/hr",     label: "人才市场", Icon: Users },
      { href: "/dashboard/tools",  label: "工具目录", Icon: Wrench },
    ],
  },
  {
    label: "七层资产",
    items: [
      { href: "/dashboard/layers/mission",     label: "使命层",  Icon: BookOpen },
      { href: "/dashboard/layers/environment", label: "能力层",  Icon: Zap },
      { href: "/dashboard/layers/memory",      label: "记忆层",  Icon: Layers },
      { href: "/dashboard/layers/rules",       label: "规则层",  Icon: Shield },
      { href: "/dashboard/layers/resource",    label: "资源层",  Icon: BarChart2 },
      { href: "/dashboard/layers/growth",      label: "生长层",  Icon: ChevronRight },
    ],
  },
];

export function DashSidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const day = searchParams.get("day");

  function href(base: string) {
    return day ? `${base}?day=${day}` : base;
  }

  function isActive(base: string) {
    if (base === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(base);
  }

  return (
    <nav className="flex flex-col gap-4 p-3">
      {NAV_GROUPS.map(group => (
        <div key={group.label}>
          <p className="mb-1.5 px-2 text-[10px] font-bold uppercase tracking-[0.2em] text-ink/35">
            {group.label}
          </p>
          <div className="space-y-0.5">
            {group.items.map(({ href: h, label, Icon }) => (
              <a
                key={h}
                href={href(h)}
                className={cn(
                  "flex items-center gap-2.5 rounded px-2.5 py-2 text-sm transition-colors",
                  isActive(h)
                    ? "bg-ink text-paper"
                    : "text-ink/65 hover:bg-ink/10"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </a>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}
