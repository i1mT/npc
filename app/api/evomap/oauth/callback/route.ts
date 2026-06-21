import { NextResponse } from "next/server";
import { exchangeAuthorizationCode, EvoMapApiError } from "@/mastra/tools/evomap/client";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  if (error) {
    return NextResponse.redirect(new URL(`/dashboard/tools?evomap=error&reason=${encodeURIComponent(error)}`, url));
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return NextResponse.json({ error: "missing_oauth_callback_params" }, { status: 400 });
  }

  try {
    await exchangeAuthorizationCode(code, state);
    return NextResponse.redirect(new URL("/dashboard/tools?evomap=connected", url));
  } catch (err) {
    if (err instanceof EvoMapApiError && err.status === 400) {
      return NextResponse.json({ error: err.code, upstream: err.upstream }, { status: 400 });
    }
    return NextResponse.redirect(new URL("/dashboard/tools?evomap=error&reason=token_exchange_failed", url));
  }
}
