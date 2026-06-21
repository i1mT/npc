import { NextResponse } from "next/server";
import { getWorkEventImpact } from "@/db/sim";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const impact = await getWorkEventImpact(id);
  if (!impact.event) return NextResponse.json({ error: "Work event not found." }, { status: 404 });
  return NextResponse.json(impact);
}
