import type { Metadata } from "next";
import { listDays } from "@/db/sim";
import { dbAll, dbFirst } from "@/db/connection";
import { notFound } from "next/navigation";
import { dayToShortDate } from "@/lib/dates";
import { SUBSCRIPTION_DAILY_PRICE, subscriptionRevenue } from "@/simulation/formulas";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ day: string }> }): Promise<Metadata> {
  const { day } = await params;
  return {
    title: `Day ${day} 财务日报`,
    description: `查看 AGI Daily Day ${day} 的收入、成本、利润和经营指标变化。`,
  };
}
// ─── Types ────────────────────────────────────────────────────────────────────

type AgentToken = {
  actorId: string;
  actorName: string;
  totalTokens: number;
  costYuan: number;
};

type Employee = {
  id: string;
  displayName: string;
  roleTemplate: string;
  agentHandle: string;
  dailySalary: number;
  joinedDay: number;
};

type DayFinance = {
  day: number;
  adRevenue: number;
  contractAdRevenue: number;
  organicAdRevenue: number;
  subscriptionRevenue: number;
  sponsorRevenue: number;
  grossRevenue: number;
  llmCost: number;
  laborCost: number;
  fixedCost: number;
  newsletterCost: number;
  totalCost: number;
  netRevenue: number;
  capital: number;
  capitalDelta: number;
  dau: number;
  dauDelta: number;
  reputation: number;
  reputationDelta: number;
  subscribers: number;
  subscribersDelta: number;
  tokenPrice: number;
  totalTokens: number;
  agentTokens: AgentToken[];
  employees: Employee[];
  articleCount: number;
  averageQuality: number;
};

// ─── Data loader ─────────────────────────────────────────────────────────────

