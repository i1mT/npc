import { Dashboard } from "@/components/dashboard";
import { listDays, listRules } from "@/db/sim";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return <Dashboard initialDays={listDays()} rules={listRules()} />;
}
