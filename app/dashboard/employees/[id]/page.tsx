import { dbAll, dbFirst } from "@/db/connection";
import type { RoleTemplateName } from "@/mastra/role-templates";
import { TOOL_META } from "@/mastra/tools/npc-tools";
import type { ToolName } from "@/mastra/tools/npc-tools";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Bot, Calendar, Clock, Wrench, Brain, Sparkles } from "lucide-react";
import { MarkdownView } from "@/components/markdown-view";

export const dynamic = "force-dynamic";

// ─── Design tokens ────────────────────────────────────────────────────────────

const ROLE_STYLE: Record<string, { label: string; bg: string; text: string; initial: string }> = {
  editor_in_chief: { label: "总编辑", bg: "#254edb", text: "#ffffff", initial: "总" },
  editor:          { label: "编辑",   bg: "#2e9e6b", text: "#ffffff", initial: "编" },
  growth:          { label: "增长",   bg: "#c05621", text: "#ffffff", initial: "G"  },
  business:        { label: "商业",   bg: "#92400e", text: "#ffffff", initial: "B"  },
  column:          { label: "专栏",   bg: "#5b21b6", text: "#ffffff", initial: "专" },
};

const EVENT_LABEL: Record<string, string> = {
  decision: "决策", message: "消息", tool_call: "工具调用", tool_result: "工具返回",
  memory_write: "记忆写入", thinking: "反思", settlement: "日结算", org_change: "组织变更",
  growth_trigger: "生长协议", rule_trigger: "规则触发",
};

function dotColor(type: string): string {
  const c: Record<string, string> = {
    decision: "bg-cobalt", message: "bg-mint", tool_call: "bg-ink/40", tool_result: "bg-ink/40",
    thinking: "bg-purple-400", memory_write: "bg-purple-300", settlement: "bg-signal", org_change: "bg-coral", growth_trigger: "bg-signal",
  };
  return c[type] ?? "bg-rule";
}

