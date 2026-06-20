import { AdminShell, HumanData, Panel, WorkEventCard } from "@/components/admin-shell";
import { getLayerDay, listDays } from "@/db/sim";

export const dynamic = "force-dynamic";

export default async function SettlementPage({ params }: { params: Promise<{ day: string }> }) {
  const { day: rawDay } = await params;
  const day = Number(rawDay);
  const resource = getLayerDay("resource", day);
  return (
    <AdminShell title={`日结报告 · Day ${day}`} subtitle="收入、成本、指标变化和来源事件的标准化复盘。">
      <div className="mb-4 flex flex-wrap gap-2">{listDays().map((item) => <a className="border border-rule bg-white px-3 py-2 text-sm" href={`/dashboard/settlement/${item.day}`} key={item.day}>Day {item.day}</a>)}</div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="资源快照"><HumanData value={resource.snapshot} /></Panel>
        <Panel title="变化因子"><HumanData value={resource.changes.map((change) => ({ 指标变化: change.summary, 来源员工: change.causedBy?.actorName, 来源事件: change.causedBy?.content }))} /></Panel>
        <Panel title="来源事件" className="lg:col-span-2">
          <div className="space-y-3">{resource.events.map((event) => <WorkEventCard key={event.id} event={event} />)}</div>
        </Panel>
      </div>
    </AdminShell>
  );
}
