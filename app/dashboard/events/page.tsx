import { AdminShell, WorkEventCard } from "@/components/admin-shell";
import { listDays, listWorkEvents } from "@/db/sim";

export const dynamic = "force-dynamic";

export default async function EventsPage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const query = await searchParams;
  const days = await listDays();
  const day = Number(query.day ?? days[0]?.day ?? 1);
  const events = await listWorkEvents(day);
  return (
    <AdminShell title="工作事件流" subtitle="按 seq 还原当天 Agent 协作过程，事件可穿透到影响面。">
      <div className="mb-4 flex flex-wrap gap-2">
        {days.map((item) => <a key={item.day} className="border border-rule bg-white px-3 py-2 text-sm" href={`/dashboard/events?day=${item.day}`}>Day {item.day}</a>)}
      </div>
      <div className="space-y-3">
        {events.map((event) => (
          <WorkEventCard key={event.id} event={event} />
        ))}
      </div>
    </AdminShell>
  );
}
