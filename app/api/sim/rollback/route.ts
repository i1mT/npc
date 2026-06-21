import { NextResponse } from "next/server";
import { z } from "zod";
import { rollbackToDay } from "@/db/connection";
import { setStatus } from "@/db/sim";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ targetDay: z.number().int().min(0) });

export async function POST(req: Request) {
  try {
    const body = bodySchema.parse(await req.json());
    await rollbackToDay(body.targetDay);
    await setStatus("idle");
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
