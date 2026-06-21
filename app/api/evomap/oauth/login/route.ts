import { NextResponse } from "next/server";
import { buildAuthorizeUrl, EvoMapConnectRequiredError } from "@/mastra/tools/evomap/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.redirect(await buildAuthorizeUrl());
  } catch (error) {
    if (error instanceof EvoMapConnectRequiredError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: 500 });
    }
    return NextResponse.json({ error: "evomap_oauth_login_failed" }, { status: 500 });
  }
}
