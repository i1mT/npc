import { HumanData, WorkEventCard } from "@/components/admin-shell";
import { getLayerDay, listDays } from "@/db/sim";
import { dayToShortDate } from "@/lib/dates";
import type { LayerName } from "@/lib/types";

export const dynamic = "force-dynamic";

const layerMeta: Record<LayerName, { title: string; accent: string; desc: string }> = {
  mission:     { title: "使命层",   accent: "border-cobalt",        desc: "公司使命、愿景与核心价值观" },
  environment: { title: "能力层",   accent: "border-mint",          desc: "Agent 工具权限与外部接口配置" },
  memory:      { title: "记忆层",   accent: "border-[#7c3aed]",     desc: "Agent 持久记忆与知识索引" },
  structure:   { title: "组织层",   accent: "border-coral",         desc: "团队结构与汇报关系" },
  rules:       { title: "规则层",   accent: "border-[#dc2626]",     desc: "内容规则、因果公式与触发器" },
  resource:    { title: "资源织网", accent: "border-signal",        desc: "资本、DAU、声誉等核心指标" },
  growth:      { title: "生长协议", accent: "border-[#0891b2]",     desc: "Agent 生长/收缩决策记录" },
};

export default async function LayerPage({
  params,
  searchParams,
}: {
  params: Promise<{ layer: string }>;
  searchParams: Promise<{ day?: string }>;
}) {
  const { layer } = await params;
  if (!Object.keys(layerMeta).includes(layer)) {
    return <div className="p-8 text-sm text-ink/50">未知层：{layer}</div>;
  }

  const days = listDays();
  const query = await searchParams;
  const day = Number(query.day ?? days[0]?.day ?? 1);
  const dto = getLayerDay(layer as LayerName, day);
  const meta = layerMeta[layer as LayerName];

  return (
    <div className="h-full overflow-y-auto">
      {/* Page header — no local day switcher, uses global one */}
      <div className={`border-b-4 ${meta.accent} bg-white px-6 py-4`}>
        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-ink/35">七层资产</p>
        <div className="mt-1 flex items-end justify-between">
          <div>
            <h1 className="text-xl font-black">{meta.title}</h1>
            <p className="mt-0.5 text-sm text-ink/50">{meta.desc}</p>
          </div>
          <span className="rounded bg-ink/5 px-2.5 py-1 text-xs text-ink/50">
            {dayToShortDate(day)} · Day {day}
          </span>
        </div>
      </div>

      <div className="grid gap-5 p-6 lg:grid-cols-2">
        <Panel title="当日快照" accent={meta.accent}>
          <HumanData value={dto.snapshot} />
        </Panel>
        <Panel title="当日变更" accent={meta.accent}>
          <div className="space-y-3">
            {dto.changes.map((change) => (
              <div key={change.id} className="rounded border border-rule bg-white p-3">
                <div className="flex justify-between gap-3 text-xs text-ink/60">
                  <span>{change.changeType} · {change.entityTable}</span>
                  <span>{change.causedBy?.actorName ?? "system"}</span>
                </div>
                <p className="mt-2 text-sm leading-6">{change.summary}</p>
              </div>
            ))}
            {!dto.changes.length && <p className="text-sm text-ink/40">当天暂无变更。</p>}
          </div>
        </Panel>
        <Panel title="来源事件" accent={meta.accent} className="lg:col-span-2">
          <div className="space-y-3">
            {dto.events.map((event) => (
              <WorkEventCard key={event.id} event={event} />
            ))}
            {!dto.events.length && <p className="text-sm text-ink/40">当天暂无来源事件。</p>}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Panel({ title, accent, children, className }: {
  title: string;
  accent: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border-t-4 ${accent} bg-[#fafaf8] p-4 shadow-sm ${className ?? ""}`}>
      <h2 className="mb-4 text-sm font-bold uppercase tracking-widest text-ink/50">{title}</h2>
      {children}
    </section>
  );
}
