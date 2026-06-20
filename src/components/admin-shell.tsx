import Link from "next/link";
import type { ReactNode } from "react";
import type { WorkEvent } from "@/lib/types";

const navGroups = [
  {
    title: "运行中心",
    links: [
      ["/dashboard", "公司总览"],
      ["/dashboard/events", "工作事件流"],
      ["/dashboard/settlement/1", "日结报告"],
    ],
  },
  {
    title: "七层资产",
    links: [
      ["/dashboard/layers/mission", "使命层"],
      ["/dashboard/layers/environment", "能力层"],
      ["/dashboard/layers/memory", "记忆层"],
      ["/dashboard/org", "组织层"],
      ["/dashboard/layers/rules", "规则层"],
      ["/dashboard/layers/resource", "资源织网"],
      ["/dashboard/layers/growth", "生长协议"],
    ],
  },
  {
    title: "治理",
    links: [
      ["/dashboard/board", "董事会记录"],
      ["/dashboard/growth", "Growth 控制台"],
    ],
  },
  {
    title: "前台",
    links: [["/replay", "日报回放"]],
  },
];

export function AdminShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-[#f4f6f1] text-ink lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="border-b border-rule bg-ink p-4 text-paper lg:min-h-screen lg:border-b-0 lg:border-r">
        <Link href="/dashboard" className="block text-xl font-bold">AGI Daily 后台</Link>
        <div className="mt-6 space-y-6">
          {navGroups.map((group) => (
            <nav key={group.title}>
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.22em] text-signal">{group.title}</p>
              <div className="grid gap-1">
                {group.links.map(([href, label]) => (
                  <Link key={href} href={href} className="rounded-sm px-2 py-1.5 text-sm text-paper/75 hover:bg-paper hover:text-ink">
                    {label}
                  </Link>
                ))}
              </div>
            </nav>
          ))}
        </div>
      </aside>
      <section>
        <header className="border-b border-ink bg-white px-6 py-5">
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-cobalt">npc operations</p>
          <h1 className="mt-1 text-3xl font-bold">{title}</h1>
          {subtitle ? <p className="mt-2 text-sm text-ink/65">{subtitle}</p> : null}
        </header>
        <div className="p-5 md:p-6">{children}</div>
      </section>
    </main>
  );
}

export function Panel({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`border border-rule bg-white p-4 shadow-sm ${className}`}>
      <h2 className="mb-3 text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}

export function JsonBlock({ value }: { value: unknown }) {
  return <HumanData value={value} />;
}

export function HumanData({ value, compact = false }: { value: unknown; compact?: boolean }) {
  if (value == null) return <p className="text-sm text-ink/55">暂无数据</p>;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return <span className="text-sm">{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (!value.length) return <p className="text-sm text-ink/55">暂无记录</p>;
    return (
      <div className={compact ? "space-y-1" : "space-y-2"}>
        {value.map((item, index) => (
          <div key={index} className="border border-rule bg-[#fbfbf8] p-2">
            <HumanData value={item} compact />
          </div>
        ))}
      </div>
    );
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item != null && item !== "");
  if (!entries.length) return <p className="text-sm text-ink/55">暂无字段</p>;
  return (
    <dl className={compact ? "grid gap-1 text-sm" : "grid gap-2 text-sm md:grid-cols-2"}>
      {entries.map(([key, item]) => (
        <div key={key} className="min-w-0 border-b border-rule/70 pb-1">
          <dt className="text-xs font-bold uppercase tracking-wide text-ink/45">{labelize(key)}</dt>
          <dd className="mt-1 break-words">
            {isPlainObject(item) || Array.isArray(item) ? <HumanData value={item} compact /> : String(item)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function WorkEventCard({ event, showImpact = true }: { event: WorkEvent; showImpact?: boolean }) {
  const meta = event.payload ?? {};
  const refs = event.refs ?? {};
  const toolSummary = (meta.toolSummary ?? null) as { tool?: string; input?: string; result?: string } | null;
  const mentions = (meta.mentions ?? []) as { agentName?: string; agentId?: string }[];
  const replyTo = meta.replyTo ?? refs.reply_to;
  const isTool = event.eventType === "tool_call" || event.eventType === "tool_result" || Boolean(toolSummary);
  return (
    <article className="border-l-4 border-ink bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink/55">
        <span className="font-bold text-ink">{event.actorName}</span>
        <span>#{event.seq} · {event.eventType} · {labelize(event.layer)}</span>
      </div>
      {mentions.length ? <p className="mt-2 text-xs font-bold text-cobalt">提到：{mentions.map((item) => item.agentName ?? item.agentId).join("、")}</p> : null}
      {replyTo ? <p className="mt-1 text-xs text-ink/55">回复链：回复事件 {String(replyTo).slice(0, 8)}</p> : null}
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{event.content}</p>
      {isTool ? <ToolSummary summary={toolSummary} fallback={event} /> : null}
      {meta.mastraAgent ? (
        <div className="mt-3 grid gap-2 border border-rule bg-[#f8f8f4] p-2 text-xs md:grid-cols-3">
          <span>Mastra Agent：{String((meta.mastraAgent as Record<string, unknown>).handle ?? event.actorId)}</span>
          <span>Instruction：{String((meta.mastraAgent as Record<string, unknown>).instructionHash ?? "loaded")}</span>
          <span>Thread：{String(meta.mastraThreadId ?? "").slice(0, 24)}</span>
        </div>
      ) : null}
      {showImpact ? <a className="mt-2 inline-block text-xs font-bold text-cobalt" href={`/api/work-events/${event.id}/impact`}>查看影响面</a> : null}
    </article>
  );
}

function ToolSummary({ summary, fallback }: { summary: { tool?: string; input?: string; result?: string } | null; fallback: WorkEvent }) {
  return (
    <details className="mt-3 border border-rule bg-[#f7f7f2] p-3" open={false}>
      <summary className="cursor-pointer text-sm font-bold">工具调用摘要：{summary?.tool ?? fallback.action}</summary>
      <div className="mt-2 grid gap-2 text-sm md:grid-cols-2">
        <div>
          <p className="text-xs font-bold text-ink/45">用了什么工具</p>
          <p>{summary?.tool ?? fallback.action}</p>
        </div>
        <div>
          <p className="text-xs font-bold text-ink/45">得到什么信息</p>
          <p>{summary?.result ?? fallback.content}</p>
        </div>
        {summary?.input ? <div className="md:col-span-2"><p className="text-xs font-bold text-ink/45">输入条件</p><p>{summary.input}</p></div> : null}
      </div>
    </details>
  );
}

function labelize(key: string) {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function isPlainObject(value: unknown) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
