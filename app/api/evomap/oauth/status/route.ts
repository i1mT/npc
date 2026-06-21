import { NextResponse } from "next/server";
import { getOAuthStatus } from "@/mastra/tools/evomap/token-store";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getOAuthStatus());
}
