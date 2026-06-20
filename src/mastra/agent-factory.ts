import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core";
import { createHash } from "node:crypto";
import { getSimDb } from "@/db/connection";
import { getLLMConfig } from "@/mastra/llm-config";
import { localMastraModel } from "@/mastra/local-model";
import { roleTemplates, type RoleTemplateName } from "@/mastra/role-templates";

export type RuntimeAgentDef = {
  handle: string;
  displayName: string;
  roleTemplate: string;
  instructions: string;
  tools: string[];
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
      model: localMastraModel as never,
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
      .prepare("SELECT id, display_name, role_template, system_prompt, agent_handle FROM employees WHERE status = 'active' ORDER BY joined_day, id")
      .all() as { id: string; display_name: string; role_template: RoleTemplateName; system_prompt: string | null; agent_handle: string }[];
    for (const row of rows) {
      const template = roleTemplates[row.role_template] ?? roleTemplates.editor;
      const instructions = buildInstructions(row.display_name, template.prompt, row.system_prompt);
      this.register(row.agent_handle, {
        displayName: row.display_name,
        roleTemplate: row.role_template,
        instructions,
        tools: template.defaultTools,
        instructionHash: hashInstructions(instructions),
        mastraRuntimeId: this.runtimeId,
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
    });
  }
}

const globalForAgents = globalThis as unknown as { npcAgentFactory?: AgentFactory };

export const agentFactory = globalForAgents.npcAgentFactory ?? new AgentFactory();
globalForAgents.npcAgentFactory = agentFactory;

function buildInstructions(displayName: string, templatePrompt: string, storedPrompt: string | null) {
  return [
    `员工：${displayName}`,
    templatePrompt,
    storedPrompt ?? "",
    "协作要求：在群聊中说明判断依据；调用工具后必须总结得到的信息；被 @ 时要回复具体请求；输出会进入 work_events 审计链路。",
  ].filter(Boolean).join("\n");
}

function hashInstructions(instructions: string) {
  return createHash("sha256").update(instructions).digest("hex").slice(0, 12);
}
