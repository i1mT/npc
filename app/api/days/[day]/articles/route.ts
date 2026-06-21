import { NextResponse } from "next/server";
import { listPublishedArticles } from "@/db/sim";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ day: string }> }) {
  const { day } = await params;
  return NextResponse.json({ articles: await listPublishedArticles(Number(day)) });
}
