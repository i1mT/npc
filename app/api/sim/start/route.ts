import { NextResponse } from "next/server";
import { simClock } from "@/simulation/engine";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const days = typeof body.days === "number" ? body.days : undefined;
  void simClock.start(days);
  return NextResponse.json(simClock.getStatus());
}
