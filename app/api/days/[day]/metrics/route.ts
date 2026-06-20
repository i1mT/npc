import { NextResponse } from "next/server";
import { getDay } from "@/db/sim";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ day: string }> }) {
  const { day } = await params;
  const metrics = getDay(Number(day));
  if (!metrics) return NextResponse.json({ error: "Day not found." }, { status: 404 });
  return NextResponse.json({ metrics });
}
