import { randomUUID } from "node:crypto";
import { addLayerEvent } from "@/db/sim";
import { dbAll, dbBatch, dbFirst, getDb } from "@/db/connection";
import { pickEmployeeName } from "@/db/pick-name";
import type { RoleTemplateName } from "@/mastra/role-templates";
import { TOOL_GRANTS_BY_ROLE } from "@/mastra/tools/npc-tools";

const DEFAULT_DAILY_SALARY: Record<string, number> = {
  editor_in_chief: 500,
  editor: 300,
  growth: 350,
  business: 400,
  column: 380,
};

export async function employeeExistsByRole(roleTemplate: RoleTemplateName) {
  const row = await dbFirst<{ count: number }>(
    "SELECT COUNT(*) AS count FROM employees WHERE role_template = ? AND status = 'active'",
    roleTemplate,
  );
  return (row?.count ?? 0) > 0;
}

export function listActiveEmployeeLabels() {
  return dbAll<{ display_name: string; role_template: RoleTemplateName; agent_handle: string }>(
    "SELECT display_name, role_template, agent_handle FROM employees WHERE status = 'active' ORDER BY joined_day, id",
  );
}

export async function hireEmployee(input: {
  day: number;
  displayName?: string;
  roleTemplate: RoleTemplateName;
  agentHandle: string;
  systemPrompt: string;
  soul?: string;
  reason: string;
  supervisorId?: string;
}) {
  const db = await getDb();
  const id = randomUUID();
  const displayName = input.displayName ?? await pickEmployeeName();
  const grantedTools = JSON.stringify(TOOL_GRANTS_BY_ROLE[input.roleTemplate] ?? []);
  const event = await addLayerEvent({
    day: input.day,
    actorId: "board",
    actorName: "董事会",
    layer: "structure",
    eventType: "org_change",
    action: "hire",
    content: `HR 招募 ${displayName}（${input.roleTemplate}）：${input.reason}`,
    payload: input,
  });
  const salary = DEFAULT_DAILY_SALARY[input.roleTemplate] ?? 300;
  await dbBatch([
    db.prepare(
    `INSERT INTO employees (id, display_name, role_template, status, joined_day, system_prompt, soul, tools_granted, agent_handle, caused_by_event, daily_salary)
     VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, displayName, input.roleTemplate, input.day + 1, input.systemPrompt, input.soul ?? "", grantedTools, input.agentHandle, event.id, salary),
    db.prepare(
    `INSERT OR IGNORE INTO org_relations (id, superior_id, subordinate_id, effective_from)
     VALUES (?, ?, ?, ?)`,
    ).bind(randomUUID(), input.supervisorId ?? "editor-in-chief", id, input.day + 1),
  ]);
  return { id, event };
}

export async function spawnActiveEmployee(input: {
  day: number;
  displayName?: string;
  roleTemplate: RoleTemplateName;
  agentHandle: string;
  systemPrompt: string;
  soul?: string;
  reason: string;
}) {
  if (await employeeExistsByRole(input.roleTemplate)) return null;
  const displayName = input.displayName ?? await pickEmployeeName();
  const grantedTools = JSON.stringify(TOOL_GRANTS_BY_ROLE[input.roleTemplate] ?? []);
  const event = await addLayerEvent({
    day: input.day,
    actorId: "editor-in-chief",
    actorName: "总编 Agent",
    layer: "structure",
    eventType: "org_change",
    action: "spawn_agent",
    content: `孵化 ${displayName}（${input.roleTemplate}）：${input.reason}`,
    payload: { ...input, displayName },
  });
  const salary = DEFAULT_DAILY_SALARY[input.roleTemplate] ?? 300;
  await dbRunEmployee(displayName, input, grantedTools, event.id, salary);
  return event;
}

async function dbRunEmployee(
  displayName: string,
  input: { day: number; roleTemplate: RoleTemplateName; agentHandle: string; systemPrompt: string; soul?: string },
  grantedTools: string,
  eventId: string,
  salary: number,
) {
  const db = await getDb();
  await dbBatch([
    db.prepare(
      `INSERT INTO employees (id, display_name, role_template, status, joined_day, system_prompt, soul, tools_granted, agent_handle, caused_by_event, daily_salary)
       VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(randomUUID(), displayName, input.roleTemplate, input.day + 1, input.systemPrompt, input.soul ?? "", grantedTools, input.agentHandle, eventId, salary),
  ]);
}
