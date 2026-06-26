import { NextResponse } from "next/server";
import { getStreamedSimStatus } from "@/mastra/workflows/streamed-day/runner";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getStreamedSimStatus());
}
