import { NextResponse } from "next/server";
import { getSimDb } from "@/db/connection";

export const dynamic = "force-dynamic";

type AdPlacement = {
  id: string;
  day: number;
  slotId: string;
  advertiser: string;
  cpm: number;
  impressions: number;
  revenue: number;
  reason: string;
};

export async function GET(_: Request, { params }: { params: Promise<{ day: string }> }) {
  const { day } = await params;
  const db = getSimDb();
  const rows = db
    .prepare("SELECT id, day, slot_id, advertiser, payload, revenue FROM ad_placements WHERE day = ? ORDER BY revenue DESC")
    .all(Number(day)) as { id: string; day: number; slot_id: string; advertiser: string; payload: string; revenue: number }[];

  const ads: AdPlacement[] = rows.map(r => {
    const p = JSON.parse(r.payload) as { cpm?: number; impressions?: number; reason?: string };
    return {
      id: r.id,
      day: r.day,
      slotId: r.slot_id,
      advertiser: r.advertiser,
      cpm: p.cpm ?? 0,
      impressions: p.impressions ?? 0,
      revenue: r.revenue,
      reason: p.reason ?? "",
    };
  });

  return NextResponse.json({ ads, totalRevenue: ads.reduce((s, a) => s + a.revenue, 0) });
}
