import { NextResponse } from "next/server";
import { z } from "zod";
import { applyBoardDirective, BoardDecisionError } from "@/mastra";

export const dynamic = "force-dynamic";

const schema = z.object({
  day: z.number().int().positive(),
  directive: z.string().min(1),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid directive payload." }, { status: 400 });
  }
  try {
    await applyBoardDirective(parsed.data.day, parsed.data.directive);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof BoardDecisionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown board decision error." }, { status: 400 });
  }
}
