import { NextResponse } from "next/server";
import { getArticle } from "@/db/sim";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const article = getArticle(id);
  if (!article) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ article });
}
