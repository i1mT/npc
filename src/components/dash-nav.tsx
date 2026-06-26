"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  BarChart2, Bot, BookOpen, Home, LayoutGrid, Layers,
  CalendarDays, Play, Shield, Users, Zap, ChevronRight, Wrench, Settings, Receipt,
} from "lucide-react";
import { DayPicker } from "react-day-picker";
import { zhCN } from "react-day-picker/locale";
import { cn } from "@/lib/utils";
import { dayToShortDate } from "@/lib/dates";
import { runSimDays, useSimStream, type SimStatusSnapshot } from "@/components/live-sim";

// ─── Sim control bar ─────────────────────────────────────────────────────────

type SimStatus = SimStatusSnapshot;

export function SimControlBar() {
  const [sim, setSim]                 = useState<SimStatus | null>(null);
  const [boardPending, setBoardPending] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const loadInitialState = async () => {
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
    void loadInitialState();
  }, []);

  useSimStream({
    onStatus: (status) => setSim(status),
    onEvent: (event) => {
      if (event.eventType === "board") {
        void fetch("/api/sim/board-meeting", { cache: "no-store" })
          .then(r => r.json())
          .then((data) => setBoardPending((data as { meeting: { day: number } | null }).meeting !== null));
      }
      if (event.eventType === "settlement") setBoardPending(false);
    },
  });

  const isRunning = sim?.status === "running";
  const canRun    = !isRunning && !boardPending;

  async function run(days: number) {
    if (!canRun) return;
    const nextDay = (sim?.day ?? 0) + 1;
    // Navigate first so the view is ready when events start streaming
    router.push(`/dashboard/work?day=${nextDay}`);
    await runSimDays(days);
    setTimeout(async () => {
      const r = await fetch("/api/sim/status", { cache: "no-store" });
      if (r.ok) setSim(await r.json());
    }, 600);
  }

  return (
    <div className="flex items-center gap-2">
      <span className={cn(
        "relative overflow-hidden px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.2em]",
        isRunning           ? "bg-mint text-white" :
        sim?.status === "paused" ? "bg-signal text-ink" :
        boardPending        ? "bg-amber-400 text-amber-900" :
        "bg-paper/12 text-paper/45"
      )}>
        {isRunning && <span className="absolute inset-y-0 left-0 w-8 animate-time-sweep bg-white/25" />}
        {boardPending && !isRunning ? "待决策" : (sim?.status ?? "…")}
      </span>
      <button
        onClick={() => run(1)}
        disabled={!canRun}
        title={boardPending ? "请先完成董事会决策" : "推进 1 天"}
        className={cn(
          "relative flex items-center gap-1 overflow-hidden px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.15em] transition-opacity",
          canRun ? "bg-signal text-ink hover:bg-signal/80" :
          isRunning ? "border border-mint/40 bg-mint/15 text-paper/70 cursor-wait" :
          "bg-signal/30 text-ink/40 cursor-not-allowed"
        )}>
        {isRunning && <span className="absolute inset-y-0 left-0 w-8 animate-time-sweep bg-white/20" />}
        <Play className="h-3 w-3" />推进 1 天
      </button>
    </div>
  );
}

// ─── Calendar picker ──────────────────────────────────────────────────────────