async function getDayFinance(day: number): Promise<DayFinance | null> {
  const dayRow = await dbFirst<{
    day: number; capital: number; reputation: number; dau: number;
    subscribers: number; ad_revenue: number; llm_cost: number;
    labor_cost: number; article_count: number;
  }>(
    `SELECT d.day, d.capital, d.reputation, d.dau, d.subscribers,
            d.ad_revenue, d.llm_cost, d.labor_cost,
            COUNT(pa.id) AS article_count
     FROM sim_days d
     LEFT JOIN published_articles pa ON pa.day = d.day
     WHERE d.day = ?
     GROUP BY d.day`,
    day,
  );

  if (!dayRow) return null;

  const prevRow = await dbFirst<{ capital: number; reputation: number; dau: number; subscribers: number }>(
    "SELECT capital, reputation, dau, subscribers FROM sim_days WHERE day = ?",
    day - 1,
  );

  const settlementRow = await dbFirst<{ revenue_breakdown: string; cost_breakdown: string }>(
    "SELECT revenue_breakdown, cost_breakdown FROM daily_settlement WHERE day = ?",
    day,
  );

  const revBD = settlementRow
    ? (JSON.parse(settlementRow.revenue_breakdown) as { ad: number; contract_ad?: number; organic_ad?: number; subscription: number; sponsorship: number; gross: number })
    : null;
  const costBD = settlementRow
    ? (JSON.parse(settlementRow.cost_breakdown) as { llm: number; fixed: number; newsletter: number; labor: number; net: number })
    : null;

  const agentTokenRows = await dbAll<{ actor_id: string; actor_name: string; total_tokens: number; cost_yuan: number }>(
    `SELECT actor_id, actor_name, SUM(cost_token) AS total_tokens, SUM(cost_yuan) AS cost_yuan
     FROM work_events WHERE day = ? AND cost_token > 0
     GROUP BY actor_id, actor_name ORDER BY total_tokens DESC`,
    day,
  );

  const TOKEN_PRICE = 0.000002;
  const agentTokens: AgentToken[] = agentTokenRows.map(r => ({
    actorId: r.actor_id,
    actorName: r.actor_name,
    totalTokens: r.total_tokens,
    costYuan: r.cost_yuan > 0 ? r.cost_yuan : Number((r.total_tokens * TOKEN_PRICE).toFixed(4)),
  }));
  const totalTokens = agentTokens.reduce((s, r) => s + r.totalTokens, 0);

  const empRows = await dbAll<{
    id: string; display_name: string; role_template: string;
    agent_handle: string; daily_salary: number; joined_day: number;
  }>(
    `SELECT id, display_name, role_template, agent_handle, daily_salary, joined_day
     FROM employees WHERE joined_day <= ? AND status = 'active' ORDER BY joined_day`,
    day,
  );

  const employees: Employee[] = empRows.map(e => ({
    id: e.id,
    displayName: e.display_name,
    roleTemplate: e.role_template,
    agentHandle: e.agent_handle,
    dailySalary: e.daily_salary,
    joinedDay: e.joined_day,
  }));

  const qualityDriver = await dbFirst<{ delta: number }>(
    "SELECT delta FROM settlement_drivers WHERE day = ? AND metric = 'dau' AND factor = 'quality_score'",
    day,
  );

  const contractAdRev   = revBD?.contract_ad  ?? 0;
  const organicAdRev    = revBD?.organic_ad   ?? (revBD?.ad ?? dayRow.ad_revenue);
  const adRevenue       = revBD?.ad           ?? dayRow.ad_revenue;
  const subscRev        = revBD?.subscription ?? subscriptionRevenue(dayRow.subscribers);
  const sponsorRev      = revBD?.sponsorship  ?? 0;
  const grossRevenue    = revBD?.gross        ?? Number((adRevenue + subscRev).toFixed(2));
  const llmCost         = costBD?.llm         ?? dayRow.llm_cost;
  const laborCost       = costBD?.labor       ?? dayRow.labor_cost;
  const fixedCost       = costBD?.fixed       ?? 18;
  const newsletterCost  = costBD?.newsletter  ?? 12;
  const totalCost       = Number((llmCost + laborCost + fixedCost + newsletterCost).toFixed(2));
  const netRevenue      = costBD?.net         ?? Number((grossRevenue - totalCost).toFixed(2));

  return {
    day,
    adRevenue,
    contractAdRevenue: contractAdRev,
    organicAdRevenue: organicAdRev,
    subscriptionRevenue: subscRev,
    sponsorRevenue: sponsorRev,
    grossRevenue,
    llmCost,
    laborCost,
    fixedCost,
    newsletterCost,
    totalCost,
    netRevenue,
    capital: dayRow.capital,
    capitalDelta: prevRow ? Number((dayRow.capital - prevRow.capital).toFixed(2)) : dayRow.capital,
    dau: dayRow.dau,
    dauDelta: prevRow ? dayRow.dau - prevRow.dau : 0,
    reputation: dayRow.reputation,
    reputationDelta: prevRow ? Number((dayRow.reputation - prevRow.reputation).toFixed(1)) : 0,
    subscribers: dayRow.subscribers,
    subscribersDelta: prevRow ? dayRow.subscribers - prevRow.subscribers : 0,
    tokenPrice: TOKEN_PRICE,
    totalTokens,
    agentTokens,
    employees,
    articleCount: dayRow.article_count,
    averageQuality: qualityDriver?.delta ?? 0,
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Delta({ v, decimals = 0 }: { v: number; decimals?: number }) {
  if (v === 0) return <span className="text-ink/30 text-xs">—</span>;
  return (
    <span className={`text-xs font-bold ${v >= 0 ? "text-green-600" : "text-red-500"}`}>
      {v >= 0 ? "+" : ""}{v.toFixed(decimals)}
    </span>
  );
}

function SectionHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="border-b border-rule bg-[#fafaf8] px-5 py-3">
      <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-ink/40">{title}</p>
      {sub && <p className="mt-0.5 text-xs text-ink/45">{sub}</p>}
    </div>
  );
}

