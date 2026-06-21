import { NextResponse } from "next/server";
import { resetSimDb } from "@/db/connection";
import { setStatus } from "@/db/sim";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    resetSimDb();
    setStatus("idle");
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
