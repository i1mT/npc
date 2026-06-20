import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core";
import { createHash } from "node:crypto";
import { getSimDb } from "@/db/connection";
import { getEvomapModel } from "@/mastra/runtime/evomap-model";
import { getLLMConfig } from "@/mastra/runtime/llm-config";
import { agentMemory, mastraStorage } from "@/mastra/runtime/memory";
import { roleTemplates, type RoleTemplateName } from "@/mastra/role-templates";
import { TOOL_GRANTS_BY_ROLE, type ToolName } from "@/mastra/tools/npc-tools";

export type RuntimeAgentDef = {
  handle: string;
  displayName: string;
  roleTemplate: string;
  instructions: string;
  soul: string;
  memory: string;
  tools: string[];
  grantedToolNames: ToolName[];
  instructionHash: string;
  mastraRuntimeId: string;
};

class AgentFactory {
  private agents = new Map<string, RuntimeAgentDef>();
  private mastraAgents = new Map<string, Agent>();
  private runtimeId = `mastra-runtime-${process.pid}`;
  private mastra: Mastra | null = null;

  register(handle: string, def: Omit<RuntimeAgentDef, "handle">) {
    const agent = { handle, ...def };
    this.agents.set(handle, agent);
    this.mastraAgents.set(handle, new Agent({
      id: handle,
      name: def.displayName,
      instructions: def.instructions,
      model: getEvomapModel(),
      memory: agentMemory,
    }));
    this.rebuildMastra();
    return agent;
  }

  get(handle: string) {
    const agent = this.agents.get(handle);
    if (!agent) throw new Error(`Agent ${handle} is not registered.`);
    return agent;
  }

  loadActiveEmployees() {
    const rows = getSimDb()
      .prepare("SELECT id, display_name, role_template, system_prompt, soul, tools_granted, memory, agent_handle FROM employees WHERE status = 'active' ORDER BY joined_day, id")
      .all() as {
        id: string; display_name: string; role_template: RoleTemplateName;
        system_prompt: string | null; soul: string | null;
        tools_granted: string | null; memory: string | null;
        agent_handle: string;
      }[];
    for (const row of rows) {
      const template = roleTemplates[row.role_template] ?? roleTemplates.editor;
      const soul = row.soul ?? "";
      const memory = row.memory ?? "";
      // Parse granted tools from DB; fall back to TOOL_GRANTS_BY_ROLE
      let grantedToolNames: ToolName[];
      try {
        grantedToolNames = row.tools_granted ? (JSON.parse(row.tools_granted) as ToolName[]) : (TOOL_GRANTS_BY_ROLE[row.role_template] ?? []);
      } catch {
        grantedToolNames = TOOL_GRANTS_BY_ROLE[row.role_template] ?? [];
      }
      const instructions = buildInstructions(row.display_name, template.prompt, row.system_prompt, soul, memory, grantedToolNames);
      this.register(row.agent_handle, {
        displayName:       row.display_name,
        roleTemplate:      row.role_template,
        instructions,
        soul,
        memory,
        tools:             template.defaultTools,
        grantedToolNames,
        instructionHash:   hashInstructions(instructions),
        mastraRuntimeId:   this.runtimeId,
      });
    }
    return this.list();
  }

  getMastraInstance() {
    if (!this.mastra) this.rebuildMastra();
    return this.mastra;
  }

  getMastraAgent(handle: string) {
    const agent = this.mastraAgents.get(handle);
    if (!agent) throw new Error(`Mastra Agent ${handle} is not registered.`);
    return agent;
  }

  list() {
    const llm = getLLMConfig();
    return Array.from(this.agents.values()).map((agent) => ({
      ...agent,
      model: llm.model,
      apiBase: llm.apiBase,
      hasApiKey: Boolean(llm.apiKey),
    }));
  }

  private rebuildMastra() {
    this.mastra = new Mastra({
      agents: Object.fromEntries(this.mastraAgents.entries()),
      storage: mastraStorage,
    });
  }
}

const globalForAgents = globalThis as unknown as { npcAgentFactory?: AgentFactory };

export const agentFactory = globalForAgents.npcAgentFactory ?? new AgentFactory();
globalForAgents.npcAgentFactory = agentFactory;

function buildInstructions(
  displayName: string,
  templatePrompt: string,
  systemPrompt: string | null,
  soul: string,
  memory: string,
  grantedTools: ToolName[],
) {
  const parts: string[] = [
    `# ${displayName}`,
    "",
    "## 职责",
    systemPrompt ?? templatePrompt,
    "",
  ];
  if (soul) {
    parts.push("## 灵魂与价值观", soul, "");
  }
  if (memory) {
    parts.push("## 工作记忆（最近积累的洞察）", memory, "");
  }
  parts.push(
    "## 可用工具",
    grantedTools.map(t => `- ${t}()`).join("\n"),
    "",
    "## 协作规范",
    "- 在群聊中说明判断依据，不做无意义发言",
    "- 调用工具后在群里汇报关键结果",
    "- 被 @提及 时要具体回应请求",
    "- 所有发言和工具调用都进入审计链路",
  );
  return parts.filter(p => p !== undefined).join("\n");
}

function hashInstructions(instructions: string) {
  return createHash("sha256").update(instructions).digest("hex").slice(0, 12);
}
