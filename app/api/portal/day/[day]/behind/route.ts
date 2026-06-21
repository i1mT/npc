import { NextResponse } from "next/server";
import { getPortalBehind } from "@/domain/portal";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ day: string }> }) {
  const { day } = await params;
  const articleId = new URL(request.url).searchParams.get("articleId") ?? undefined;
  return NextResponse.json(await getPortalBehind(Number(day), articleId));
}