function DayCalendarPicker({
  allDays,
  currentDay,
  runningDay,
  onSelect,
}: {
  allDays: { day: number; isBoardDay: boolean }[];
  currentDay: number;
  runningDay: number | null;
  onSelect: (day: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Sim day ↔ local Date (Day 1 = June 1 2026 local midnight)
  const dayToLocal = (day: number) => new Date(2026, 5, day);
  const localToDay = (d: Date) =>
    Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(2026, 5, 1).getTime()) / 86_400_000) + 1;

  const enabledSet  = new Set(allDays.map(d => d.day));
  const selected    = dayToLocal(currentDay);
  const isLive      = !!runningDay;

  return (
    <div ref={ref} className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          "flex items-center gap-1.5 border px-2.5 py-1 text-xs font-medium transition-colors select-none",
          open
            ? "border-paper/40 bg-paper/20 text-paper"
            : isLive
            ? "animate-time-glow border-mint/60 bg-mint/15 text-paper"
            : "border-paper/20 bg-paper/10 text-paper/80 hover:border-paper/40 hover:text-paper"
        )}
      >
        <CalendarDays className="h-3.5 w-3.5 shrink-0" />
        <span>{dayToShortDate(currentDay)}</span>
        <span className="text-paper/35">D{currentDay}</span>
      </button>

      {/* Calendar popup */}
      {open && (
        <div className="rdp-dark absolute right-0 top-full z-50 mt-1.5 border border-white/10 bg-[#1c2434] p-1 shadow-2xl shadow-black/60">
          <DayPicker
            mode="single"
            locale={zhCN}
            selected={selected}
            defaultMonth={selected}
            startMonth={new Date(2026, 5, 1)}
            endMonth={new Date(2028, 11, 31)}
            onSelect={(date) => {
              if (!date) return;
              const day = localToDay(date);
              if (enabledSet.has(day)) { onSelect(day); setOpen(false); }
            }}
            disabled={(date) => !enabledSet.has(localToDay(date))}
            modifiersClassNames={{
              isBoardDay: "font-black",
            }}
            modifiers={{
              isBoardDay: allDays.filter(d => d.isBoardDay).map(d => dayToLocal(d.day)),
            }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Global day switcher ──────────────────────────────────────────────────────

export function DaySwitcher({ days }: { days: { day: number; isBoardDay: boolean }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [liveDays, setLiveDays] = useState(days);
  const [runningDay, setRunningDay] = useState<number | null>(null);

  useEffect(() => setLiveDays(days), [days]);

  useEffect(() => {
    fetch("/api/sim/status", { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then((status) => {
        const simStatus = status as SimStatusSnapshot | null;
        setRunningDay(simStatus?.status === "running" ? simStatus.day : null);
      });
  }, []);

  useSimStream({
    onStatus: (status) => {
      setRunningDay(status.status === "running" ? status.day : null);
    },
    onEvent: (event) => {
      if (event.eventType !== "settlement") return;
      void fetch("/api/days", { cache: "no-store" })
        .then(r => r.json())
        .then((data) => setLiveDays(((data as { days: { day: number; isBoardDay: boolean }[] }).days) ?? []));
    },
  });

  // Merge: completed days from SSR + live running day (if not already present)
  const allDays = [...liveDays];
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
    <div className="flex items-center gap-1">
      {/* 前一天 — only shown if older day exists */}
      {prev ? (
        <button
          onClick={() => go(prev.day)}
          className="border border-paper/20 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-paper/55 hover:border-paper/40 hover:text-paper transition-colors"
        >
          前一天
        </button>
      ) : (
        <span className="w-[54px]" />
      )}

      {/* Calendar date picker */}
      <DayCalendarPicker
        allDays={allDays}
        currentDay={currentDay}
        runningDay={runningDay}
        onSelect={go}
      />

      {/* 后一天 — only shown if newer day exists */}
      {next ? (
        <button
          onClick={() => go(next.day)}
          className="border border-paper/20 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-paper/55 hover:border-paper/40 hover:text-paper transition-colors"
        >
          后一天
        </button>
      ) : (
        <span className="w-[54px]" />
      )}
    </div>
  );
}

// ─── Sidebar navigation ───────────────────────────────────────────────────────

const NAV_GROUPS = [
  {
    label: "主菜单",
    items: [
      { href: "/dashboard",            label: "总览",    Icon: Home },
      { href: "/dashboard/work",       label: "工作日志", Icon: Bot },
      { href: "/dashboard/settlement", label: "财务日报", Icon: Receipt },
      { href: "/dashboard/org",        label: "组织架构", Icon: LayoutGrid },
      { href: "/dashboard/rules",      label: "规则",    Icon: Shield },
      { href: "/dashboard/hr",         label: "人才市场", Icon: Users },
      { href: "/dashboard/tools",      label: "工具目录", Icon: Wrench },
      { href: "/dashboard/system",     label: "系统",    Icon: Settings },
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
    <nav className="flex flex-col gap-5 p-4">
      {NAV_GROUPS.map(group => (
        <div key={group.label}>
          <p className="mb-2 text-[8px] font-bold uppercase tracking-[0.35em] text-ink/25 px-2">
            {group.label}
          </p>
          <div className="space-y-px">
            {group.items.map(({ href: h, label, Icon }) => (
              <a
                key={h}
                href={href(h)}
                className={cn(
                  "flex items-center gap-2.5 px-2.5 py-2 text-[12px] transition-colors border-l-2",
                  isActive(h)
                    ? "border-ink text-ink font-bold bg-ink/5"
                    : "border-transparent text-ink/45 hover:text-ink hover:border-ink/30"
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {label}
              </a>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}
