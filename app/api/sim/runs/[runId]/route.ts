import { NextResponse } from "next/server";
import { getSnapshot } from "@/mastra/workflows/streamed-day/store";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  try {
    return NextResponse.json(await getSnapshot(runId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 404 });
  }
}
