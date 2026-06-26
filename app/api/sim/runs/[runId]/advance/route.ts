import { NextResponse } from "next/server";
import { advanceRun } from "@/mastra/workflows/streamed-day/runner";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  try {
    return NextResponse.json(await advanceRun(runId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 409 });
  }
}
