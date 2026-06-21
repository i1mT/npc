import type { Metadata } from "next";
import { dbAll } from "@/db/connection";
import { listDays } from "@/db/sim";
import { dayToShortDate } from "@/lib/dates";
import Link from "next/link";
import { LayoutGrid } from "lucide-react";
import { AgentWorkLabel, OrgWorkStatusProvider } from "@/components/org-work-status";

export const dynamic = "force-dynamic";

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ day?: string }> }): Promise<Metadata> {
  const query = await searchParams;
  return {
    title: query.day ? `Day ${query.day} 组织架构` : "组织架构",
    description: "查看 AGI Daily Agent 团队、汇报关系和组织变更。",
  };
}

// ─── Design tokens ────────────────────────────────────────────────────────────

const ROLE_STYLE: Record<string, { label: string; bg: string; text: string; initial: string }> = {
  editor_in_chief: { label: "总编辑", bg: "#254edb", text: "#ffffff", initial: "总" },
  editor:          { label: "编辑",   bg: "#2e9e6b", text: "#ffffff", initial: "编" },
  growth:          { label: "增长",   bg: "#c05621", text: "#ffffff", initial: "G"  },
  business:        { label: "商业",   bg: "#92400e", text: "#ffffff", initial: "B"  },
  column:          { label: "专栏",   bg: "#5b21b6", text: "#ffffff", initial: "专" },
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface Employee {
  id: string;
  display_name: string;
  role_template: string;
  status: string;
  joined_day: number;
  left_day: number | null;
  agent_handle: string;
  daily_salary: number | null;
}

interface OrgRelation {
  id: string;
  superior_id: string;
  subordinate_id: string;
  effective_from: number;
}

interface OrgChange {
  day: number;
  seq: number;
  content: string;
  actor_name: string;
}

// ─── Agent node card ──────────────────────────────────────────────────────────

function AgentNode({ employee, size = "md" }: { employee: Employee; size?: "sm" | "md" }) {
  const style = ROLE_STYLE[employee.role_template] ?? { label: employee.role_template, bg: "#6b7280", text: "#ffffff", initial: "?" };
  return (
    <Link
      href={`/dashboard/employees/${employee.id}`}
      className="group block rounded-lg border border-rule bg-white p-4 transition-all hover:border-cobalt/40 hover:shadow-sm"
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div
          className={`shrink-0 flex items-center justify-center rounded-full font-bold text-white ${size === "sm" ? "h-9 w-9 text-sm" : "h-12 w-12 text-lg"}`}
          style={{ backgroundColor: style.bg }}
        >
          {style.initial}
        </div>
        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-bold text-sm group-hover:text-cobalt transition-colors">{employee.display_name}</span>
            <AgentWorkLabel agentHandle={employee.agent_handle} />
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${employee.status === "active" ? "bg-mint/15 text-green-700" : "bg-rule text-ink/50"}`}>
              {employee.status === "active" ? "在职" : "离职"}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-xs text-ink/50">
            <span className="rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ backgroundColor: style.bg + "1a", color: style.bg }}>{style.label}</span>
            <span>Day {employee.joined_day} 入职</span>
            {employee.daily_salary != null && (
              <span className="font-mono text-[10px] text-cobalt">¥{employee.daily_salary}/天</span>
            )}
          </div>
          <p className="mt-1.5 font-mono text-[10px] text-ink/35">@{employee.agent_handle}</p>
        </div>
        <span className="shrink-0 text-xs text-cobalt opacity-0 group-hover:opacity-100 transition-opacity">详情 →</span>
      </div>
    </Link>
  );
}

// ─── Board virtual node ───────────────────────────────────────────────────────

function BoardNode() {
  return (
    <div className="rounded-lg border-2 border-[#d97706] bg-[#fffbe8] p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#d97706] text-lg font-bold text-white">董</div>
        <div>
          <p className="font-bold text-sm">董事会</p>
          <p className="mt-0.5 text-xs text-ink/55">每 7 天触发 · 人类决策主体</p>
          <p className="mt-1 font-mono text-[10px] text-ink/35">@board</p>
        </div>
      </div>
    </div>
  );
}

// ─── Tree connector ────────────────────────────────────────────────────────────

function Connector() {
  return (
    <div className="flex justify-center">
      <div className="w-px h-8 bg-rule" />
    </div>
  );
}

function HorizontalBranch({ count }: { count: number }) {
  if (count <= 1) return <div className="flex justify-center"><div className="w-px h-4 bg-rule" /></div>;
  return (
    <div className="flex justify-center">
      <div className="relative w-full max-w-2xl">
        {/* vertical from parent */}
        <div className="absolute left-1/2 top-0 w-px h-4 bg-rule -translate-x-1/2" />
        {/* horizontal bar */}
        <div className="absolute top-4 left-[20%] right-[20%] h-px bg-rule" style={{ left: count === 2 ? "30%" : "20%", right: count === 2 ? "30%" : "20%" }} />
        {/* verticals to children — rendered per child node */}
        <div className="h-8" />
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function OrgPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  const days = await listDays();
  const query = await searchParams;
  const day = Number(query.day ?? days[0]?.day ?? 1);

  // Filter employees active on the selected day
  const employees = await dbAll<Employee>(
    `SELECT id, display_name, role_template, status, joined_day, left_day, agent_handle, daily_salary
     FROM employees
     WHERE joined_day <= ?
       AND (left_day IS NULL OR left_day > ?)
     ORDER BY joined_day, id`,
    day,
    day,
  );

  // Org relations effective on selected day
  const relations = await dbAll<OrgRelation>(
    "SELECT id, superior_id, subordinate_id, effective_from FROM org_relations WHERE effective_from <= ? ORDER BY effective_from",
    day,
  );

  const orgChanges = await dbAll<OrgChange>(
    "SELECT day, seq, substr(content,1,200) AS content, actor_name FROM work_events WHERE event_type='org_change' AND day <= ? ORDER BY day DESC, seq DESC LIMIT 20",
    day,
  );

  // Build parent → children map
  const childrenOf = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const rel of relations) {
    const arr = childrenOf.get(rel.superior_id) ?? [];
    arr.push(rel.subordinate_id);
    childrenOf.set(rel.superior_id, arr);
    hasParent.add(rel.subordinate_id);
  }

  const empById = new Map(employees.map((e) => [e.id, e]));

  // Identify root and children
  const root = employees.find((e) => !hasParent.has(e.id) && e.role_template === "editor_in_chief")
    ?? employees.find((e) => !hasParent.has(e.id));

  const directChildren = root ? (childrenOf.get(root.id) ?? []).map((cid) => empById.get(cid)).filter(Boolean) as Employee[] : [];

  // Employees not in any relation and not root
  const orphans = employees.filter((e) => e.id !== root?.id && !hasParent.has(e.id) && e.id !== "board");

  // All children displayed below root (formal + orphans)
  const allChildren = [...directChildren, ...orphans.filter((o) => !directChildren.find((c) => c.id === o.id))];

  return (
    <OrgWorkStatusProvider>
      <div className="h-full overflow-y-auto">
      {/* Header */}
      <header className="border-b border-rule bg-white px-6 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <LayoutGrid className="h-5 w-5 text-ink/50" />
            <div>
              <h1 className="font-black text-lg">组织架构</h1>
              <p className="text-xs text-ink/50">{employees.length} 名 Agent 在职 · {dayToShortDate(day)}</p>
            </div>
          </div>
          <span className="rounded bg-ink/5 px-2.5 py-1 text-xs text-ink/50">Day {day} 快照</span>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-8 space-y-10">
        {/* Visual org chart */}
        <section>
          <h2 className="mb-5 text-xs font-bold uppercase tracking-widest text-ink/40">汇报关系</h2>

          <div className="space-y-0">
            {/* Board */}
            <div className="mx-auto max-w-xs">
              <BoardNode />
            </div>
            <Connector />

            {/* Root (editor-in-chief) */}
            {root && (
              <div className="mx-auto max-w-xs">
                <AgentNode employee={root} />
              </div>
            )}

            {/* Children */}
            {allChildren.length > 0 && (
              <>
                <div className="flex justify-center">
                  <div className="relative w-full max-w-2xl px-4">
                    <div className="absolute left-1/2 top-0 w-px h-4 bg-rule -translate-x-1/2" />
                    {allChildren.length > 1 && (
                      <div
                        className="absolute top-4 h-px bg-rule"
                        style={{
                          left: `${100 / (allChildren.length * 2)}%`,
                          right: `${100 / (allChildren.length * 2)}%`,
                        }}
                      />
                    )}
                    <div className="h-8" />
                  </div>
                </div>
                <div
                  className="grid gap-4 px-4"
                  style={{ gridTemplateColumns: `repeat(${Math.min(allChildren.length, 3)}, 1fr)` }}
                >
                  {allChildren.map((child) => (
                    <div key={child.id} className="relative">
                      <div className="flex justify-center mb-0">
                        <div className="w-px h-0 bg-rule" />
                      </div>
                      <AgentNode employee={child} size="sm" />
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>

        {/* Formal relations */}
        {relations.length > 0 && (
          <section>
            <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-ink/40">正式汇报关系</h2>
            <div className="rounded-lg border border-rule bg-white divide-y divide-rule/40">
              {relations.map((rel) => {
                const sup = empById.get(rel.superior_id);
                const sub = empById.get(rel.subordinate_id);
                return (
                  <div key={rel.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                    <span className="font-medium">{sup?.display_name ?? rel.superior_id}</span>
                    <span className="text-ink/30">→ 管理 →</span>
                    <span className="font-medium">{sub?.display_name ?? rel.subordinate_id}</span>
                    <span className="ml-auto text-xs text-ink/40">Day {rel.effective_from} 起</span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* All employees detail list */}
        <section>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-ink/40">全部成员</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {employees.map((emp) => (
              <AgentNode key={emp.id} employee={emp} />
            ))}
          </div>
        </section>

        {/* Talent market reference */}
        <section>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-ink/40">人才市场参考薪资</h2>
          <div className="rounded-lg border border-rule bg-white divide-y divide-rule/40">
            {[
              { role: "editor_in_chief", label: "总编辑", salary: 500 },
              { role: "editor", label: "编辑", salary: 300 },
              { role: "growth", label: "增长 Agent", salary: 350 },
              { role: "business", label: "商业 Agent", salary: 400 },
              { role: "column", label: "专栏 Agent", salary: 380 },
            ].map(item => {
              const style = ROLE_STYLE[item.role] ?? { bg: "#6b7280", label: item.label };
              return (
                <div key={item.role} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="rounded px-2 py-0.5 text-[10px] font-bold" style={{ backgroundColor: style.bg + "1a", color: style.bg }}>{style.label}</span>
                  </div>
                  <span className="font-mono text-sm text-cobalt font-bold">¥{item.salary} / 天</span>
                </div>
              );
            })}
          </div>
        </section>

        {/* Org changes timeline */}
        {orgChanges.length > 0 && (
          <section>
            <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-ink/40">组织变更历史</h2>
            <div className="rounded-lg border border-rule bg-white divide-y divide-rule/40">
              {orgChanges.map((change, i) => (
                <div key={i} className="flex gap-3 px-4 py-3">
                  <span className="shrink-0 text-xs font-bold text-ink/35 pt-0.5">D{change.day}</span>
                  <p className="text-sm text-ink/75">{change.content}</p>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
      </div>
    </OrgWorkStatusProvider>
  );
}
