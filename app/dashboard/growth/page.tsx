import { AdminShell, HumanData, Panel, WorkEventCard } from "@/components/admin-shell";
import { getLayerDay, listDays } from "@/db/sim";
import { getSimDb } from "@/db/connection";

export const dynamic = "force-dynamic";

export default async function GrowthPage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const query = await searchParams;
  const day = Number(query.day ?? listDays()[0]?.day ?? 1);
  const growth = getLayerDay("growth", day);
  const db = getSimDb();
  return (
    <AdminShell title="Growth Protocol 控制台" subtitle="观察扩张/收缩信号、新岗位提案、决策和观察期表现。">
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="生长层快照"><HumanData value={growth.snapshot} /></Panel>
        <Panel title="观察期"><HumanData value={db.prepare("SELECT * FROM growth_observations ORDER BY day DESC").all()} /></Panel>
        <Panel title="来源事件" className="lg:col-span-2">
          <div className="space-y-3">{growth.events.map((event) => <WorkEventCard key={event.id} event={event} />)}</div>
        </Panel>
      </div>
    </AdminShell>
  );
}
