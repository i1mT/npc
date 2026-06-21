"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Bot, ChevronDown, ChevronRight, FileText,
  Pause, Play, RefreshCw, RotateCcw, Star, TrendingUp, Users,
  Briefcase, UserPlus, AlertCircle, DollarSign,
  BrainCircuit, CheckCircle2, MessageSquare, Wrench, Network,
} from "lucide-react";
import type { DaySummary, SimEvent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useSimStream, type AgentStreamUpdate, type SimStatusSnapshot } from "@/components/live-sim";
import { TopologyTab } from "@/components/topology-tab";

// ─── Typewriter hook ──────────────────────────────────────────────────────────

function useTypewriter(text: string, active: boolean) {
  const [pos, setPos] = useState(active ? 0 : text.length);
  const doneRef = useRef(false);

  useEffect(() => {
    doneRef.current = false;
    if (!active || !text) { setPos(text.length); doneRef.current = true; return; }
    setPos(0);
    let p = 0;
    // Aim for ~60 frames total regardless of text length (min 2 chars/frame)
    const chunk = Math.max(2, Math.ceil(text.length / 60));
    const id = setInterval(() => {
      p = Math.min(p + chunk, text.length);
      setPos(p);
      if (p >= text.length) { doneRef.current = true; clearInterval(id); }
    }, 18);
    return () => clearInterval(id);
  }, [text, active]);

  return { displayed: text.slice(0, pos), done: pos >= text.length };
}

function TypewriterText({ text, active }: { text: string; active: boolean }) {
  const { displayed, done } = useTypewriter(text, active);
  return (
    <>
      {displayed}
      {active && !done && (
        <span className="inline-block w-[2px] h-[0.9em] bg-current opacity-60 animate-pulse align-baseline ml-0.5 rounded-[1px]" />
      )}
    </>
  );
}

// ─── Agent visual identity ────────────────────────────────────────────────────

const AGENT: Record<string, { initial: string; bg: string; label: string }> = {
  "editor-in-chief": { initial: "总", bg: "#254edb", label: "总编" },
  "editor":          { initial: "编", bg: "#2e9e6b", label: "编辑" },
  "growth-agent":    { initial: "增", bg: "#c05621", label: "增长" },
  "business-agent":  { initial: "商", bg: "#7c3aed", label: "商业" },
  "column-agent":    { initial: "专", bg: "#0891b2", label: "专栏" },
  "board":           { initial: "董", bg: "#92400e", label: "董事会" },
  "reader-agent":    { initial: "读", bg: "#be185d", label: "读者" },
};

function agentMeta(id: string) {
  return AGENT[id] ?? { initial: (id[0] ?? "?").toUpperCase(), bg: "#4b5563", label: id };
}

function AgentAvatar({ agentId, size = "md" }: { agentId: string; size?: "sm" | "md" }) {
  const m = agentMeta(agentId);
  const cls = cn(
    "shrink-0 flex items-center justify-center rounded-full font-bold text-white select-none transition-opacity hover:opacity-80",
    size === "sm" ? "h-6 w-6 text-xs" : "h-8 w-8 text-sm",
  );
  return (
    <a href={`/dashboard/employees/${agentId}`} title={`查看 ${m.label} 档案`} className="shrink-0">
      <div className={cls} style={{ backgroundColor: m.bg }}>{m.initial}</div>
    </a>
  );
}

// ─── Content parsing ──────────────────────────────────────────────────────────

function tryJson(s: string): Record<string, unknown> | null {
  if (!s || !s.startsWith("{")) return null;
  try { return JSON.parse(s) as Record<string, unknown>; } catch { return null; }
}

function isEvoMapTool(tool?: string | null) {
  return Boolean(tool?.startsWith("evomap_"));
}

