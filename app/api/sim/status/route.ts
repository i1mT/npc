import { NextResponse } from "next/server";
import { simClock } from "@/simulation/engine";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await simClock.getStatus());
}
