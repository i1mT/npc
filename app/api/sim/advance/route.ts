import { NextResponse } from "next/server";
import { startStreamedDayRun } from "@/mastra/workflows/streamed-day/runner";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    return NextResponse.json(await startStreamedDayRun(1));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 409 });
  }
}
