import { listDays } from "@/db/sim";
import { getSimDb } from "@/db/connection";
import type { DaySummary } from "@/lib/types";

export const dynamic = "force-dynamic";

// ─── SVG sparkline ────────────────────────────────────────────────────────────

function Sparkline({ values, color, fill }: { values: number[]; color: string; fill?: string }) {
  if (values.length < 2) return null;
  const W = 200, H = 48;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W;
    const y = H - 4 - ((v - min) / range) * (H - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const lineD = `M ${pts.join(" L ")}`;
  const areaD = `${lineD} L ${W},${H} L 0,${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-12 w-full" preserveAspectRatio="none">
      {fill && <path d={areaD} fill={fill} />}
      <path d={lineD} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {/* last point dot */}
      {pts[pts.length - 1] && (
        <circle cx={pts[pts.length - 1]!.split(",")[0]} cy={pts[pts.length - 1]!.split(",")[1]}
          r="3" fill={color} />
      )}
    </svg>
  );
}

// ─── Bar chart ────────────────────────────────────────────────────────────────

function BarChart({ data, color }: { data: { label: string; value: number }[]; color: string }) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div className="flex h-20 items-end gap-0.5">
      {data.map(({ label, value }) => (
        <div key={label} className="group relative flex flex-1 flex-col items-center gap-0.5">
          <div
            className="w-full rounded-t-sm transition-all"
            style={{ height: `${Math.max((value / max) * 100, 4)}%`, backgroundColor: color }}
          />
          <span className="text-[9px] text-ink/35">{label}</span>
          {/* tooltip */}
          <span className="pointer-events-none absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-ink px-1.5 py-0.5 text-[10px] text-paper opacity-0 group-hover:opacity-100">
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Metric card ─────────────────────────────────────────────────────────────

function MetricCard({
  label, value, sub, delta, color, sparkValues,
}: {
  label: string; value: string; sub?: string; delta?: number;
  color: string; sparkValues: number[];
}) {
  return (
    <div className="rounded-lg border border-rule bg-white p-5">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <p className="text-xs text-ink/40">{label}</p>
          <p className="mt-0.5 text-2xl font-black" style={{ color }}>{value}</p>
          {sub && <p className="text-xs text-ink/40">{sub}</p>}
        </div>
        {delta != null && (
          <span className={`rounded px-2 py-0.5 text-xs font-bold ${delta >= 0 ? "bg-mint/15 text-green-700" : "bg-coral/10 text-coral"}`}>
            {delta >= 0 ? "+" : ""}{delta}
          </span>
        )}
      </div>
      <Sparkline values={sparkValues} color={color} fill={`${color}18`} />
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const days: DaySummary[] = listDays().reverse(); // ascending for charts
  const latest = days[days.length - 1];
  const prev   = days[days.length - 2];

  const db = getSimDb();
  const agentCount = (db.prepare("SELECT COUNT(*) AS c FROM employees WHERE status='active'").get() as { c: number }).c;
  const articleCount = (db.prepare("SELECT COUNT(*) AS c FROM published_articles").get() as { c: number }).c;
  const eventCount = (db.prepare("SELECT COUNT(*) AS c FROM work_events").get() as { c: number }).c;

  if (!latest) {
    return (
      <div className="flex h-full items-center justify-center overflow-y-auto text-ink/40">
        <p className="text-sm">暂无模拟数据，点击「运行 1 天」开始。</p>
      </div>
    );
  }

  const dauValues  = days.map(d => d.dau);
  const capValues  = days.map(d => d.capital);
  const repValues  = days.map(d => d.reputation);
  const subValues  = days.map(d => d.subscribers);

  // bar chart: articles per day (last 14)
  const articleByDay = days.slice(-14).map(d => ({ label: `D${d.day}`, value: d.articleCount ?? 0 }));

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-black">AGI Daily 公司概览</h1>
        <p className="mt-0.5 text-sm text-ink/50">
          已运行 {days.length} 天 · {agentCount} 名 Agent · {articleCount} 篇文章 · {eventCount} 条工作事件
        </p>
      </div>

      {/* 4 metric cards */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <MetricCard
          label="Capital" color="#254edb"
          value={`¥${Math.round(latest.capital).toLocaleString()}`}
          delta={prev ? Math.round(latest.capital - prev.capital) : undefined}
          sparkValues={capValues}
        />
        <MetricCard
          label="DAU" color="#2e9e6b"
          value={latest.dau.toLocaleString()}
          delta={prev ? latest.dau - prev.dau : undefined}
          sparkValues={dauValues}
        />
        <MetricCard
          label="Reputation" color="#c05621"
          value={latest.reputation.toFixed(1)}
          sub="/100"
          delta={prev ? Number((latest.reputation - prev.reputation).toFixed(1)) : undefined}
          sparkValues={repValues}
        />
        <MetricCard
          label="订阅数" color="#6b7280"
          value={latest.subscribers.toLocaleString()}
          delta={prev ? latest.subscribers - prev.subscribers : undefined}
          sparkValues={subValues}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Articles per day */}
        <div className="rounded-lg border border-rule bg-white p-5">
          <p className="mb-3 text-xs font-bold uppercase tracking-widest text-ink/40">每日文章数</p>
          {articleByDay.length > 0
            ? <BarChart data={articleByDay} color="#254edb" />
            : <p className="text-sm text-ink/40">暂无数据</p>}
        </div>

        {/* Revenue history */}
        <div className="rounded-lg border border-rule bg-white p-5">
          <p className="mb-1 text-xs font-bold uppercase tracking-widest text-ink/40">广告收入趋势</p>
          <p className="mb-3 text-xl font-black text-mint">¥{latest.adRevenue?.toFixed(2) ?? "—"} <span className="text-sm font-normal text-ink/40">今日</span></p>
          <Sparkline values={days.map(d => d.adRevenue ?? 0)} color="#2e9e6b" fill="#2e9e6b18" />
        </div>
      </div>

      {/* Day summary table */}
      <div className="rounded-lg border border-rule bg-white overflow-hidden">
        <div className="border-b border-rule px-5 py-3">
          <p className="text-xs font-bold uppercase tracking-widest text-ink/40">每期概况</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#f8f7f4] text-xs">
              <tr>
                {["期次","DAU","Capital","Reputation","订阅","文章","收入","LLM成本","特殊"].map(h => (
                  <th key={h} className="px-4 py-2 text-left font-bold text-ink/50">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-rule/40">
              {[...days].reverse().map(d => (
                <tr key={d.day} className="hover:bg-[#f8f7f4] transition-colors">
                  <td className="px-4 py-2">
                    <a href={`/dashboard/work?day=${d.day}`} className="font-bold text-cobalt hover:underline">
                      {d.isBoardDay ? "★ " : ""}Day {d.day}
                    </a>
                  </td>
                  <td className="px-4 py-2 tabular-nums">{d.dau.toLocaleString()}</td>
                  <td className="px-4 py-2 tabular-nums">¥{Math.round(d.capital).toLocaleString()}</td>
                  <td className="px-4 py-2 tabular-nums">{d.reputation.toFixed(1)}</td>
                  <td className="px-4 py-2 tabular-nums">{d.subscribers.toLocaleString()}</td>
                  <td className="px-4 py-2 tabular-nums">{d.articleCount ?? 0}</td>
                  <td className="px-4 py-2 tabular-nums text-mint">¥{(d.adRevenue ?? 0).toFixed(2)}</td>
                  <td className="px-4 py-2 tabular-nums text-coral">¥{(d.llmCost ?? 0).toFixed(4)}</td>
                  <td className="px-4 py-2">
                    {d.isBoardDay && <span className="rounded bg-signal/25 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">董事会</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
