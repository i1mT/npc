import { NextResponse } from "next/server";
import { clearToken } from "@/mastra/tools/evomap/token-store";

export const dynamic = "force-dynamic";

export async function POST() {
  await clearToken();
  return NextResponse.json({ ok: true });
}
