import { NextResponse } from "next/server";
import { z } from "zod";
import { createEmployee, EmployeeCreateError, listEmployees } from "@/domain/employees";
import { ensureBaselineData } from "@/db/sim";

export const dynamic = "force-dynamic";

const schema = z.object({
  displayName: z.string().min(1),
  roleTemplate: z.enum(["editor_in_chief", "editor", "growth", "business", "column"]),
  reportsTo: z.string().min(1),
  responsibilities: z.array(z.string().min(1)).min(1),
  toolGrants: z.array(z.object({ tool: z.string().min(1), budgetYuan: z.number().nullable() })).default([]),
  authLimits: z.record(z.unknown()).optional(),
  memoryInherit: z.array(z.object({ type: z.string().min(1) })).optional(),
  observationDays: z.number().int().positive().optional(),
  trigger: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("bootstrap"), refId: z.literal("seed") }),
    z.object({ kind: z.literal("board_directive"), refId: z.string().min(1) }),
    z.object({ kind: z.literal("ceo_decision"), refId: z.string().min(1) }),
    z.object({ kind: z.literal("growth_proposal"), refId: z.string().min(1) }),
  ]),
  effectiveFromDay: z.number().int().positive(),
});

export async function GET() {
  ensureBaselineData();
  return NextResponse.json({ employees: listEmployees() });
}

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid employee payload.", issues: parsed.error.issues }, { status: 400 });
  try {
    return NextResponse.json(createEmployee(parsed.data), { status: 201 });
  } catch (error) {
    if (error instanceof EmployeeCreateError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown employee create error." }, { status: 500 });
  }
}
