import Link from "next/link";
import { HumanData, WorkEventCard } from "@/components/admin-shell";
import { getLayerDay, listDays } from "@/db/sim";
import type { LayerName } from "@/lib/types";

export const dynamic = "force-dynamic";

const layerMeta: Record<LayerName, { title: string; accent: string }> = {
  mission: { title: "使命层", accent: "border-cobalt" },
  environment: { title: "能力层", accent: "border-mint" },
  memory: { title: "记忆层", accent: "border-[#7c3aed]" },
  structure: { title: "组织层", accent: "border-coral" },
  rules: { title: "规则层", accent: "border-[#dc2626]" },
  resource: { title: "资源织网", accent: "border-signal" },
  growth: { title: "生长协议", accent: "border-[#0891b2]" },
};

export default async function LayerPage({ params, searchParams }: { params: Promise<{ layer: string }>; searchParams: Promise<{ day?: string }> }) {
  const { layer } = await params;
  if (!Object.keys(layerMeta).includes(layer)) {
    return <main className="min-h-screen bg-paper p-8 text-ink">Unknown layer.</main>;
  }
  const days = listDays();
  const query = await searchParams;
  const day = Number(query.day ?? days[0]?.day ?? 1);
  const dto = getLayerDay(layer as LayerName, day);
  const meta = layerMeta[layer as LayerName];

  return (
    <main className="min-h-screen bg-[#f4f6f1] text-ink">
      <header className="border-b border-ink bg-ink px-6 py-5 text-paper">
        <Link className="text-sm text-paper/70 hover:text-paper" href="/dashboard">← 返回控制台</Link>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.28em] text-signal">layer asset</p>
            <h1 className="text-3xl font-bold">{meta.title} · Day {day}</h1>
          </div>
          <nav className="flex flex-wrap gap-2 text-sm">
            {days.map((item) => (
              <Link key={item.day} className={`border px-3 py-2 ${item.day === day ? "border-signal bg-signal text-ink" : "border-paper/40"}`} href={`/dashboard/layers/${layer}?day=${item.day}`}>
                Day {item.day}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <section className="grid gap-5 p-6 lg:grid-cols-[1fr_1fr]">
        <Panel title="快照" accent={meta.accent}>
          <HumanData value={dto.snapshot} />
        </Panel>
        <Panel title="当天变更" accent={meta.accent}>
          <div className="space-y-3">
            {dto.changes.map((change) => (
              <article key={change.id} className="border border-rule bg-white p-3">
                <div className="flex justify-between gap-3 text-xs text-ink/60">
                  <span>{change.changeType} · {change.entityTable}</span>
                  <span>{change.causedBy?.actorName ?? "unknown"}</span>
                </div>
                <p className="mt-2 text-sm">{change.summary}</p>
                {change.causedBy ? <Link className="mt-2 inline-block text-xs font-bold text-cobalt" href={`/api/work-events/${change.causedBy.id}/impact`}>查看事件影响</Link> : null}
              </article>
            ))}
            {!dto.changes.length ? <p className="text-sm text-ink/60">当天暂无变更。</p> : null}
          </div>
        </Panel>
        <Panel title="来源事件" accent={meta.accent}>
          <div className="space-y-3">
            {dto.events.map((event) => (
              <WorkEventCard key={event.id} event={event} />
            ))}
            {!dto.events.length ? <p className="text-sm text-ink/60">当天暂无来源事件。</p> : null}
          </div>
        </Panel>
      </section>
    </main>
  );
}

function Panel({ title, accent, children }: { title: string; accent: string; children: React.ReactNode }) {
  return (
    <section className={`border-t-4 ${accent} bg-[#fbfbf8] p-4 shadow-sm`}>
      <h2 className="mb-4 text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}
