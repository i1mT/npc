import { NextResponse } from "next/server";
import { listRules } from "@/db/sim";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ rules: listRules() });
}
