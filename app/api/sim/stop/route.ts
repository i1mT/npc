import { NextResponse } from "next/server";
import { simClock } from "@/simulation/engine";

export const dynamic = "force-dynamic";

export async function POST() {
  simClock.stop();
  return NextResponse.json(simClock.getStatus());
}
