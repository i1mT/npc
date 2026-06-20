import { NextResponse } from "next/server";
import { hireEmployee } from "@/db/employees";
import { agentFactory } from "@/mastra/agent-factory";
import type { RoleTemplateName } from "@/mastra/role-templates";
import { listDays } from "@/db/sim";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      roleTemplate: RoleTemplateName;
      displayName: string;
      mandate: string;
      handle?: string;
      supervisorId?: string;
    };

    const { roleTemplate, displayName, mandate, supervisorId } = body;
    if (!roleTemplate || !displayName || !mandate) {
      return NextResponse.json({ error: "roleTemplate, displayName, mandate 为必填项" }, { status: 400 });
    }

    const days = listDays();
    const currentDay = days[0]?.day ?? 1;

    const handle = body.handle ?? `${roleTemplate}-${Date.now()}`;
    const { id, event } = hireEmployee({
      day: currentDay,
      displayName,
      roleTemplate,
      agentHandle: handle,
      systemPrompt: mandate,
      reason: mandate,
      supervisorId,
    });

    // Re-register all active agents so new hire takes effect immediately
    await agentFactory.loadActiveEmployees();

    return NextResponse.json({ id, eventId: event.id, handle, joinDay: currentDay + 1 });
  } catch (err) {
    console.error("[hire]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
