import { listDays } from "@/db/sim";
import { dayToShortDate } from "@/lib/dates";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SettlementIndexPage() {
  const days = await listDays();

  if (days.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink/40">
        暂无结算数据，先运行 1 天模拟。
      </div>
    );
  }

  // Redirect to latest day
  redirect(`/dashboard/settlement/${days[0]!.day}`);
}
