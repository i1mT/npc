import type { Metadata } from "next";
import { TOOL_META, TOOL_GRANTS_BY_ROLE } from "@/mastra/tools/npc-tools";
import type { ToolName } from "@/mastra/tools/npc-tools";
import { EvoMapConnectPanel } from "@/components/evomap-connect-panel";
import Link from "next/link";
import { ArrowLeft, Wrench } from "lucide-react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "工具目录",
  description: "查看 AGI Daily Agent 可调用工具、角色权限和 EvoMap 连接状态。",
};

const CATEGORY_ORDER = ["EvoMap 进化能力", "内容", "数据", "记忆", "组织", "治理", "商业"];
const CATEGORY_COLOR: Record<string, string> = {
  "EvoMap 进化能力": "bg-cyan-100 text-cyan-800",
  内容: "bg-cobalt/10 text-cobalt",
  数据: "bg-mint/15 text-green-700",
  记忆: "bg-purple-100 text-purple-700",
  组织: "bg-amber-100 text-amber-700",
  治理: "bg-coral/10 text-coral",
  商业: "bg-slate-100 text-slate-700",
};

const ROLE_LABEL: Record<string, string> = {
  ceo: "CEO", editor_in_chief: "总编", editor: "编辑",
  growth: "增长", business: "商业", column: "专栏",
};
const ROLE_COLOR: Record<string, string> = {
  ceo: "bg-ink/10 text-ink",
  editor_in_chief: "bg-cobalt/10 text-cobalt",
  editor: "bg-mint/10 text-green-700",
  growth: "bg-orange-100 text-orange-700",
  business: "bg-amber-100 text-amber-700",
  column: "bg-purple-100 text-purple-700",
};

export default function ToolsPage() {
  const byCategory = CATEGORY_ORDER.map(cat => ({
    category: cat,
    tools: (Object.entries(TOOL_META) as [ToolName, (typeof TOOL_META)[ToolName]][])
      .filter(([, m]) => m.category === cat),
  })).filter(g => g.tools.length > 0);

  const totalTools = Object.keys(TOOL_META).length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="border-b border-rule bg-white px-6 py-2.5">
        <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-xs text-ink/50 hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" /> 后台首页
        </Link>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-8 space-y-8">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-ink/5">
            <Wrench className="h-5 w-5 text-ink/60" />
          </div>
          <div>
            <h1 className="text-xl font-black">工具目录</h1>
            <p className="text-xs text-ink/45 mt-0.5">共 {totalTools} 个工具，按角色权限分配给不同 Agent</p>
          </div>
        </div>

        <EvoMapConnectPanel />

        {/* Role permission matrix */}
        <section>
          <h2 className="text-xs font-bold uppercase tracking-widest text-ink/40 mb-3">角色权限矩阵</h2>
          <div className="rounded-lg border border-rule bg-white overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-rule">
                  <th className="text-left px-4 py-2.5 font-bold text-ink/50 min-w-[160px]">工具</th>
                  {Object.keys(ROLE_LABEL).map(r => (
                    <th key={r} className="px-3 py-2.5 text-center font-bold text-ink/50">{ROLE_LABEL[r]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(Object.entries(TOOL_META) as [ToolName, (typeof TOOL_META)[ToolName]][]).map(([name, meta]) => (
                  <tr key={name} className="border-b border-rule/50 last:border-0 hover:bg-ink/2">
                    <td className="px-4 py-2">
                      <a href={`#${name}`} className="font-mono text-[11px] text-cobalt hover:underline">{name}</a>
                      <p className="text-ink/40 text-[10px] mt-0.5 leading-4">{meta.displayName}</p>
                    </td>
                    {Object.keys(ROLE_LABEL).map(role => {
                      const granted = (TOOL_GRANTS_BY_ROLE[role] ?? []).includes(name);
                      return (
                        <td key={role} className="px-3 py-2 text-center">
                          {granted ? <span className="text-mint font-bold">✓</span> : <span className="text-ink/15">·</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Tool cards by category */}
        {byCategory.map(({ category, tools }) => (
          <section key={category}>
            <div className="flex items-center gap-2 mb-3">
              <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${CATEGORY_COLOR[category] ?? "bg-ink/5 text-ink/50"}`}>
                {category}
              </span>
              <span className="text-xs text-ink/30">{tools.length} 个工具</span>
            </div>
            <div className="space-y-3">
              {tools.map(([name, meta]) => (
                <div key={name} id={name} className="rounded-lg border border-rule bg-white p-4 scroll-mt-4">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <code className="text-sm font-black font-mono text-ink">{name}()</code>
                        <span className="text-sm text-ink/50">{meta.displayName}</span>
                      </div>
                      <p className="text-sm text-ink/70 leading-6">{meta.description}</p>
                    </div>
                    <div className="flex flex-wrap gap-1 shrink-0">
                      {meta.rolesWithAccess.map(role => (
                        <span key={role} className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${ROLE_COLOR[role] ?? "bg-ink/5 text-ink/50"}`}>
                          {ROLE_LABEL[role] ?? role}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
