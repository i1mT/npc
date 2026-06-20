"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, BookOpen, Bot, CircleStop, Database, FastForward, Play, RefreshCw, Send, Star } from "lucide-react";
import { HumanData } from "@/components/admin-shell";
import type { DaySummary, RuleDefinition, SimEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

type StatusPayload = {
  day: number;
  status: "idle" | "running" | "paused";
  state: {
    capital: number;
    reputation: number;
    dau: number;
    subscribers: number;
    adRevenue: number;
    llmCost: number;
  };
};

const eventStyles = {
  thinking: "border-rule bg-white",
  message: "border-mint bg-[#eefaf4]",
  tool_call: "border-ink bg-[#f1f1ef] font-mono",
  tool_result: "border-ink bg-[#f8f8f4] font-mono",
  decision: "border-cobalt bg-[#eef2ff]",
  board: "border-signal bg-[#fff5c7]",
};

export function Dashboard({ initialDays, rules }: { initialDays: DaySummary[]; rules: RuleDefinition[] }) {
  const [days, setDays] = useState(initialDays);
  const [selectedDay, setSelectedDay] = useState(initialDays[0]?.day ?? 1);
  const [events, setEvents] = useState<SimEvent[]>([]);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [directive, setDirective] = useState("");
  const selected = useMemo(() => days.find((day) => day.day === selectedDay) ?? days[0], [days, selectedDay]);

  const refreshAll = useCallback(async (day = selectedDay) => {
    const [statusResponse, daysResponse, eventResponse] = await Promise.all([
      fetch("/api/sim/status", { cache: "no-store" }),
      fetch("/api/days", { cache: "no-store" }),
      fetch(`/api/days/${day}/events`, { cache: "no-store" }),
    ]);
    setStatus(await statusResponse.json());
    const dayJson = (await daysResponse.json()) as { days: DaySummary[] };
    setDays(dayJson.days);
    const eventJson = (await eventResponse.json()) as { events: SimEvent[] };
    setEvents(eventJson.events);
  }, [selectedDay]);

  async function runDays(daysToRun: number) {
    await fetch("/api/sim/start", { method: "POST", body: JSON.stringify({ days: daysToRun }) });
    setTimeout(() => refreshAll(selectedDay), 900);
  }

  async function advance() {
    await fetch("/api/sim/advance", { method: "POST" });
    await refreshAll(selectedDay);
  }

  async function stop() {
    await fetch("/api/sim/stop", { method: "POST" });
    await refreshAll(selectedDay);
  }

  async function submitDirective() {
    if (!selected || !directive.trim()) return;
    await fetch("/api/sim/board-decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day: selected.day, directive }),
    });
    setDirective("");
    await refreshAll(selected.day);
  }

  useEffect(() => {
    refreshAll(selectedDay);
    const source = new EventSource("/api/sim/stream");
    source.addEventListener("event", (message) => {
      const event = JSON.parse((message as MessageEvent).data) as SimEvent;
      if (event.day === selectedDay) setEvents((current) => [...current, event]);
      refreshAll(event.day);
    });
    return () => source.close();
  }, [selectedDay, refreshAll]);

  const metrics = selected ?? status?.state;

  return (
    <main className="min-h-screen bg-[#f4f6f1] text-ink">
      <header className="border-b border-ink bg-ink px-4 py-4 text-paper md:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.28em] text-signal">simulation dashboard</p>
            <h1 className="text-2xl font-bold">AGI Daily NPC 控制台</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => runDays(3)} className="flex items-center gap-2 bg-signal px-3 py-2 text-sm font-bold text-ink"><Play className="h-4 w-4" />运行 3 天</button>
            <button onClick={advance} className="flex items-center gap-2 border border-paper px-3 py-2 text-sm"><FastForward className="h-4 w-4" />推进一天</button>
            <button onClick={stop} className="flex items-center gap-2 border border-paper px-3 py-2 text-sm"><CircleStop className="h-4 w-4" />暂停</button>
            <button onClick={() => refreshAll(selectedDay)} className="flex items-center gap-2 border border-paper px-3 py-2 text-sm"><RefreshCw className="h-4 w-4" />刷新</button>
          </div>
        </div>
      </header>

      <div className="grid min-h-[calc(100vh-81px)] grid-cols-1 lg:grid-cols-[180px_1fr_340px]">
        <aside className="border-b border-rule bg-[#e8ece4] p-3 lg:border-b-0 lg:border-r">
          <div className="mb-3 flex items-center gap-2 text-sm font-bold"><BookOpen className="h-4 w-4" />期次</div>
          <div className="grid grid-cols-3 gap-2 lg:grid-cols-1">
            {days.map((day) => (
              <button
                key={day.day}
                onClick={() => setSelectedDay(day.day)}
                className={cn("flex justify-between border px-3 py-2 text-sm", selectedDay === day.day ? "border-ink bg-ink text-paper" : "border-rule bg-white")}
              >
                <span>{day.isBoardDay ? "★ " : ""}Day {day.day}</span>
                <span>{day.articleCount}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="p-4 md:p-6">
          <div className="mb-5 grid gap-3 md:grid-cols-4">
            <Metric label="状态" value={status?.status ?? "idle"} />
            <Metric label="Capital" value={`¥${Math.round(metrics?.capital ?? 0).toLocaleString()}`} />
            <Metric label="DAU" value={Math.round(metrics?.dau ?? 0).toLocaleString()} />
            <Metric label="Rep" value={`${metrics?.reputation ?? 0}`} />
          </div>

          {selected?.isBoardDay ? (
            <div className="mb-5 border-2 border-signal bg-[#fff5c7] p-4">
              <div className="mb-3 flex items-center gap-2 font-bold"><Star className="h-5 w-5" />董事会 Day 指令</div>
              <div className="flex flex-col gap-2 md:flex-row">
                <textarea value={directive} onChange={(event) => setDirective(event.target.value)} className="min-h-20 flex-1 border border-ink bg-white p-3 text-sm" placeholder="输入董事会决定，例如：下周增加企业落地专题并压缩低来源可信度内容。" />
                <button onClick={submitDirective} className="flex items-center justify-center gap-2 bg-ink px-4 py-3 text-sm font-bold text-paper"><Send className="h-4 w-4" />提交</button>
              </div>
            </div>
          ) : null}

          <div className="flex items-center gap-2 border-b border-ink pb-3 text-lg font-bold"><Bot className="h-5 w-5" />Day {selectedDay} 工作事件流</div>
          <div className="mt-4 space-y-3">
            {events.map((event) => (
              <article key={event.id} className={cn("border-l-4 p-4 shadow-sm", eventStyles[event.eventType])}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink/60">
                  <span className="font-bold text-ink">{event.agentName}</span>
                  <span>#{event.seq} · {event.eventType}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-6">{event.content}</p>
                {event.metadata ? <EventDetails metadata={event.metadata} eventType={event.eventType} /> : null}
              </article>
            ))}
            {!events.length ? <p className="border border-dashed border-rule p-6 text-sm text-ink/60">当前期次暂无事件。运行模拟后会显示 Agent 决策、工具调用和发布结果。</p> : null}
          </div>
        </section>

        <aside className="border-t border-rule bg-white p-4 lg:border-l lg:border-t-0">
          <div className="mb-5 flex items-center gap-2 text-lg font-bold"><Activity className="h-5 w-5" />资源织网</div>
          <Resource label="Capital" value={metrics?.capital ?? 0} max={12000} prefix="¥" />
          <Resource label="Reputation" value={metrics?.reputation ?? 0} max={100} />
          <Resource label="DAU" value={metrics?.dau ?? 0} max={4000} />
          <Resource label="Subscribers" value={metrics?.subscribers ?? 0} max={1200} />

          <div className="mt-8 flex items-center gap-2 text-lg font-bold"><Database className="h-5 w-5" />规则库</div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            {[
              ["mission", "使命层"],
              ["environment", "能力层"],
              ["memory", "记忆层"],
              ["structure", "组织层"],
              ["rules", "规则层"],
              ["resource", "资源织网"],
              ["growth", "生长协议"],
            ].map(([key, label]) => (
              <a key={key} className="border border-rule bg-[#f8f8f4] px-3 py-2 font-bold hover:border-ink" href={`/dashboard/layers/${key}?day=${selectedDay}`}>
                {label}
              </a>
            ))}
          </div>
          <div className="mt-3 space-y-3">
            {rules.map((rule) => (
              <section key={rule.id} className="border border-rule p-3">
                <p className="text-xs font-bold text-cobalt">{rule.group}</p>
                <h3 className="mt-1 font-bold">{rule.title}</h3>
                <p className="mt-2 text-sm leading-5 text-ink/70">{rule.description}</p>
                <div className="mt-2 bg-[#f5f5f1] p-2"><HumanData value={rule.parameters} compact /></div>
              </section>
            ))}
          </div>
        </aside>
      </div>
    </main>
  );
}

function EventDetails({ metadata, eventType }: { metadata: Record<string, unknown>; eventType: string }) {
  const toolSummary = metadata.toolSummary as { tool?: string; input?: string; result?: string } | null;
  if (eventType === "tool_call" || eventType === "tool_result" || toolSummary) {
    return (
      <details className="mt-3 border border-rule bg-white/75 p-3">
        <summary className="cursor-pointer text-sm font-bold">工具摘要：{toolSummary?.tool ?? String(metadata.tool ?? "工具")}</summary>
        <div className="mt-2 grid gap-2 text-sm">
          <p><strong>用了什么工具：</strong>{toolSummary?.tool ?? String(metadata.tool ?? "未标注")}</p>
          <p><strong>得到什么信息：</strong>{toolSummary?.result ?? "已记录到事件影响面"}</p>
          {toolSummary?.input ? <p><strong>输入条件：</strong>{toolSummary.input}</p> : null}
        </div>
      </details>
    );
  }
  return <div className="mt-3 bg-white/70 p-3"><HumanData value={metadata} compact /></div>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border border-rule bg-white p-3">
      <p className="text-xs uppercase tracking-wide text-ink/50">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
    </div>
  );
}

function Resource({ label, value, max, prefix = "" }: { label: string; value: number; max: number; prefix?: string }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="mb-4">
      <div className="mb-1 flex justify-between text-sm">
        <span>{label}</span>
        <span>{prefix}{Math.round(value).toLocaleString()}</span>
      </div>
      <div className="h-3 border border-ink bg-[#ecece8]">
        <div className="h-full bg-mint" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
