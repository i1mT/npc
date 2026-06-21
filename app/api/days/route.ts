import { NextResponse } from "next/server";
import { listDays } from "@/db/sim";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ days: await listDays() });
}
