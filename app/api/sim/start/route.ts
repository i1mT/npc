import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { simClock } from "@/simulation/engine";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { days?: unknown };
  const days = typeof body.days === "number" ? body.days : undefined;
  const { promise, status } = await simClock.start(days);
  const { ctx } = await getCloudflareContext({ async: true });
  ctx.waitUntil(promise);
  return NextResponse.json(status);
}