function LineRow({ label, value, sub, bold, color, indent }: {
  label: string; value: string; sub?: string;
  bold?: boolean; color?: string; indent?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between py-2.5 ${indent ? "pl-8" : ""}`}>
      <div className="min-w-0">
        <span className={`text-sm ${bold ? "font-bold" : "text-ink/70"}`}>{label}</span>
        {sub && <span className="ml-2 text-[11px] text-ink/40">{sub}</span>}
      </div>
      <span className={`ml-4 shrink-0 font-mono text-sm ${bold ? "font-black" : "font-medium"} ${color ?? "text-ink"}`}>
        {value}
      </span>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function SettlementPage({ params }: { params: Promise<{ day: string }> }) {
  const { day: rawDay } = await params;
  const day = Number(rawDay);
  const f = await getDayFinance(day);
  if (!f) notFound();

  const allDays = await listDays();
  const isProfitable = f.netRevenue >= 0;

  return (
    <div className="h-full overflow-y-auto bg-[#f5f4f0]">
      {/* Header */}
      <header className="border-b border-rule bg-white px-6 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-black">财务日报 · Day {f.day}</h1>
              <span className={`rounded px-2 py-0.5 text-xs font-bold ${
                isProfitable ? "bg-mint/15 text-green-700" : "bg-red-50 text-red-600"
              }`}>
                {isProfitable ? "盈利" : "亏损"}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-ink/50">
              {dayToShortDate(f.day)}
              {" · "}{f.articleCount} 篇文章
              {" · "}{f.employees.length} 名员工
              {f.averageQuality > 0 && ` · 平均质量 ${f.averageQuality.toFixed(1)}/10`}
            </p>
          </div>
          <div className="flex flex-wrap gap-1">
            {allDays.map(d => (
              <a
                key={d.day}
                href={`/dashboard/settlement/${d.day}`}
                className={`rounded border px-2.5 py-1 text-xs transition-colors ${
                  d.day === day
                    ? "border-cobalt bg-cobalt text-white"
                    : "border-rule bg-white text-ink/60 hover:text-ink"
                }`}
              >
                D{d.day}
              </a>
            ))}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-4 p-6">

        {/* ─── Summary cards ─── */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: "毛收入", value: `¥${f.grossRevenue.toFixed(2)}`, color: "text-green-700", bg: "bg-green-50" },
            { label: "总成本", value: `¥${f.totalCost.toFixed(2)}`, color: "text-red-600", bg: "bg-red-50" },
            { label: "净收益", value: `${f.netRevenue >= 0 ? "+" : ""}¥${f.netRevenue.toFixed(2)}`, color: isProfitable ? "text-green-700" : "text-red-600", bg: isProfitable ? "bg-green-50" : "bg-red-50" },
            { label: "资金余额", value: `¥${Math.round(f.capital).toLocaleString()}`, color: "text-cobalt", bg: "bg-blue-50" },
          ].map(c => (
            <div key={c.label} className={`rounded-lg border border-rule ${c.bg} p-4`}>
              <p className="text-[11px] font-bold uppercase tracking-widest text-ink/40">{c.label}</p>
              <p className={`mt-1 text-2xl font-black ${c.color}`}>{c.value}</p>
            </div>
          ))}
        </div>

        {/* ─── Revenue + Cost side by side ─── */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-rule bg-white overflow-hidden">
            <SectionHead title="收入明细" sub="Gross Revenue" />
            <div className="divide-y divide-rule/30 px-5">
              <LineRow label="有机广告" value={`¥${f.organicAdRevenue.toFixed(2)}`}
                sub={`DAU ${f.dau.toLocaleString()} × CPM`} />
              {f.contractAdRevenue > 0 && (
                <LineRow label="合同广告" value={`¥${f.contractAdRevenue.toFixed(2)}`}
                  sub="商业 Agent 谈判" />
              )}
              <LineRow label="订阅收入" value={`¥${f.subscriptionRevenue.toFixed(2)}`}
                sub={`${f.subscribers.toLocaleString()} 人 × ¥${SUBSCRIPTION_DAILY_PRICE}`} />
              {f.sponsorRevenue > 0 && (
                <LineRow label="赞助收入" value={`¥${f.sponsorRevenue.toFixed(2)}`} />
              )}
              <LineRow label="毛收入合计" value={`¥${f.grossRevenue.toFixed(2)}`} bold color="text-green-700" />
            </div>
          </div>

          <div className="rounded-lg border border-rule bg-white overflow-hidden">
            <SectionHead title="成本汇总" sub="Total Cost" />
            <div className="divide-y divide-rule/30 px-5">
              <LineRow label="人力成本" value={`¥${f.laborCost.toFixed(2)}`}
                sub={`${f.employees.length} 人`} />
              <LineRow label="LLM 算力" value={`¥${f.llmCost.toFixed(4)}`}
                sub={`${f.totalTokens.toLocaleString()} tokens`} />
              <LineRow label="固定运营" value={`¥${f.fixedCost.toFixed(2)}`} sub="服务器/工具" />
              <LineRow label="简报发送" value={`¥${f.newsletterCost.toFixed(2)}`} />
              <LineRow label="总成本合计" value={`¥${f.totalCost.toFixed(2)}`} bold color="text-red-600" />
            </div>
          </div>
        </div>

        {/* ─── Labor detail ─── */}
        <div className="rounded-lg border border-rule bg-white overflow-hidden">
          <SectionHead title="人力成本明细" sub="Labor Cost — 按员工逐项列示" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-rule bg-[#fafaf8] text-[11px] font-bold uppercase tracking-wider text-ink/40">
                <tr>
                  <th className="px-5 py-2.5 text-left">员工姓名</th>
                  <th className="px-5 py-2.5 text-left">角色模板</th>
                  <th className="px-5 py-2.5 text-left">入职日</th>
                  <th className="px-5 py-2.5 text-right">日薪</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule/30">
                {f.employees.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-4 text-center text-sm text-ink/40">暂无员工数据</td>
                  </tr>
                ) : f.employees.map(e => (
                  <tr key={e.id} className="hover:bg-[#fafaf8] transition-colors">
                    <td className="px-5 py-3">
                      <a href={`/dashboard/employees/${e.id}`} className="font-bold text-cobalt hover:underline">
                        {e.displayName}
                      </a>
                      <span className="ml-2 text-[11px] text-ink/35">@{e.agentHandle}</span>
                    </td>
                    <td className="px-5 py-3 text-ink/60">{e.roleTemplate}</td>
                    <td className="px-5 py-3 text-ink/50">Day {e.joinedDay}</td>
                    <td className="px-5 py-3 text-right font-mono font-bold">¥{e.dailySalary}/天</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-rule bg-[#f5f4f0]">
                <tr>
                  <td colSpan={3} className="px-5 py-3 text-xs font-bold uppercase tracking-widest text-ink/40">
                    合计（{f.employees.length} 名员工）
                  </td>
                  <td className="px-5 py-3 text-right font-mono font-black text-red-600">
                    ¥{f.laborCost.toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* ─── LLM Token detail ─── */}
        <div className="rounded-lg border border-rule bg-white overflow-hidden">
          <SectionHead
            title="LLM 算力成本明细"
            sub={`按 Agent 逐项列示 · 单价 ¥${f.tokenPrice.toFixed(6)}/token`}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-rule bg-[#fafaf8] text-[11px] font-bold uppercase tracking-wider text-ink/40">
                <tr>
                  <th className="px-5 py-2.5 text-left">Agent</th>
                  <th className="px-5 py-2.5 text-right">消耗 Tokens</th>
                  <th className="px-5 py-2.5 text-right">占比</th>
                  <th className="px-5 py-2.5 text-right">折合费用</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule/30">
                {f.agentTokens.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-4 text-center text-sm text-ink/40">
                      暂无 Token 消耗记录
                    </td>
                  </tr>
                ) : f.agentTokens.map(a => {
                  const pct = f.totalTokens > 0 ? (a.totalTokens / f.totalTokens) * 100 : 0;
                  return (
                    <tr key={a.actorId} className="hover:bg-[#fafaf8] transition-colors">
                      <td className="px-5 py-3">
                        <span className="font-bold">{a.actorName}</span>
                        <span className="ml-2 text-[11px] text-ink/35">{a.actorId}</span>
                      </td>
                      <td className="px-5 py-3 text-right font-mono">{a.totalTokens.toLocaleString()}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-rule">
                            <div className="h-full rounded-full bg-cobalt/50" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="w-12 text-right text-xs tabular-nums text-ink/50">{pct.toFixed(1)}%</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right font-mono">¥{a.costYuan.toFixed(4)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t-2 border-rule bg-[#f5f4f0]">
                <tr>
                  <td className="px-5 py-3 text-xs font-bold uppercase tracking-widest text-ink/40">合计</td>
                  <td className="px-5 py-3 text-right font-mono font-bold">{f.totalTokens.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right text-xs text-ink/40">100%</td>
                  <td className="px-5 py-3 text-right font-mono font-black text-red-600">
                    ¥{f.llmCost.toFixed(4)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="border-t border-rule bg-[#fafaf8] px-5 py-2.5">
            <p className="text-[11px] text-ink/40">
              计价规则：¥{f.tokenPrice.toFixed(6)}/token（模拟定价）·
              {" "}{f.totalTokens.toLocaleString()} tokens × ¥{f.tokenPrice.toFixed(6)} = ¥{f.llmCost.toFixed(4)}
            </p>
          </div>
        </div>

        {/* ─── P&L Statement ─── */}
        <div className="rounded-lg border border-rule bg-white overflow-hidden">
          <SectionHead title="利润表 P&L Statement" />
          <div className="divide-y divide-rule/30 px-5">
            <div className="py-0.5" />
            <LineRow label="广告收入" value={`¥${f.adRevenue.toFixed(2)}`} indent />
            <LineRow label="订阅收入" value={`¥${f.subscriptionRevenue.toFixed(2)}`} indent />
            {f.sponsorRevenue > 0 && <LineRow label="赞助收入" value={`¥${f.sponsorRevenue.toFixed(2)}`} indent />}
            <LineRow label="A · 毛收入" value={`¥${f.grossRevenue.toFixed(2)}`} bold color="text-green-700" />
            <div className="py-0.5" />
            <LineRow label="员工人力成本" value={`− ¥${f.laborCost.toFixed(2)}`} indent color="text-red-500" />
            <LineRow label="LLM 算力成本" value={`− ¥${f.llmCost.toFixed(4)}`} indent color="text-red-500" />
            <LineRow label="固定运营成本" value={`− ¥${f.fixedCost.toFixed(2)}`} indent color="text-red-500" />
            <LineRow label="简报发送成本" value={`− ¥${f.newsletterCost.toFixed(2)}`} indent color="text-red-500" />
            <LineRow label="B · 总成本" value={`− ¥${f.totalCost.toFixed(2)}`} bold color="text-red-600" />
            <div className="py-0.5" />
            <div className="flex items-center justify-between border-t-2 border-ink/10 py-3">
              <span className="font-black">净收益 (A − B)</span>
              <span className={`font-mono text-xl font-black ${isProfitable ? "text-green-700" : "text-red-600"}`}>
                {f.netRevenue >= 0 ? "+" : ""}¥{f.netRevenue.toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* ─── Metrics delta ─── */}
        <div className="rounded-lg border border-rule bg-white overflow-hidden">
          <SectionHead title="经营指标变化" sub="今日结算值 vs 昨日" />
          <div className="grid grid-cols-2 gap-px bg-rule md:grid-cols-4">
            {[
              { label: "资金余额", value: `¥${Math.round(f.capital).toLocaleString()}`, delta: f.capitalDelta, dec: 0 },
              { label: "日活用户 DAU", value: f.dau.toLocaleString(), delta: f.dauDelta, dec: 0 },
              { label: "声誉值", value: `${f.reputation.toFixed(1)}/100`, delta: f.reputationDelta, dec: 1 },
              { label: "订阅人数", value: f.subscribers.toLocaleString(), delta: f.subscribersDelta, dec: 0 },
            ].map(m => (
              <div key={m.label} className="bg-white p-5">
                <p className="text-[11px] font-bold uppercase tracking-widest text-ink/35">{m.label}</p>
                <p className="mt-1 text-xl font-black">{m.value}</p>
                <div className="mt-1"><Delta v={m.delta} decimals={m.dec} /></div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
