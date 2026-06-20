import { Replay } from "@/components/replay";
import { getPortalDay } from "@/domain/portal";
import { listDays } from "@/db/sim";

export const dynamic = "force-dynamic";

export default function Page() {
  const days = listDays();
  return <Replay data={getPortalDay(days[0]?.day ?? 1)} />;
}
