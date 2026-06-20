import { NextResponse } from "next/server";
import { listWorkEvents } from "@/db/sim";
import type { LayerName } from "@/lib/types";

export const dynamic = "force-dynamic";

const layers = new Set(["mission", "environment", "memory", "structure", "rules", "resource", "growth"]);

export async function GET(_request: Request, { params }: { params: Promise<{ layer: string; day: string }> }) {
  const { layer, day } = await params;
  if (!layers.has(layer)) return NextResponse.json({ error: "Unknown layer." }, { status: 404 });
  return NextResponse.json({ layer, day: Number(day), events: listWorkEvents(Number(day), layer as LayerName) });
}
