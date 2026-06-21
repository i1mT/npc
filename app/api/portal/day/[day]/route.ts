import { NextResponse } from "next/server";
import { getPortalDay } from "@/domain/portal";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ day: string }> }) {
  const { day } = await params;
  return NextResponse.json(await getPortalDay(Number(day)));
}
