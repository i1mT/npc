import type { Metadata } from "next";
import { AdminShell, HumanData, Panel, WorkEventCard } from "@/components/admin-shell";
import { getLayerDay, listDays } from "@/db/sim";
import { dbAll } from "@/db/connection";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "生长协议",
  description: "观察 AGI Daily 的扩张、收缩、新岗位提案和观察期表现。",
};

export default async function GrowthPage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const query = await searchParams;
  const days = await listDays();
  const day = Number(query.day ?? days[0]?.day ?? 1);
  const [growth, observations] = await Promise.all([
    getLayerDay("growth", day),
    dbAll("SELECT * FROM growth_observations ORDER BY day DESC"),
  ]);
  return (
    <AdminShell title="生长协议控制台" subtitle="观察扩张/收缩信号、新岗位提案、决策和观察期表现。">
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="生长层快照"><HumanData value={growth.snapshot} /></Panel>
        <Panel title="观察期"><HumanData value={observations} /></Panel>
        <Panel title="来源事件" className="lg:col-span-2">
          <div className="space-y-3">{growth.events.map((event) => <WorkEventCard key={event.id} event={event} />)}</div>
        </Panel>
      </div>
    </AdminShell>
  );
}
