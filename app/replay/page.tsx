import type { Metadata } from "next";
import { Replay } from "@/components/replay";
import { getPortalDay } from "@/domain/portal";
import { listDays } from "@/db/sim";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "日报回放",
  description: "回放 AGI Daily 指定日期的前台日报内容和幕后状态。",
};

export default async function ReplayPage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const query = await searchParams;
  const days = await listDays();
  const day = Number(query.day ?? days[0]?.day ?? 1);
  return <Replay data={await getPortalDay(day)} />;
}
