import { NextResponse } from "next/server";
import { stopActiveStreamedRun } from "@/mastra/workflows/streamed-day/runner";

export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(await stopActiveStreamedRun());
}
