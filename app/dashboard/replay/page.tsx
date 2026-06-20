import { AdminShell } from "@/components/admin-shell";
import { Replay } from "@/components/replay";
import { getPortalDay } from "@/domain/portal";
import { listDays } from "@/db/sim";

export const dynamic = "force-dynamic";

export default async function DashboardReplayPage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const query = await searchParams;
  const days = listDays();
  const day = Number(query.day ?? days[0]?.day ?? 1);
  return (
    <AdminShell title="前台日报回放" subtitle="按 Day 查看前台成品，并通过幕后抽屉查看七层共同作用。">
      <div className="mb-4 flex flex-wrap gap-2">
        {days.map((item) => <a key={item.day} className="border border-rule bg-white px-3 py-2 text-sm" href={`/dashboard/replay?day=${item.day}`}>Day {item.day}</a>)}
      </div>
      <div className="-m-5 md:-m-6">
        <Replay data={getPortalDay(day)} />
      </div>
    </AdminShell>
  );
}
