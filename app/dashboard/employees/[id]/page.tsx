import { AdminShell, HumanData, Panel } from "@/components/admin-shell";
import { getSimDb } from "@/db/connection";

export const dynamic = "force-dynamic";

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getSimDb();
  const employee = db.prepare("SELECT * FROM employees WHERE id = ?").get(id);
  const responsibilities = db.prepare("SELECT * FROM employee_responsibilities WHERE employee_id = ? ORDER BY effective_from").all(id);
  const grants = db.prepare("SELECT tg.*, tr.name tool_name FROM tool_grants tg LEFT JOIN tool_registry tr ON tr.id = tg.tool_id WHERE employee_id = ?").all(id);
  const contributions = db.prepare("SELECT * FROM employee_daily_contribution WHERE employee_id = ? ORDER BY day DESC").all(id);
  const observations = db.prepare("SELECT * FROM growth_observations WHERE employee_id = ? ORDER BY day DESC").all(id);
  return (
    <AdminShell title="员工详情" subtitle="查看单个 Agent 的档案、职责、权限、贡献和观察期。">
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="个人信息"><HumanData value={employee ?? { error: "not found" }} /></Panel>
        <Panel title="职责与工具授权"><HumanData value={{ responsibilities, grants }} /></Panel>
        <Panel title="工作贡献"><HumanData value={contributions} /></Panel>
        <Panel title="观察期"><HumanData value={observations} /></Panel>
      </div>
    </AdminShell>
  );
}
