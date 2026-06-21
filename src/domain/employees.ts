import { createHash, randomUUID } from "node:crypto";
import { dbAll, dbBatch, dbFirst, getDb } from "@/db/connection";
import { agentFactory } from "@/mastra/agent-factory";
import { roleTemplates, type RoleTemplateName } from "@/mastra/role-templates";

export type EmployeeTrigger =
  | { kind: "bootstrap"; refId: "seed" }
  | { kind: "board_directive"; refId: string }
  | { kind: "ceo_decision"; refId: string }
  | { kind: "growth_proposal"; refId: string };

export type CreateEmployeeInput = {
  displayName: string;
  roleTemplate: RoleTemplateName;
  reportsTo: string;
  responsibilities: string[];
  toolGrants: { tool: string; budgetYuan: number | null }[];
  authLimits?: Record<string, unknown>;
  memoryInherit?: { type: string }[];
  observationDays?: number;
  trigger: EmployeeTrigger;
  effectiveFromDay: number;
};

export class EmployeeCreateError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = "employee_create_error",
  ) {
    super(message);
  }
}

export function listEmployees() {
  return dbAll("SELECT id, display_name, role_template, status, joined_day, left_day, agent_handle, caused_by_event FROM employees ORDER BY joined_day, id");
}

export async function createEmployee(input: CreateEmployeeInput) {
  await validateTrigger(input.trigger);
  const db = await getDb();
  const role = roleTemplates[input.roleTemplate];
  if (!role) throw new EmployeeCreateError(`Unknown role template: ${input.roleTemplate}`, 400, "unknown_role_template");

  const employeeId = randomUUID();
  const eventId = randomUUID();
  const relationId = randomUUID();
  const now = new Date().toISOString();
  const handle = `${input.roleTemplate}-${employeeId.slice(0, 8)}`;
  const systemPrompt = [
    "使命：让中文读者用最少时间，读懂全球 AI 最重要的进展。",
    role.prompt,
    `职责：${input.responsibilities.join("；")}`,
    `工具：${input.toolGrants.map((grant) => grant.tool).join("，")}`,
    "外部 LLM 配置只允许从环境变量读取，禁止写入代码或文档。",
  ].join("\n");

  const statements = [
    db.prepare(
      `INSERT INTO work_events (id, day, seq, ts, actor_id, actor_name, actor_type, layer, event_type, action, content, payload, refs, cost_token, cost_yuan, created_at)
       VALUES (?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM work_events WHERE day = ?), ?, ?, ?, 'system', 'structure', 'org_change', 'create_employee', ?, ?, ?, 0, 0, ?)`,
    ).bind(eventId, input.effectiveFromDay, input.effectiveFromDay, now, input.trigger.refId, "AgentFactory", `创建员工 ${input.displayName}`, JSON.stringify(input), JSON.stringify({ trigger: input.trigger }), now),
    db.prepare(
      "INSERT INTO employees (id, display_name, role_template, status, joined_day, system_prompt, agent_handle, caused_by_event) VALUES (?, ?, ?, 'onboarding', ?, ?, ?, ?)",
    ).bind(employeeId, input.displayName, input.roleTemplate, input.effectiveFromDay, systemPrompt, handle, eventId),
    db.prepare("INSERT INTO org_relations (id, superior_id, subordinate_id, effective_from) VALUES (?, ?, ?, ?)").bind(relationId, input.reportsTo, employeeId, input.effectiveFromDay),
    ...input.responsibilities.map((responsibility) =>
      db.prepare("INSERT INTO employee_responsibilities (employee_id, responsibility, effective_from) VALUES (?, ?, ?)").bind(employeeId, responsibility, input.effectiveFromDay),
    ),
    db.prepare("INSERT INTO growth_observations (employee_id, day, kpi_json, status) VALUES (?, ?, ?, 'on_track')").bind(employeeId, input.effectiveFromDay, JSON.stringify({ observationDays: input.observationDays ?? 14 })),
    db.prepare(
      `INSERT INTO layer_changes (id, layer, day, entity_table, entity_id, change_type, before_json, after_json, caused_by_event, summary, created_at)
       VALUES (?, 'structure', ?, 'employees', ?, 'create', NULL, ?, ?, ?, ?)`,
    ).bind(randomUUID(), input.effectiveFromDay, employeeId, JSON.stringify({ employeeId, handle, roleTemplate: input.roleTemplate }), eventId, `创建员工 ${input.displayName}`, now),
  ];

  for (const grant of input.toolGrants) {
    const tool = await dbFirst<{ id: string }>("SELECT id FROM tool_registry WHERE name = ?", grant.tool);
    if (!tool) throw new EmployeeCreateError(`Unknown tool: ${grant.tool}`, 400, "unknown_tool");
    statements.push(db.prepare("INSERT INTO tool_grants (employee_id, tool_id, budget_yuan, granted_at) VALUES (?, ?, ?, ?)").bind(employeeId, tool.id, grant.budgetYuan, now));
  }
  for (const inherit of input.memoryInherit ?? []) {
    const entries = await dbAll<{ id: string }>("SELECT id FROM memory_entries WHERE type = ? AND status = 'active' ORDER BY weight DESC LIMIT 10", inherit.type);
    statements.push(...entries.map((entry) =>
      db.prepare("INSERT INTO memory_links (day, entry_id, target_table, target_id, relation, caused_by) VALUES (?, ?, 'employees', ?, 'inherit', ?)").bind(input.effectiveFromDay, entry.id, employeeId, eventId),
    ));
  }
  await dbBatch(statements);

  await agentFactory.register(handle, {
    displayName:     input.displayName,
    roleTemplate:    input.roleTemplate,
    instructions:    systemPrompt,
    soul:            "",
    memory:          "",
    grantedToolNames: [],
    tools:           [...role.defaultTools, ...input.toolGrants.map((grant) => grant.tool)],
    instructionHash: createHash("sha256").update(systemPrompt).digest("hex").slice(0, 12),
    mastraRuntimeId: `mastra-runtime-${randomUUID().slice(0, 8)}`,
  });

  return { employeeId, agentHandle: handle, status: "onboarding", createdEventId: eventId };
}

async function validateTrigger(trigger: EmployeeTrigger) {
  if (trigger.kind === "bootstrap") {
    const count = (await dbFirst<{ count: number }>("SELECT COUNT(*) AS count FROM employees"))?.count ?? 0;
    if (count === 0 && trigger.refId === "seed") return;
    throw new EmployeeCreateError("Bootstrap trigger is only allowed for empty initial seed data.", 409, "bootstrap_not_allowed");
  }
  if (trigger.kind === "board_directive") {
    const row = await dbFirst<{ id: string }>("SELECT id FROM board_directives WHERE id = ?", trigger.refId);
    if (row) return;
    throw new EmployeeCreateError("board_directive trigger does not exist.", 422, "invalid_trigger");
  }
  if (trigger.kind === "ceo_decision") {
    const row = await dbFirst<{ id: string }>("SELECT id FROM work_events WHERE id = ? AND actor_type = 'ceo' AND event_type = 'decision'", trigger.refId);
    if (row) return;
    throw new EmployeeCreateError("ceo_decision trigger does not exist.", 422, "invalid_trigger");
  }
  const proposal = await dbFirst<{ id: string }>("SELECT id FROM growth_proposals WHERE id = ? AND status = 'approved'", trigger.refId);
  if (!proposal) throw new EmployeeCreateError("growth_proposal trigger does not exist or is not approved.", 422, "invalid_trigger");
}
