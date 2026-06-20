import { AdminShell, HumanData, Panel } from "@/components/admin-shell";
import { getLayerDay, listDays } from "@/db/sim";

export const dynamic = "force-dynamic";

export default async function OrgPage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const query = await searchParams;
  const days = listDays();
  const day = Number(query.day ?? days[0]?.day ?? 1);
  const dto = getLayerDay("structure", day);
  const snapshot = Object.values(dto.snapshot)[0] as { employees?: { id: string; display_name: string; role_template: string; status: string; joined_day: number; agent_handle?: string }[]; relations?: { superior_id?: string; subordinate_id?: string; effective_from?: number }[] } | undefined;
  return (
    <AdminShell title="组织架构 / 组织演进" subtitle="查看任意一天的组织快照、员工状态和组织变化来源。">
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Panel title="员工列表">
          <div className="space-y-3">
            {(snapshot?.employees ?? []).map((employee) => (
              <a key={employee.id} className="block border border-rule p-3 hover:border-ink" href={`/dashboard/employees/${employee.id}`}>
                <div className="flex justify-between text-sm"><strong>{employee.display_name}</strong><span>{employee.status}</span></div>
                <p className="mt-1 text-xs text-ink/60">{employee.role_template} · Joined Day {employee.joined_day}</p>
              </a>
            ))}
          </div>
        </Panel>
        <Panel title="组织关系">
          <div className="space-y-2">
            {(snapshot?.relations ?? []).map((relation, index) => (
              <div key={index} className="border border-rule bg-[#fbfbf8] p-3 text-sm">
                <strong>{relation.superior_id}</strong> 管理 <strong>{relation.subordinate_id}</strong>
                <p className="mt-1 text-xs text-ink/55">Day {relation.effective_from} 起生效</p>
              </div>
            ))}
            {!(snapshot?.relations ?? []).length ? <p className="text-sm text-ink/55">暂无组织关系。</p> : null}
          </div>
        </Panel>
        <Panel title="组织变更" className="lg:col-span-2">
          <HumanData value={dto.changes.map((change) => ({ summary: change.summary, type: change.changeType, causedBy: change.causedBy?.actorName, event: change.causedBy?.content }))} />
        </Panel>
      </div>
    </AdminShell>
  );
}
