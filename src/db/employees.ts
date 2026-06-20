import { randomUUID } from "node:crypto";
import { addLayerEvent } from "@/db/sim";
import { getSimDb } from "@/db/connection";
import type { RoleTemplateName } from "@/mastra/role-templates";
import { TOOL_GRANTS_BY_ROLE } from "@/mastra/tools/npc-tools";

export function employeeExistsByRole(roleTemplate: RoleTemplateName) {
  const row = getSimDb()
    .prepare("SELECT COUNT(*) AS count FROM employees WHERE role_template = ? AND status = 'active'")
    .get(roleTemplate) as { count: number };
  return row.count > 0;
}

export function listActiveEmployeeLabels() {
  return getSimDb()
    .prepare("SELECT display_name, role_template, agent_handle FROM employees WHERE status = 'active' ORDER BY joined_day, id")
    .all() as { display_name: string; role_template: RoleTemplateName; agent_handle: string }[];
}

export function hireEmployee(input: {
  day: number;
  displayName: string;
  roleTemplate: RoleTemplateName;
  agentHandle: string;
  systemPrompt: string;
  soul?: string;
  reason: string;
  supervisorId?: string;
}) {
  const db = getSimDb();
  const id = randomUUID();
  const grantedTools = JSON.stringify(TOOL_GRANTS_BY_ROLE[input.roleTemplate] ?? []);
  const event = addLayerEvent({
    day: input.day,
    actorId: "board",
    actorName: "董事会",
    layer: "structure",
    eventType: "org_change",
    action: "hire",
    content: `HR 招募 ${input.displayName}（${input.roleTemplate}）：${input.reason}`,
    payload: input,
  });
  db.prepare(
    `INSERT INTO employees (id, display_name, role_template, status, joined_day, system_prompt, soul, tools_granted, agent_handle, caused_by_event)
     VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.displayName, input.roleTemplate, input.day + 1, input.systemPrompt, input.soul ?? "", grantedTools, input.agentHandle, event.id);
  const supervisorId = input.supervisorId ?? "editor-in-chief";
  db.prepare(
    `INSERT OR IGNORE INTO org_relations (id, superior_id, subordinate_id, effective_from)
     VALUES (?, ?, ?, ?)`,
  ).run(randomUUID(), supervisorId, id, input.day + 1);
  return { id, event };
}

export function spawnActiveEmployee(input: {
  day: number;
  displayName: string;
  roleTemplate: RoleTemplateName;
  agentHandle: string;
  systemPrompt: string;
  soul?: string;
  reason: string;
}) {
  if (employeeExistsByRole(input.roleTemplate)) return null;
  const grantedTools = JSON.stringify(TOOL_GRANTS_BY_ROLE[input.roleTemplate] ?? []);
  const event = addLayerEvent({
    day: input.day,
    actorId: "editor-in-chief",
    actorName: "总编 Agent",
    layer: "structure",
    eventType: "org_change",
    action: "spawn_agent",
    content: `孵化 ${input.roleTemplate} Agent：${input.reason}`,
    payload: input,
  });
  getSimDb()
    .prepare(
      `INSERT INTO employees (id, display_name, role_template, status, joined_day, system_prompt, soul, tools_granted, agent_handle, caused_by_event)
       VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
    )
    .run(randomUUID(), input.displayName, input.roleTemplate, input.day + 1, input.systemPrompt, input.soul ?? "", grantedTools, input.agentHandle, event.id);
  return event;
}
