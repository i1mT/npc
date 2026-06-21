import { NextResponse } from "next/server";
import { getPortalDays } from "@/domain/portal";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getPortalDays());
}