function previewContent(content: string, type: string): string {
  if (!content) return "";
  if (content.startsWith("{")) {
    try {
      const p = JSON.parse(content) as Record<string, unknown>;
      if (typeof p.note === "string") return `📝 ${p.note}`;
      if (Array.isArray(p.articles)) return `📄 ${(p.articles as unknown[]).length} 篇文章提交`;
      if (p.decision === "approve") return `✅ 批准  均分 ${p.averageScore ?? "—"}`;
      if (p.decision === "reject") return "✕ 打回";
      if (p.status === "maintain") return "→ 维持现有架构";
      if (p.status === "expand") return `↑ 扩张 · 孵化 ${String(p.newAgentRole ?? "")}`;
    } catch { /* fallthrough */ }
  }
  if (type === "thinking") return `💭 ${content.slice(0, 100)}`;
  return content.slice(0, 120);
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function EmployeePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ day?: string }>;
}) {
  const { id } = await params;
  const query = searchParams ? await searchParams : {};
  const latestDay = (await dbFirst<{ day: number }>("SELECT COALESCE(MAX(day), 0) AS day FROM sim_days"))?.day ?? 0;
  const selectedDay = Number(query.day ?? latestDay);

  const employee = await dbFirst<{
    id: string; display_name: string; role_template: RoleTemplateName;
    status: string; joined_day: number; left_day: number | null;
    system_prompt: string | null; soul: string | null;
    tools_granted: string | null; memory: string | null;
    agent_handle: string; daily_salary: number | null;
  }>(
    "SELECT id, display_name, role_template, status, joined_day, left_day, system_prompt, soul, tools_granted, memory, agent_handle, daily_salary FROM employees WHERE id = ? OR agent_handle = ?"
    ,
    id,
    id,
  );

  if (!employee) notFound();

  const snapshot = selectedDay > 0
    ? await dbFirst<{ day: number; soul_md: string; memory_md: string }>(
      `SELECT day, soul_md, memory_md
       FROM employee_soul_snapshots
       WHERE employee_id = ? AND day <= ?
       ORDER BY day DESC
       LIMIT 1`,
      employee.id,
      selectedDay,
    )
    : undefined;

  const recentEvents = await dbAll<{ id: string; day: number; seq: number; event_type: string; content: string }>(
    `SELECT id, day, seq, event_type, substr(content, 1, 200) AS content
     FROM work_events
     WHERE actor_id = ? AND (? <= 0 OR day <= ?)
     ORDER BY day DESC, seq DESC
     LIMIT 30`,
    employee.agent_handle,
    selectedDay,
    selectedDay,
  );

  // Parse granted tools from JSON
  let grantedTools: ToolName[] = [];
  try {
    grantedTools = employee.tools_granted ? (JSON.parse(employee.tools_granted) as ToolName[]) : [];
  } catch { /* skip */ }

  const style = ROLE_STYLE[employee.role_template] ?? { label: employee.role_template, bg: "#6b7280", text: "#fff", initial: "?" };
  const soul = snapshot?.soul_md?.trim() || employee.soul?.trim() || null;
  const memory = snapshot?.memory_md?.trim() || employee.memory?.trim() || null;
  const systemPrompt = employee.system_prompt?.trim() || null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="border-b border-rule bg-white px-6 py-2.5">
        <Link href="/dashboard/org" className="inline-flex items-center gap-1.5 text-xs text-ink/50 hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" /> 组织架构
        </Link>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
        {/* Identity card */}
        <div className="rounded-lg border border-rule bg-white p-6">
          <div className="flex items-start gap-4">
            <div
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-2xl font-black"
              style={{ backgroundColor: style.bg, color: style.text }}
            >
              {style.initial}
            </div>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-black">{employee.display_name}</h1>
                <span className="rounded px-2 py-0.5 text-xs font-bold" style={{ backgroundColor: style.bg, color: style.text }}>
                  {style.label}
                </span>
                <span className={`rounded px-2 py-0.5 text-xs font-bold ${employee.status === "active" ? "bg-mint/15 text-green-700" : "bg-rule text-ink/50"}`}>
                  {employee.status === "active" ? "在职" : "离职"}
                </span>
              </div>
              <p className="mt-1.5 font-mono text-sm text-ink/45">@{employee.agent_handle}</p>
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-ink/50">
                <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> Day {employee.joined_day} 入职</span>
                {employee.left_day && <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> Day {employee.left_day} 离职</span>}
                <span className="flex items-center gap-1"><Bot className="h-3.5 w-3.5" /> {employee.role_template}</span>
                {employee.daily_salary != null && (
                  <span className="flex items-center gap-1 font-mono text-cobalt">¥{employee.daily_salary}/天</span>
                )}
                {selectedDay > 0 && <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> 当前查看 Day {selectedDay}</span>}
              </div>
            </div>
          </div>
        </div>

        {/* System prompt */}
        {systemPrompt && (
          <section>
            <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-ink/40">
              <Bot className="h-3.5 w-3.5" /> 系统提示 / 职责
            </div>
            <div className="rounded-lg border border-rule bg-white p-5">
              <pre className="whitespace-pre-wrap text-sm leading-7 text-ink/75 font-sans">{systemPrompt}</pre>
            </div>
          </section>
        )}

        {/* Soul */}
        <section>
          <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-ink/40">
            <Sparkles className="h-3.5 w-3.5" /> 灵魂 / Soul
            <span className="ml-auto text-[10px] normal-case font-normal text-ink/30">
              {snapshot ? `快照 Day ${snapshot.day}` : "暂无历史快照，显示当前值"}
            </span>
          </div>
          <div className="rounded-lg border border-rule bg-white p-5">
            {soul
              ? <MarkdownView content={soul} />
              : <p className="text-sm text-ink/35 italic">该员工尚未形成个性化灵魂。每日工作后可通过 update_my_soul 工具写入。</p>
            }
          </div>
        </section>

        {/* Memory */}
        <section>
          <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-ink/40">
            <Brain className="h-3.5 w-3.5" /> 工作记忆
            {memory && <span className="ml-auto text-[10px] normal-case font-normal text-ink/30">{memory.length} / 800 字 · {snapshot ? `快照 Day ${snapshot.day}` : "当前值"}</span>}
          </div>
          <div className="rounded-lg border border-rule bg-white p-5">
            {memory
              ? <MarkdownView content={memory} />
              : <p className="text-sm text-ink/35 italic">该员工尚无工作记忆。每日反思后通过 write_memory 工具写入洞察。</p>
            }
          </div>
        </section>

        {/* Granted tools */}
        <section>
          <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-ink/40">
            <Wrench className="h-3.5 w-3.5" /> 可用工具
            <Link href="/dashboard/tools" className="ml-auto text-[10px] normal-case font-normal text-cobalt hover:underline">
              查看工具目录 →
            </Link>
          </div>
          <div className="rounded-lg border border-rule bg-white p-4">
            {grantedTools.length === 0 ? (
              <p className="text-sm text-ink/35 italic">无工具授权</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {grantedTools.map(toolName => {
                  const meta = TOOL_META[toolName];
                  return (
                    <Link
                      key={toolName}
                      href={`/dashboard/tools#${toolName}`}
                      className="group flex flex-col rounded border border-rule px-3 py-2 hover:border-cobalt/40 hover:bg-cobalt/3 transition-colors"
                    >
                      <code className="text-[11px] font-mono font-bold text-ink/70 group-hover:text-cobalt">{toolName}()</code>
                      {meta && <span className="text-[10px] text-ink/40 mt-0.5">{meta.displayName}</span>}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Recent work timeline */}
        <section>
          <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-ink/40">
            <Clock className="h-3.5 w-3.5" /> 最近工作（截至 Day {selectedDay || latestDay}，最新 30 条）
          </div>
          {recentEvents.length === 0 ? (
            <div className="rounded-lg border border-rule bg-white p-6 text-center text-sm text-ink/40">暂无工作记录</div>
          ) : (
            <div className="relative rounded-lg border border-rule bg-white">
              <div className="absolute bottom-0 left-[2.75rem] top-0 w-px bg-rule/60" />
              <div className="divide-y divide-rule/40">
                {recentEvents.map((ev) => (
                  <div key={ev.id} className="flex gap-4 px-4 py-3">
                    <div className="w-12 shrink-0 pt-0.5">
                      <span className="text-xs font-bold text-ink/35">D{ev.day}</span>
                    </div>
                    <div className="relative z-10 shrink-0">
                      <div className={`mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-white ${dotColor(ev.event_type)}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-bold text-ink/50">{EVENT_LABEL[ev.event_type] ?? ev.event_type}</span>
                        <span className="text-xs text-ink/30">#{ev.seq}</span>
                      </div>
                      <p className="truncate text-sm text-ink/75">{previewContent(ev.content, ev.event_type)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
