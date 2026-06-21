import { AdminShell, HumanData, Panel } from "@/components/admin-shell";
import { dbAll } from "@/db/connection";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const [meetings, directives] = await Promise.all([
    dbAll<{ day: number; status: string; weekly_report: string; directive?: string | null; suspended_at: string; resumed_at?: string | null }>("SELECT * FROM board_meetings ORDER BY day DESC"),
    dbAll<{ id: string; day: number; directive: string; applied_at: string }>("SELECT * FROM board_directives ORDER BY day DESC, applied_at DESC"),
  ]);
  return (
    <AdminShell title="董事会记录" subtitle="查看每 7 天挂起、周报、指令和 resume 状态。">
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Board Workflow">
          <div className="space-y-3">
            {meetings.map((meeting) => {
              const report = safeParse(meeting.weekly_report);
              return (
                <article key={meeting.day} className="border border-rule bg-[#fbfbf8] p-3">
                  <div className="flex justify-between text-sm"><strong>Day {meeting.day}</strong><span>{meeting.status}</span></div>
                  <p className="mt-2 text-sm">{String(report.summary ?? "暂无周报摘要")}</p>
                  <p className="mt-1 text-xs text-ink/55">挂起：{meeting.suspended_at}{meeting.resumed_at ? ` · 恢复：${meeting.resumed_at}` : ""}</p>
                  {meeting.directive ? <p className="mt-2 text-sm"><strong>指令：</strong>{meeting.directive}</p> : null}
                </article>
              );
            })}
            {!meetings.length ? <p className="text-sm text-ink/55">暂无董事会记录。</p> : null}
          </div>
        </Panel>
        <Panel title="董事会指令"><HumanData value={directives.map((item) => ({ Day: item.day, 指令: item.directive, 时间: item.applied_at }))} /></Panel>
      </div>
    </AdminShell>
  );
}

function safeParse(value: string) {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}
