import { NextResponse } from "next/server";
import { simClock } from "@/simulation/engine";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const state = await simClock.advanceOneDay();
    return NextResponse.json({ state });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 409 });
  }
}
