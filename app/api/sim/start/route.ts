import { NextResponse } from "next/server";
import { startStreamedDayRun } from "@/mastra/workflows/streamed-day/runner";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { days?: unknown };
  const days = typeof body.days === "number" ? body.days : undefined;
  return NextResponse.json(await startStreamedDayRun(days));
}