// Markdown renderer — used for all free-form agent text
function MdText({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p:      ({ children }) => <p className="mb-2 last:mb-0 text-sm leading-7 text-ink/80">{children}</p>,
        strong: ({ children }) => <strong className="font-bold text-ink">{children}</strong>,
        em:     ({ children }) => <em className="italic text-ink/70">{children}</em>,
        ul:     ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-0.5 text-sm text-ink/80">{children}</ul>,
        ol:     ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-0.5 text-sm text-ink/80">{children}</ol>,
        li:     ({ children }) => <li className="leading-6">{children}</li>,
        code:   ({ children, className }) =>
          className
            ? <code className="block rounded bg-ink/5 px-3 py-2 text-xs font-mono text-ink/75 whitespace-pre-wrap my-2">{children}</code>
            : <code className="rounded bg-ink/8 px-1 py-0.5 text-xs font-mono text-ink/75">{children}</code>,
        blockquote: ({ children }) => <blockquote className="border-l-2 border-ink/20 pl-3 text-ink/60 italic my-2">{children}</blockquote>,
        h1: ({ children }) => <h1 className="text-base font-black mb-1 mt-2">{children}</h1>,
        h2: ({ children }) => <h2 className="text-sm font-black mb-1 mt-2 text-ink/80">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-bold mb-0.5 mt-1.5 text-ink/70">{children}</h3>,
        table: ({ children }) => <table className="text-xs border-collapse w-full my-2">{children}</table>,
        th:    ({ children }) => <th className="border border-rule px-2 py-1 bg-ink/5 font-bold text-left">{children}</th>,
        td:    ({ children }) => <td className="border border-rule px-2 py-1">{children}</td>,
        a:     ({ children, href }) => <a href={href} target="_blank" rel="noreferrer" className="text-cobalt underline">{children}</a>,
        hr:    () => <hr className="border-rule my-3" />,
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

// Published article card list — uses metadata.publishedArticles if available
function PublishedArticlesCard({ meta, ts }: {
  meta: Record<string, unknown>;
  ts: { tool?: string; input?: string; result?: string };
}) {
  type ArticleCard = { id?: string; titleZh?: string; summaryZh?: string; qualityScore?: number; tags?: string[] };
  const articles = (meta.publishedArticles as ArticleCard[] | undefined) ?? [];
  const count = articles.length || Number(ts.result?.match(/(\d+) 篇/)?.[1] ?? 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="rounded bg-mint px-2.5 py-1 text-xs font-black text-white">✓ 发布成功</span>
        <span className="text-xs text-ink/50">{count} 篇入库</span>
      </div>
      {articles.length > 0 && (
        <div className="space-y-2">
          {articles.map((a, i) => (
            <div key={a.id ?? i} className="rounded border border-rule bg-[#f8faf8] px-3 py-2.5">
              <div className="flex items-start gap-2">
                <span className="shrink-0 tabular-nums text-xs text-ink/30 w-4 pt-0.5">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2 justify-between">
                    {a.id
                      ? <a href={`/articles/${a.id}`} target="_blank" rel="noreferrer" className="text-sm font-bold text-ink leading-5 hover:text-cobalt hover:underline">{a.titleZh}</a>
                      : <p className="text-sm font-bold text-ink leading-5">{a.titleZh}</p>
                    }
                    {a.qualityScore != null && (
                      <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[11px] font-black",
                        a.qualityScore >= 8 ? "bg-mint/15 text-green-700" :
                        a.qualityScore >= 7 ? "bg-signal/25 text-amber-700" : "bg-coral/10 text-coral"
                      )}>{a.qualityScore.toFixed(1)}</span>
                    )}
                  </div>
                  {a.summaryZh && <p className="text-xs text-ink/55 leading-5 mt-1 line-clamp-2">{a.summaryZh}</p>}
                  {a.tags && a.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {(a.tags as string[]).slice(0, 3).map((tag: string) => (
                        <span key={tag} className="rounded bg-ink/5 px-1.5 py-0.5 text-[10px] text-ink/45">{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Hire event card
function HireCard({ content }: { content: string }) {
  return (
    <div className="flex items-start gap-2">
      <UserPlus className="h-4 w-4 text-cobalt mt-0.5 shrink-0" />
      <p className="text-sm text-ink/80">{content}</p>
    </div>
  );
}

// Growth decision card
function GrowthCard({ d }: { d: Record<string, unknown> }) {
  const st      = d.status as string;
  const reason  = d.reason != null ? String(d.reason) : "";
  const rolemap: Record<string, string> = { growth: "增长 Agent", business: "商业 Agent", column: "专栏 Agent" };
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={cn("rounded px-2.5 py-1 font-bold",
          st === "expand" ? "bg-mint text-white" : st === "contract" ? "bg-coral text-white" : "bg-rule text-ink"
        )}>
          {st === "expand" ? "↑ 扩张" : st === "contract" ? "↓ 收缩" : "→ 维持"}
        </span>
        {d.newAgentRole != null && (
          <span className="flex items-center gap-1 rounded bg-cobalt/10 px-2 py-0.5 text-xs text-cobalt">
            <UserPlus className="h-3 w-3" />
            孵化 {rolemap[String(d.newAgentRole)] ?? String(d.newAgentRole)}
            {d.newAgentName != null && <> · {String(d.newAgentName)}</>}
          </span>
        )}
      </div>
      {reason && <p className="text-sm text-ink/70 leading-6">{reason}</p>}
    </div>
  );
}

function ContentRenderer({ event, typewrite }: { event: SimEvent; typewrite?: boolean }) {
  const type = event.eventType as string;
  const ts   = (event.metadata ?? {}).toolSummary as { tool?: string; input?: string; result?: string } | null;
  const meta = event.metadata ?? {};

  // Tool call events
  if ((type === "tool_call" || type === "tool_result") && ts?.tool) {
    // Publish result gets article cards
    if (ts.tool === "publish_articles") return <PublishedArticlesCard meta={meta as Record<string, unknown>} ts={ts} />;
    const resultText = ts.result ?? event.content ?? "";
    const isEvoMap = isEvoMapTool(ts.tool);
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          {isEvoMap && <span className="rounded bg-[#ecfeff] px-1.5 py-0.5 text-[10px] font-black text-[#155e75]">EvoMap</span>}
          <code className={cn(
            "rounded px-2 py-0.5 text-[11px] font-mono font-bold",
            isEvoMap ? "bg-[#cffafe] text-[#155e75]" : "bg-ink/6 text-ink/70",
          )}>{ts.tool}()</code>
          {ts.input && <span className="text-[11px] text-ink/35 truncate max-w-[200px]">{ts.input}</span>}
        </div>
        {resultText && <p className="text-xs text-ink/55 leading-5">{resultText}</p>}
      </div>
    );
  }

  // Growth / expansion decision (JSON content on decision events)
  const json = tryJson(event.content);
  if (json) {
    if ("status" in json && ["maintain","expand","contract"].includes(json.status as string)) return <GrowthCard d={json} />;
    if ("note" in json) return <p className="text-sm italic text-ink/65 leading-7">{String(json.note)}</p>;
  }

  // Org change: hiring / firing
  if (type === "org_change" && event.content) {
    if (event.content.includes("招聘") || (meta as Record<string, unknown>).action === "hire_employee") {
      return <HireCard content={event.content} />;
    }
  }

  if (!event.content) return null;

  // Default: render as markdown
  return typewrite
    ? <p className="whitespace-pre-wrap text-sm leading-7 text-ink/80"><TypewriterText text={event.content} active /></p>
    : <MdText text={event.content} />;
}

// ─── @mention rendering ───────────────────────────────────────────────────────

// ─── Event grouping ───────────────────────────────────────────────────────────

type EventItem =
  | { kind: "msg";          event: SimEvent; tools: SimEvent[] }
  | { kind: "memory-batch"; events: SimEvent[]; agentId: string; agentName: string }
  | { kind: "sys";          event: SimEvent };

const TOOL_TYPES = new Set(["tool_call", "tool_result"]);
const SYS_TYPES  = new Set(["board", "settlement", "org_change", "growth_trigger", "rule_trigger"]);
const MEM_TYPES  = new Set(["memory_write", "memory_read"]);
type TimelineEvent = SimEvent & { __displayOrder?: number };

function groupEvents(events: SimEvent[]): EventItem[] {
  const result: EventItem[] = [];
  let i = 0;
  while (i < events.length) {
    const ev  = events[i];
    const t   = ev.eventType as string;

    // System events (board, settlement, etc.) stand alone
    if (SYS_TYPES.has(t)) {
      result.push({ kind: "sys", event: ev });
      i++;
      continue;
    }

    // Memory batch
    if (MEM_TYPES.has(t)) {
      const batch: SimEvent[] = [ev];
      let j = i + 1;
      while (j < events.length && MEM_TYPES.has(events[j].eventType as string) && events[j].agentId === ev.agentId) {
        batch.push(events[j++]);
      }
      result.push({ kind: "memory-batch", events: batch, agentId: ev.agentId, agentName: ev.agentName });
      i = j;
      continue;
    }

    // Tool call: accumulate into next message
    if (TOOL_TYPES.has(t)) {
      // Buffer tool calls, attach to next message from same agent
      const tools: SimEvent[] = [ev];
      i++;
      while (i < events.length && TOOL_TYPES.has(events[i].eventType as string) && events[i].agentId === ev.agentId) {
        tools.push(events[i++]);
      }
      // Now grab the next message (or decision) from same agent if it immediately follows
      if (i < events.length && !SYS_TYPES.has(events[i].eventType as string) && !MEM_TYPES.has(events[i].eventType as string) && events[i].agentId === ev.agentId) {
        result.push({ kind: "msg", event: events[i], tools });
        i++;
      } else {
        // No message follows — attach tools to a synthetic tool-only bubble
        result.push({ kind: "msg", event: tools[0], tools: tools.slice(1) });
      }
      continue;
    }

    // Regular message / decision
    result.push({ kind: "msg", event: ev, tools: [] });
    i++;
  }
  return result;
}

function mergeEvents(...groups: SimEvent[][]) {
  const byId = new Map<string, SimEvent>();
  for (const group of groups) {
    for (const event of group) byId.set(event.id, event);
  }
  return Array.from(byId.values()).sort(compareTimelineEvents);
}

function streamUpdateToEvent(update: AgentStreamUpdate): SimEvent {
  return {
    id: update.streamId,
    day: update.day,
    seq: 100000 + (update.turn ?? 0),
    agentId: update.agentId,
    agentName: update.agentName,
    eventType: update.eventType,
    content: update.content,
    metadata: { source: "agent-stream", status: update.status, turn: update.turn },
    createdAt: new Date().toISOString(),
  };
}

function compareTimelineEvents(a: SimEvent, b: SimEvent) {
  return a.day - b.day
    || timelineOrder(a) - timelineOrder(b)
    || a.seq - b.seq
    || a.createdAt.localeCompare(b.createdAt)
    || a.id.localeCompare(b.id);
}

function timelineOrder(event: SimEvent) {
  return readDisplayOrder(event) ?? event.seq;
}

function readDisplayOrder(event: SimEvent) {
  const value = (event as TimelineEvent).__displayOrder;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function withDisplayOrder(event: SimEvent, order: number): SimEvent {
  return { ...event, __displayOrder: order } as TimelineEvent;
}

function eventStreamKey(event: Pick<SimEvent, "day" | "agentId" | "metadata">) {
  const turn = Number((event.metadata ?? {}).turn ?? -1);
  if (!Number.isFinite(turn) || turn < 0) return null;
  return `${event.day}:${event.agentId}:${turn}`;
}

function shouldReplaceStreamWithEvent(ev: SimEvent) {
  const type = ev.eventType as string;
  return type === "message" || type === "decision" || type === "error";
}

function toolJson(ev: SimEvent) {
  const meta = ev.metadata ?? {};
  const ts = meta.toolSummary as { tool?: string; input?: string; result?: string; rawData?: unknown } | null;
  return JSON.stringify({
    type: ev.eventType,
    seq: ev.seq,
    tool: ts?.tool,
    input: ts?.input,
    result: ts?.result,
    rawData: ts?.rawData ?? null,
    metadata: meta,
  }, null, 2);
}

// ─── Chat bubble ──────────────────────────────────────────────────────────────

// ─── Collapsible tool calls under a message ───────────────────────────────────

function ToolCallList({ tools }: { tools: SimEvent[] }) {
  const [open, setOpen] = useState(false);
  if (!tools.length) return null;
  const hasEvoMap = tools.some(ev => isEvoMapTool(((ev.metadata ?? {}).toolSummary as { tool?: string } | null)?.tool));
  return (
    <div className="mt-2 ml-1">
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          "flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-medium transition-colors",
          hasEvoMap
            ? "border-[#67e8f9] bg-[#ecfeff] text-[#155e75] hover:border-[#22d3ee]"
            : "border-amber-200 bg-amber-50 text-amber-800 hover:border-amber-300",
        )}
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Wrench className="h-3 w-3" />
        {hasEvoMap ? "EvoMap / " : ""}{tools.length} 个工具调用
      </button>
      {open && (
        <div className={cn("mt-2 space-y-2 border-l-2 pl-3", hasEvoMap ? "border-[#67e8f9]" : "border-amber-200")}>
          {tools.map(ev => {
            const ts = (ev.metadata ?? {}).toolSummary as { tool?: string; input?: string; result?: string } | null;
            const isEvoMap = isEvoMapTool(ts?.tool);
            return (
              <div key={ev.id} className={cn(
                "rounded border px-3 py-2",
                isEvoMap ? "border-[#67e8f9] bg-[#ecfeff]" : "border-amber-200 bg-[#fffaf0]",
              )}>
                <div className="flex items-center gap-2 mb-1">
                  {isEvoMap && <span className="rounded bg-[#0891b2] px-1.5 py-0.5 text-[10px] font-black text-white">EvoMap</span>}
                  <code className={cn(
                    "text-[11px] font-bold bg-white px-1.5 py-0.5 rounded border",
                    isEvoMap ? "text-[#155e75] border-[#67e8f9]" : "text-amber-900 border-amber-100",
                  )}>
                    {ts?.tool ?? (ev.eventType as string)}()
                  </code>
                  <span className="text-[10px] text-ink/35">#{ev.seq}</span>
                </div>
                {ts?.input && <p className="text-[11px] text-ink/50 truncate">input: {ts.input}</p>}
                {ts?.result && <p className="text-[11px] text-ink/65 mt-0.5 line-clamp-2">result: {ts.result}</p>}
                <pre className={cn(
                  "mt-2 h-[300px] overflow-auto rounded border bg-white p-3 text-[11px] leading-5 text-ink/70",
                  isEvoMap ? "border-[#67e8f9]" : "border-amber-100",
                )}>
                  {toolJson(ev)}
                </pre>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Chat bubble ──────────────────────────────────────────────────────────────

// Map event type to badge config
const EVENT_BADGE: Record<string, { label: string; className: string; Icon?: React.FC<{ className?: string }> }> = {
  message:      { label: "消息",   className: "bg-sky-50 text-sky-700 border border-sky-100", Icon: MessageSquare },
  thinking:     { label: "思考",   className: "bg-violet-50 text-violet-700 border border-violet-100", Icon: BrainCircuit },
  decision:     { label: "决策",   className: "bg-cobalt/15 text-cobalt border border-cobalt/15", Icon: Briefcase },
  tool_call:    { label: "工具",   className: "bg-amber-50 text-amber-800 border border-amber-100", Icon: Wrench },
  tool_result:  { label: "结果",   className: "bg-emerald-50 text-emerald-700 border border-emerald-100", Icon: CheckCircle2 },
  org_change:   { label: "组织变动", className: "bg-amber-100 text-amber-700", Icon: UserPlus },
  settlement:   { label: "结算",   className: "bg-mint/15 text-green-700", Icon: DollarSign },
  board:        { label: "董事会", className: "bg-signal/20 text-amber-700", Icon: Star },
  growth_trigger: { label: "增长", className: "bg-mint/10 text-green-600", Icon: TrendingUp },
  rule_trigger:   { label: "规则", className: "bg-coral/10 text-coral" },
  error:          { label: "错误", className: "bg-coral/15 text-coral", Icon: AlertCircle },
};

function EventTypeBadge({ type }: { type: string }) {
  const cfg = EVENT_BADGE[type] ?? { label: type, className: "bg-ink/5 text-ink/40" };
  return (
    <span className={cn("flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider", cfg.className)}>
      {cfg.Icon && <cfg.Icon className="h-2.5 w-2.5" />}
      {cfg.label}
    </span>
  );
}

function SysBubble({ event, delay }: { event: SimEvent; delay: number }) {
  const type = event.eventType as string;

  if (type === "board") return (
    <div className="animate-event-in rounded border-2 border-signal bg-[#fff9e6] p-4" style={{ animationDelay: `${delay}ms` }}>
      <div className="mb-2 flex items-center gap-1.5">
        <EventTypeBadge type="board" />
        <span className="text-xs text-amber-700 font-medium">#{event.seq}</span>
      </div>
      <ContentRenderer event={event} />
    </div>
  );

  if (type === "settlement") return (
    <div className="animate-event-in rounded border border-mint/30 bg-[#f0faf5] px-4 py-3" style={{ animationDelay: `${delay}ms` }}>
      <div className="mb-1 flex items-center gap-2">
        <EventTypeBadge type="settlement" />
        <span className="text-xs text-ink/40">Day {event.day} · #{event.seq}</span>
      </div>
      {event.content && <p className="text-sm leading-6 text-ink/75">{event.content}</p>}
    </div>
  );

  if (type === "org_change") return (
    <div className="animate-event-in rounded border border-amber-200 bg-amber-50 px-4 py-3" style={{ animationDelay: `${delay}ms` }}>
      <div className="mb-1.5 flex items-center gap-2">
        <EventTypeBadge type="org_change" />
        {event.agentName && <span className="text-xs text-ink/50">由 {event.agentName} 决策</span>}
        <span className="ml-auto text-xs text-ink/30">#{event.seq}</span>
      </div>
      {event.content && <HireCard content={event.content} />}
    </div>
  );

  if (type === "growth_trigger") return (
    <div className="animate-event-in rounded border border-mint/25 bg-[#f3faf6] px-4 py-3" style={{ animationDelay: `${delay}ms` }}>
      <div className="mb-1.5 flex items-center gap-2">
        <EventTypeBadge type="growth_trigger" />
        <span className="ml-auto text-xs text-ink/30">#{event.seq}</span>
      </div>
      <ContentRenderer event={event} />
    </div>
  );

  // Error events — prominent collapsible card
  if (type === "error") {
    const errDetail = (event.metadata ?? {}).error as string | undefined;
    return (
      <div className="animate-event-in rounded border-2 border-red-300 bg-red-50" style={{ animationDelay: `${delay}ms` }}>
        <div className="flex items-center gap-2 px-4 py-3">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
          <div className="flex-1 min-w-0">
            <span className="text-sm font-bold text-red-700">执行错误</span>
            {event.content && <p className="mt-0.5 text-xs text-red-600 leading-5">{event.content}</p>}
          </div>
          <span className="shrink-0 text-[10px] text-red-400">#{event.seq}</span>
        </div>
        {errDetail && errDetail.length > 0 && (
          <details className="border-t border-red-200">
            <summary className="cursor-pointer px-4 py-2 text-[11px] font-bold text-red-500 hover:bg-red-100 transition-colors">
              查看错误详情
            </summary>
            <pre className="px-4 pb-3 pt-2 text-[11px] leading-5 text-red-700 whitespace-pre-wrap overflow-auto max-h-48">
              {errDetail}
            </pre>
          </details>
        )}
      </div>
    );
  }

  // rule_trigger + other system events
  const m = agentMeta(event.agentId);
  return (
    <div className="animate-event-in flex items-center gap-2 rounded border border-rule bg-[#fafaf8] px-3 py-2 text-xs" style={{ animationDelay: `${delay}ms` }}>
      <EventTypeBadge type={type} />
      <span style={{ color: m.bg }} className="font-medium">{event.agentName}</span>
      {event.content && <span className="truncate text-ink/55">{event.content.slice(0, 100)}</span>}
      <span className="ml-auto shrink-0 text-ink/30">#{event.seq}</span>
    </div>
  );
}

// Render @mentions as highlighted chips inside markdown text
function MdWithMentions({ text }: { text: string }) {
  // Pre-process: replace @handle with a placeholder span we'll detect
  const MENTION_RE = /@([A-Za-z0-9_\-\u4e00-\u9fff]{1,16})/g;
  // Just use ReactMarkdown and post-process mentions in text nodes
  const processed = text.replace(MENTION_RE, (_, handle) => `**@${handle}**`);
  return <MdText text={processed} />;
}

function ChatBubble({ event, tools, delay, isLatest }: { event: SimEvent; tools: SimEvent[]; delay: number; isLatest?: boolean }) {
  const type       = event.eventType as string;
  const m          = agentMeta(event.agentId);
  const isDecision = type === "decision";
  const isTool     = TOOL_TYPES.has(type);
  const isMsg      = type === "message" || type === "thinking";
  const isStreaming = event.metadata?.source === "agent-stream";
  const isActivelyStreaming = isStreaming && event.metadata?.status !== "done";

  // Compact tool view for standalone tool events
  if (isTool && !tools.length) {
    const ts = (event.metadata ?? {}).toolSummary as { tool?: string; input?: string; result?: string } | null;
    const isEvoMap = isEvoMapTool(ts?.tool);
    return (
      <div className="animate-event-in flex gap-2.5" style={{ animationDelay: `${delay}ms` }}>
        <AgentAvatar agentId={event.agentId} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-1">
            <span style={{ color: m.bg }} className="text-xs font-bold">{event.agentName}</span>
            <EventTypeBadge type={type} />
          </div>
          <div className={cn(
            "rounded border px-3 py-2",
            isEvoMap ? "border-[#67e8f9] bg-[#ecfeff]" : "border-amber-200 bg-[#fffaf0]",
          )}>
            <div className="flex items-center gap-2">
              {isEvoMap && <span className="rounded bg-[#0891b2] px-1.5 py-0.5 text-[10px] font-black text-white">EvoMap</span>}
              <code className={cn("text-[11px] font-bold", isEvoMap ? "text-[#155e75]" : "text-amber-900")}>{ts?.tool ?? type}()</code>
            </div>
            {ts?.input && <p className="mt-1 truncate text-[11px] leading-5 text-ink/50">input: {ts.input}</p>}
            {ts?.result && <p className="mt-0.5 text-[11px] leading-5 text-ink/65 line-clamp-2">result: {ts.result}</p>}
            <details className="mt-2">
              <summary className={cn("cursor-pointer text-[11px] font-bold", isEvoMap ? "text-[#155e75]" : "text-amber-800")}>查看 JSON</summary>
              <pre className={cn(
                "mt-2 h-[300px] overflow-auto rounded border bg-white p-3 text-[11px] leading-5 text-ink/70",
                isEvoMap ? "border-[#67e8f9]" : "border-amber-100",
              )}>
                {toolJson(event)}
              </pre>
            </details>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-event-in flex gap-3" style={{ animationDelay: `${delay}ms` }}>
      <AgentAvatar agentId={event.agentId} />
      <div className="min-w-0 flex-1">
        {/* Header: name + role label + type badge + seq */}
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <a href={`/dashboard/employees/${event.agentId}`} className="text-sm font-bold hover:underline" style={{ color: m.bg }}>
            {event.agentName}
          </a>
          <span className="rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ backgroundColor: `${m.bg}18`, color: m.bg }}>
            {m.label}
          </span>
          <EventTypeBadge type={type} />
          {isLatest && isActivelyStreaming && (
            <span className="flex items-center gap-1 rounded-full bg-mint/15 px-2 py-0.5 text-[10px] font-bold text-mint">
              <span className="h-1.5 w-1.5 rounded-full bg-mint animate-pulse" />
              生成中
            </span>
          )}
          <span className="ml-auto text-[10px] text-ink/25">#{event.seq}</span>
        </div>
        {/* Content bubble */}
        <div className={cn("rounded-sm border p-3",
          isDecision ? "border-cobalt/20 bg-[#f4f6ff]" :
          isStreaming ? "animate-generating-card border-cobalt/30 bg-white shadow-[0_0_0_1px_rgba(37,78,219,0.08),0_12px_28px_rgba(37,78,219,0.08)]" :
          type === "thinking" ? "border-violet-100 bg-violet-50/45" :
          isLatest   ? "border-sky-100 bg-white shadow-sm" :
          "border-sky-100 bg-white"
        )}>
          {isStreaming ? (
            event.content
              ? <div className="relative pr-2">
                  <MdText text={event.content} />
                  {isActivelyStreaming && <span className="inline-block h-[0.9em] w-[2px] animate-pulse rounded-[1px] bg-ink/70 align-baseline" />}
                </div>
              : <p className="flex items-center gap-1.5 text-sm leading-7 text-ink/40">
                  <span className="typing-dot h-2 w-2 rounded-full bg-ink/35" />
                  <span className="typing-dot h-2 w-2 rounded-full bg-ink/35" />
                  <span className="typing-dot h-2 w-2 rounded-full bg-ink/35" />
                  <span className="ml-2">正在生成…</span>
                </p>
          ) : isMsg && event.content ? (
            isLatest
              ? <p className="whitespace-pre-wrap text-sm leading-7 text-ink/80"><TypewriterText text={event.content} active /></p>
              : <MdWithMentions text={event.content} />
          ) : (
            <ContentRenderer event={event} typewrite={isLatest} />
          )}
        </div>
        {/* Collapsible tool calls */}
        <ToolCallList tools={tools} />
      </div>
    </div>
  );
}

function MemoryBatch({ item, delay }: { item: Extract<EventItem, { kind: "memory-batch" }>; delay: number }) {
  const [open, setOpen] = useState(false);
  const m = agentMeta(item.agentId);
  return (
    <div className="animate-event-in flex gap-3" style={{ animationDelay: `${delay}ms` }}>
      <AgentAvatar agentId={item.agentId} size="sm" />
      <div className="min-w-0 flex-1">
        <button onClick={() => setOpen(!open)}
          className="flex items-center gap-2 rounded border border-rule bg-[#f6f6f3] px-3 py-1.5 text-xs text-ink/55 hover:border-ink/30 transition-colors">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <span style={{ color: m.bg }} className="font-medium">{item.agentName}</span>
          <span>记忆写入 ×{item.events.length}</span>
        </button>
        {open && (
          <div className="mt-1.5 ml-2 space-y-0.5 border-l border-rule pl-3">
            {item.events.map(e => <p key={e.id} className="text-xs leading-5 text-ink/50">{e.content}</p>)}
          </div>
        )}
      </div>
    </div>
  );
}

function TypingIndicator({ agentId, agentName }: { agentId?: string; agentName?: string }) {
  const m = agentId ? agentMeta(agentId) : null;
  return (
    <div className="flex gap-3 animate-event-in">
      {m ? (
        <AgentAvatar agentId={agentId!} />
      ) : (
        <div className="h-8 w-8 shrink-0 rounded-full bg-ink/10 flex items-center justify-center">
          <Bot className="h-4 w-4 text-ink/40" />
        </div>
      )}
      <div className="flex flex-col gap-1 min-w-0">
        {m && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold" style={{ color: m.bg }}>{agentName ?? m.label}</span>
            <span className="rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ backgroundColor: `${m.bg}18`, color: m.bg }}>{m.label}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5 rounded-sm border border-rule bg-white px-4 py-3 w-fit">
          <span className="typing-dot h-2 w-2 rounded-full bg-ink/40" />
          <span className="typing-dot h-2 w-2 rounded-full bg-ink/40" />
          <span className="typing-dot h-2 w-2 rounded-full bg-ink/40" />
          <span className="ml-2 text-xs text-ink/40">正在思考…</span>
        </div>
      </div>
    </div>
  );
}

// ─── Chat tab (with play mode) ────────────────────────────────────────────────

function ChatTab({ events, streamEvents, isRunning, playVisible, isPlayMode, latestEventId, simError }: {
  events: SimEvent[];
  streamEvents: SimEvent[];
  isRunning: boolean;
  playVisible: number;
  isPlayMode: boolean;
  latestEventId?: string;
  simError?: string | null;
}) {
  const displayEvents = useMemo(() => mergeEvents(events, streamEvents), [events, streamEvents]);
  const allGroups     = useMemo(() => groupEvents(displayEvents), [displayEvents]);
  const visibleGroups = isPlayMode && playVisible >= 0
    ? allGroups.slice(0, playVisible)
    : allGroups;
  const bottomRef = useRef<HTMLDivElement>(null);

  // Last event agent for typing indicator
  const lastEvent = displayEvents[displayEvents.length - 1];
  const typingAgentId   = isRunning && lastEvent ? lastEvent.agentId   : undefined;
  const typingAgentName = isRunning && lastEvent ? lastEvent.agentName : undefined;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [visibleGroups.length, isRunning, displayEvents.length]);

  if (!allGroups.length && !isRunning) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-ink/40">
        <Bot className="h-10 w-10" />
        <p className="text-sm">运行模拟后，Agent 的对话和决策将实时出现在这里。</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 px-4 py-4 pb-8">
      {visibleGroups.map((item, idx) => {
        const delay = isPlayMode ? 0 : Math.min(idx * 55, 900);
        if (item.kind === "memory-batch") return <MemoryBatch key={`batch-${idx}`} item={item} delay={delay} />;
        if (item.kind === "sys") return <SysBubble key={item.event.id} event={item.event} delay={delay} />;
        const isLatest = !isPlayMode && item.event.id === latestEventId;
        return <ChatBubble key={item.event.id} event={item.event} tools={item.tools} delay={delay} isLatest={isLatest} />;
      })}
      {isRunning && !isPlayMode && streamEvents.length === 0 && <TypingIndicator agentId={typingAgentId} agentName={typingAgentName} />}
      {simError && (
        <div className="rounded-lg border-2 border-red-300 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 shrink-0 text-red-500 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-red-700">工作流已停止</p>
            <p className="mt-1 text-xs text-red-600 leading-5">{simError}</p>
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}

// ─── Articles tab ─────────────────────────────────────────────────────────────

type Article = {
  id: string; day: number; titleZh: string; summaryZh: string;
  sourceUrl: string; qualityScore: number; tags: string[];
};

function ArticlesTab({ dayNum }: { dayNum: number }) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/days/${dayNum}/articles`)
      .then(r => r.json())
      .then((data) => {
        setArticles(((data as { articles: Article[] }).articles) ?? []);
        setLoading(false);
      });
  }, [dayNum]);

  if (loading) return <div className="p-8 text-center text-sm text-ink/40">加载中…</div>;
  if (!articles.length) return <div className="p-8 text-center text-sm text-ink/40">本期暂无发布文章</div>;

  return (
    <div className="p-4 space-y-3">
      {articles.map((a, i) => (
        <div key={a.id} className="rounded-lg border border-rule bg-white p-4">
          <div className="flex items-start gap-2 mb-2">
            <span className="shrink-0 text-xs font-bold text-ink/30 pt-0.5 w-5">{i + 1}</span>
            <div className="flex-1 min-w-0">
              <a href={`/articles/${a.id}`} className="font-bold text-sm leading-6 hover:text-cobalt hover:underline transition-colors">
                {a.titleZh}
              </a>
              <p className="text-xs text-ink/55 leading-5 mt-0.5 line-clamp-2">{a.summaryZh}</p>
            </div>
            {a.qualityScore != null && (
              <span className={cn("shrink-0 rounded px-2 py-0.5 text-sm font-black ml-1",
                a.qualityScore >= 8 ? "bg-mint/15 text-green-700" :
                a.qualityScore >= 7 ? "bg-signal/25 text-amber-700" : "bg-coral/10 text-coral"
              )}>{a.qualityScore.toFixed(1)}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 ml-7 flex-wrap">
            {(Array.isArray(a.tags) ? a.tags : []).slice(0, 3).map(t => (
              <span key={t} className="rounded bg-ink/5 px-1.5 py-0.5 text-[10px] text-ink/50">{t}</span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Play controls ────────────────────────────────────────────────────────────

function PlayBar({ total, current, isPlaying, onPlay, onPause, onReset }: {
  total: number; current: number; isPlaying: boolean;
  onPlay: () => void; onPause: () => void; onReset: () => void;
}) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-cobalt/20 bg-[#f4f6ff] px-3 py-2 mx-4 mb-1">
      <button
        onClick={onReset}
        title="重置"
        className="rounded p-1 text-cobalt/60 hover:text-cobalt transition-colors"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={isPlaying ? onPause : onPlay}
        className="flex items-center gap-1.5 rounded bg-cobalt px-3 py-1 text-xs font-bold text-white hover:bg-cobalt/80 transition-colors"
      >
        {isPlaying ? <><Pause className="h-3.5 w-3.5" />暂停</> : <><Play className="h-3.5 w-3.5" />播放</>}
      </button>
      <div className="flex-1">
        <div className="h-1.5 rounded-full bg-cobalt/15">
          <div className="h-full rounded-full bg-cobalt transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <span className="shrink-0 text-xs text-cobalt/60 tabular-nums">{current} / {total}</span>
    </div>
  );
}

// ─── Board meeting types & component ─────────────────────────────────────────

type BoardMeetingInfo = {
  day: number;
  weeklyReport: {
    summary?: string;
    avgDau?: number;
    weeklyRevenue?: number;
    reputationEnd?: number;
    articleCount?: number;
    majorDecisions?: string[];
  };
  autoDirective?: string | null;
  autoDirectiveReason?: string | null;
  suspendedAt?: string;
};

const BOARD_OPTIONS: { code: string; label: string; desc: string; color: string; textColor: string }[] = [
  { code: "MAINTAIN",            label: "维持现状", desc: "维持当前策略，不做重大调整",      color: "#f4f4f1", textColor: "#161616" },
  { code: "ADJUST_OKR",         label: "调整目标", desc: "修改季度核心指标和优先级",        color: "#eef2ff", textColor: "#254edb" },
  { code: "INJECT_CAPITAL",     label: "注入资本", desc: "追加资金，用于扩张或危机处置",    color: "#f0faf5", textColor: "#2e9e6b" },
  { code: "RESTRUCTURE",        label: "重组团队", desc: "调整 Agent 团队结构和职责",       color: "#fffbe8", textColor: "#b45309" },
  { code: "STRATEGIC_PIVOT",    label: "战略转向", desc: "改变产品方向或核心策略",          color: "#fdf4ff", textColor: "#7c3aed" },
  { code: "AMEND_CONSTITUTION", label: "修订宪法", desc: "修改公司核心价值观或基本准则",    color: "#fff1f0", textColor: "#e45c3a" },
];

function BoardMeetingCard({ meeting, onDecide }: { meeting: BoardMeetingInfo; onDecide: (code: string) => Promise<void> }) {
  const [collapsed, setCollapsed]   = useState(true);
  const [selected, setSelected]     = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const report = meeting.weeklyReport;

  async function pick(code: string) {
    if (submitting) return;
    setSelected(code);
    setSubmitting(true);
    await onDecide(code);
    setSubmitting(false);
  }

  return (
    <div className="shrink-0 border-b-2 border-signal bg-[#fffbe8]">
      {/* Always-visible header — click to expand/collapse */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-signal/10 transition-colors"
      >
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-signal text-ink shrink-0">
          <Users className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-black text-amber-800">董事会决策 · Day {meeting.day}</span>
          <span className="ml-2 text-[11px] text-amber-700/70">工作流已暂停，等待人类决策</span>
        </div>
        {meeting.autoDirective && (
          <span className="shrink-0 rounded-full border border-signal/40 bg-white/70 px-2 py-0.5 text-[10px] font-bold text-amber-700 mr-2">
            AI建议：{BOARD_OPTIONS.find(o => o.code === meeting.autoDirective)?.label ?? meeting.autoDirective}
          </span>
        )}
        <ChevronDown className={cn("h-4 w-4 text-amber-700/60 shrink-0 transition-transform", collapsed ? "" : "rotate-180")} />
      </button>

      {/* Expandable body */}
      {!collapsed && (
        <>
          {/* Weekly report metrics */}
          {(report.avgDau || report.weeklyRevenue || report.reputationEnd) && (
            <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-signal/20 px-4 py-2">
              {report.avgDau        != null && <span className="text-xs text-amber-800/70">DAU <strong className="text-amber-900">{report.avgDau.toLocaleString()}</strong></span>}
              {report.weeklyRevenue != null && <span className="text-xs text-amber-800/70">本周收入 <strong className="text-amber-900">¥{Number(report.weeklyRevenue).toLocaleString()}</strong></span>}
              {report.reputationEnd != null && <span className="text-xs text-amber-800/70">声誉 <strong className="text-amber-900">{Number(report.reputationEnd).toFixed(1)}</strong></span>}
              {report.articleCount  != null && <span className="text-xs text-amber-800/70">发文 <strong className="text-amber-900">{report.articleCount} 篇</strong></span>}
            </div>
          )}
          {report.summary && (
            <p className="border-t border-signal/20 px-4 py-2 text-xs leading-5 text-amber-800/80 italic">{String(report.summary).slice(0, 200)}</p>
          )}

          {/* Decision options */}
          <div className="grid grid-cols-3 gap-2 p-3 border-t border-signal/20">
            {BOARD_OPTIONS.map(opt => {
              const isAI     = meeting.autoDirective === opt.code;
              const isPicked = selected === opt.code;
              return (
                <button
                  key={opt.code}
                  onClick={() => void pick(opt.code)}
                  disabled={submitting}
                  className={cn(
                    "relative rounded-lg border-2 p-3 text-left transition-all",
                    isPicked
                      ? "scale-[0.97] border-ink/50 shadow-inner"
                      : "border-transparent hover:scale-[1.02] hover:shadow-md",
                    submitting && !isPicked ? "opacity-40" : ""
                  )}
                  style={{ backgroundColor: opt.color, color: opt.textColor }}
                >
                  {isAI && (
                    <span className="absolute -top-1.5 -right-1.5 rounded-full bg-signal px-1.5 py-0.5 text-[9px] font-black text-ink shadow-sm">AI</span>
                  )}
                  {isPicked && submitting && (
                    <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-white/60">
                      <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                    </span>
                  )}
                  <p className="font-black text-sm leading-tight">{opt.label}</p>
                  <p className="mt-0.5 text-[10px] leading-4 opacity-70">{opt.desc}</p>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Status type ──────────────────────────────────────────────────────────────

type StatusPayload = SimStatusSnapshot;

// ─── Main Dashboard component ─────────────────────────────────────────────────

export function Dashboard({ initialDays, initialSelectedDay, onNewDay }: {
  initialDays: DaySummary[];
  initialSelectedDay?: number;
  onNewDay?: (day: number) => void;
}) {
  const [days, setDays]               = useState(initialDays);
  const [selectedDay, setSelectedDay] = useState(initialSelectedDay ?? initialDays[0]?.day ?? 1);
  const [events, setEvents]           = useState<SimEvent[]>([]);
  const [streamEvents, setStreamEvents] = useState<SimEvent[]>([]);
  const [simStatus, setSimStatus]     = useState<string>("idle");
  const [activeTab, setActiveTab]     = useState<"chat" | "articles" | "topo">("chat");
  const [activeAgentIds, setActiveAgentIds] = useState<string[]>([]);
  const [boardMeeting, setBoardMeeting] = useState<BoardMeetingInfo | null>(null);
  const [latestEventId, setLatestEventId] = useState<string | undefined>(undefined);
  const [simError, setSimError]       = useState<string | null>(null);

  // Use ref to always have current selectedDay inside SSE closure
  const selectedDayRef = useRef(selectedDay);
  selectedDayRef.current = selectedDay;
  const nextDisplayOrderRef = useRef(1);
  const displayOrderByEventIdRef = useRef(new Map<string, number>());
  const displayOrderByStreamKeyRef = useRef(new Map<string, number>());

  const resetTimelineOrder = useCallback(() => {
    nextDisplayOrderRef.current = 1;
    displayOrderByEventIdRef.current.clear();
    displayOrderByStreamKeyRef.current.clear();
  }, []);

  const rememberTimelineOrder = useCallback((event: SimEvent) => {
    const streamKey = eventStreamKey(event);
    let order = readDisplayOrder(event)
      ?? displayOrderByEventIdRef.current.get(event.id)
      ?? (streamKey ? displayOrderByStreamKeyRef.current.get(streamKey) : undefined);

    if (order == null) {
      const isStreamEvent = event.metadata?.source === "agent-stream";
      const turn = Number((event.metadata ?? {}).turn ?? -1);
      order = isStreamEvent && nextDisplayOrderRef.current === 1 && Number.isFinite(turn) && turn >= 0
        ? 100000 + turn
        : isStreamEvent
          ? nextDisplayOrderRef.current
          : event.seq;
    }

    displayOrderByEventIdRef.current.set(event.id, order);
    if (streamKey) displayOrderByStreamKeyRef.current.set(streamKey, order);
    nextDisplayOrderRef.current = Math.max(nextDisplayOrderRef.current, order + 1);
    return withDisplayOrder(event, order);
  }, []);

  const rememberTimelineOrders = useCallback(
    (items: SimEvent[]) => items.map(rememberTimelineOrder),
    [rememberTimelineOrder],
  );

  // Play mode
  const [isPlayMode, setIsPlayMode] = useState(false);
  const [playIndex, setPlayIndex]   = useState(0);
  const [isPlaying, setIsPlaying]   = useState(false);
  const allGroups = useMemo(() => groupEvents(events), [events]);

  // Events visible in topology for current play position
  const topoPlayEvents = useMemo((): SimEvent[] => {
    if (!isPlayMode) return events;
    const result: SimEvent[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < Math.min(playIndex, allGroups.length); i++) {
      const item = allGroups[i]!;
      if (item.kind === "sys") {
        if (!seen.has(item.event.id)) { result.push(item.event); seen.add(item.event.id); }
      } else if (item.kind === "memory-batch") {
        for (const ev of item.events) { if (!seen.has(ev.id)) { result.push(ev); seen.add(ev.id); } }
      } else {
        for (const t of item.tools) { if (!seen.has(t.id)) { result.push(t); seen.add(t.id); } }
        if (!seen.has(item.event.id)) { result.push(item.event); seen.add(item.event.id); }
      }
    }
    return result;
  }, [isPlayMode, allGroups, playIndex, events]);

  // Auto-advance play index
  useEffect(() => {
    if (!isPlaying || !isPlayMode) return;
    if (playIndex >= allGroups.length) { setIsPlaying(false); return; }
    const t = setTimeout(() => setPlayIndex(i => i + 1), 700);
    return () => clearTimeout(t);
  }, [isPlaying, isPlayMode, playIndex, allGroups.length]);

  const selected = useMemo(() => days.find(d => d.day === selectedDay) ?? days[0], [days, selectedDay]);

  const refreshAll = useCallback(async (day: number) => {
    const [sr, dr, er, br] = await Promise.all([
      fetch("/api/sim/status",        { cache: "no-store" }),
      fetch("/api/days",              { cache: "no-store" }),
      fetch(`/api/days/${day}/events`, { cache: "no-store" }),
      fetch("/api/sim/board-meeting",  { cache: "no-store" }),
    ]);
    const st = await sr.json() as StatusPayload;
    setSimStatus(st.status);
    setDays(((await dr.json()) as { days: DaySummary[] }).days);
    const fetchedEvents = ((await er.json()) as { events: SimEvent[] }).events;
    const orderedFetchedEvents = rememberTimelineOrders(fetchedEvents);
    setEvents(cur => mergeEvents(rememberTimelineOrders(cur.filter(event => event.day === day)), orderedFetchedEvents));
    const bm = ((await br.json()) as { meeting: BoardMeetingInfo | null }).meeting;
    setBoardMeeting(bm);
  }, [rememberTimelineOrders]);

  // Sync selected day when URL param changes (user switched day in DaySwitcher)
  useEffect(() => {
    if (initialSelectedDay != null && initialSelectedDay !== selectedDayRef.current) {
      setSelectedDay(initialSelectedDay);
      resetTimelineOrder();
      setEvents([]);
      setStreamEvents([]);
      setLatestEventId(undefined);
      setIsPlayMode(false);
      setIsPlaying(false);
      void refreshAll(initialSelectedDay);
    }
  }, [initialSelectedDay, refreshAll, resetTimelineOrder]);

  useEffect(() => {
    void refreshAll(selectedDay);
  }, [refreshAll, selectedDay]);

  useSimStream({
    onStatus: (status) => {
      setSimStatus(status.status);
      if (status.status === "error") {
        // Clear all stuck "正在生成..." stream bubbles
        setStreamEvents([]);
        setSimError("模拟执行出错，工作流已停止。请查看上方错误详情，或前往系统页面回退到上一天后重新运行。");
      }
      if (status.status === "running" || status.status === "idle") {
        setSimError(null);
      }
      if (status.status === "running" && status.day > selectedDayRef.current) {
        setSelectedDay(status.day);
        selectedDayRef.current = status.day;
        resetTimelineOrder();
        setEvents([]);
        setStreamEvents([]);
        setLatestEventId(undefined);
        setActiveTab("chat");
        setIsPlayMode(false);
        setIsPlaying(false);
        onNewDay?.(status.day);
      }
    },
    onEvent: (ev) => {
      const curDay = selectedDayRef.current;
      const evType = ev.eventType as string;

      // Mark sim as running whenever events arrive
      setSimStatus("running");

      if (ev.day > curDay) {
        // New day detected — navigate and switch view
        setSelectedDay(ev.day);
        selectedDayRef.current = ev.day;
        resetTimelineOrder();
        const orderedEvent = rememberTimelineOrder(ev);
        setEvents([orderedEvent]);
        setIsPlayMode(false);
        setIsPlaying(false);
        onNewDay?.(ev.day);
      } else if (ev.day === curDay) {
        const orderedEvent = rememberTimelineOrder(ev);
        setEvents(cur => mergeEvents(rememberTimelineOrders(cur), [orderedEvent]));
      }
      setLatestEventId(ev.id);
      if (shouldReplaceStreamWithEvent(ev)) {
        const evTurn = Number((ev.metadata ?? {}).turn ?? -1);
        setStreamEvents(cur => cur.filter(event => {
          if (event.day !== ev.day || event.agentId !== ev.agentId) return true;
          const streamTurn = Number((event.metadata ?? {}).turn ?? -1);
          return evTurn >= 0 && streamTurn >= 0 && streamTurn !== evTurn;
        }));
      }

      // Selective refresh: only reload heavy data on milestone events
      if (evType === "settlement") {
        setSimStatus("idle");
        void refreshAll(ev.day);
      } else if (evType === "board") {
        // New board meeting — fetch it
        void fetch("/api/sim/board-meeting", { cache: "no-store" })
          .then(r => r.json())
          .then((d) => setBoardMeeting((d as { meeting: BoardMeetingInfo | null }).meeting));
      } else if (evType === "org_change") {
        // Refresh days summary to reflect headcount changes
        void fetch("/api/days", { cache: "no-store" })
          .then(r => r.json())
          .then((d) => setDays((d as { days: DaySummary[] }).days));
      }
    },
    onAgentStream: (update) => {
      const curDay = selectedDayRef.current;
      if (update.day > curDay) {
        setSelectedDay(update.day);
        selectedDayRef.current = update.day;
        resetTimelineOrder();
        setEvents([]);
        setStreamEvents([]);
        setActiveAgentIds([]);
        setActiveTab("chat");
        setIsPlayMode(false);
        setIsPlaying(false);
        onNewDay?.(update.day);
      }

      if (update.day !== selectedDayRef.current) return;

      // Track which agents are actively streaming
      if (update.status === "start") {
        setActiveAgentIds(ids => ids.includes(update.agentId) ? ids : [...ids, update.agentId]);
      } else if (update.status === "done" || update.status === "error") {
        setActiveAgentIds(ids => ids.filter(id => id !== update.agentId));
      }

      if (update.status === "error") {
        setStreamEvents(cur => cur.filter(event => event.id !== update.streamId));
        return;
      }
      const streamEvent = rememberTimelineOrder(streamUpdateToEvent(update));
      setStreamEvents(cur => mergeEvents(rememberTimelineOrders(cur.filter(event => event.id !== update.streamId)), [streamEvent]));
      setLatestEventId(update.streamId);
      setSimStatus("running");
    },
  });

  const selectDay = (day: number) => {
    setSelectedDay(day);
    resetTimelineOrder();
    setEvents([]);
    setStreamEvents([]);
    setActiveAgentIds([]);
    setLatestEventId(undefined);
    setActiveTab("chat");
    setIsPlayMode(false);
    setIsPlaying(false);
    void refreshAll(day);
  };

  async function submitDirective(code: string) {
    if (!boardMeeting) return;
    await fetch("/api/sim/board-decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day: boardMeeting.day, directive: code }),
    });
    setBoardMeeting(null);
    await refreshAll(boardMeeting.day);
  }

  function startPlay() { setIsPlayMode(true); setPlayIndex(0); setIsPlaying(true); }
  function pausePlay() { setIsPlaying(false); }
  function resetPlay() { setIsPlayMode(false); setIsPlaying(false); setPlayIndex(0); }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Board meeting — human decision required */}
      {boardMeeting && (
        <BoardMeetingCard meeting={boardMeeting} onDecide={submitDirective} />
      )}

      {/* Tab bar */}
      <div className="shrink-0 border-b border-rule bg-white px-4">
        <div className="flex items-center">
          {/* Tabs */}
          {([
            { id: "chat",     label: "对话",  Icon: Bot },
            { id: "articles", label: "文章",  Icon: FileText },
            { id: "topo",     label: "拓扑",  Icon: Network },
          ] as const).map(({ id, label, Icon }) => (
            <button key={id} onClick={() => setActiveTab(id)}
              className={cn("-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                activeTab === id ? "border-ink text-ink" : "border-transparent text-ink/45 hover:text-ink"
              )}>
              <Icon className="h-3.5 w-3.5" />{label}
            </button>
          ))}

          {/* Right side: play + status */}
          <div className="ml-auto flex items-center gap-2">
            {(activeTab === "chat" || activeTab === "topo") && events.length > 0 && !isPlayMode && (
              <button onClick={startPlay}
                className="flex items-center gap-1.5 rounded border border-cobalt/30 px-2.5 py-1 text-xs font-medium text-cobalt hover:bg-cobalt/5 transition-colors">
                <Play className="h-3 w-3" />播放
              </button>
            )}
            {(activeTab === "chat" || activeTab === "topo") && isPlayMode && (
              <button onClick={resetPlay}
                className="flex items-center gap-1.5 rounded border border-rule px-2.5 py-1 text-xs text-ink/50 hover:border-ink/30 transition-colors">
                <RotateCcw className="h-3 w-3" />退出播放
              </button>
            )}
            <button onClick={() => void refreshAll(selectedDay)} title="刷新"
              className="rounded p-1.5 text-ink/40 hover:text-ink transition-colors">
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            {simStatus === "running" && <span className="h-2 w-2 rounded-full bg-mint animate-pulse" />}
          </div>
        </div>
      </div>

      {/* Play bar */}
      {(activeTab === "chat" || activeTab === "topo") && isPlayMode && (
        <div className="shrink-0 pt-2">
          <PlayBar
            total={allGroups.length}
            current={playIndex}
            isPlaying={isPlaying}
            onPlay={() => { if (playIndex >= allGroups.length) setPlayIndex(0); setIsPlaying(true); }}
            onPause={pausePlay}
            onReset={resetPlay}
          />
        </div>
      )}

      {/* Content */}
      <div className={cn("flex-1 min-h-0", activeTab === "topo" ? "overflow-hidden" : "overflow-y-auto")}>
        {activeTab === "chat" && (
          <ChatTab
            events={events}
            streamEvents={streamEvents}
            isRunning={simStatus === "running"}
            playVisible={isPlayMode ? playIndex : -1}
            isPlayMode={isPlayMode}
            latestEventId={latestEventId}
            simError={simError}
          />
        )}
        {activeTab === "articles" && <ArticlesTab dayNum={selectedDay} />}
        {activeTab === "topo" && (
          <div className="h-full">
            <TopologyTab
              key={isPlayMode ? `play-${selectedDay}` : `live-${selectedDay}`}
              events={topoPlayEvents}
              streamEvents={isPlayMode ? [] : streamEvents}
              activeAgentIds={isPlayMode ? [] : activeAgentIds}
            />
          </div>
        )}
      </div>
    </div>
  );
}
