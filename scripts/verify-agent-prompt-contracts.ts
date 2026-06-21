import { readFileSync } from "node:fs";

function assertIncludes(file: string, needle: string) {
  const text = readFileSync(file, "utf8");
  if (!text.includes(needle)) throw new Error(`${file} missing required prompt contract: ${needle}`);
}

function assertNotIncludes(file: string, needle: string) {
  const text = readFileSync(file, "utf8");
  if (text.includes(needle)) throw new Error(`${file} still contains disallowed contract: ${needle}`);
}

const agenticDay = "src/mastra/workflows/agentic-day.ts";
const simDb = "src/db/sim.ts";
const npcTools = "src/mastra/tools/npc-tools.ts";
const roleTemplates = "src/mastra/role-templates.ts";
const agentFactory = "src/mastra/agent-factory.ts";
const editorAgent = "src/mastra/agents/editor.ts";
const chiefAgent = "src/mastra/agents/editor-in-chief.ts";
const boardMeeting = "src/mastra/workflows/board-meeting.ts";

const evomapExperience = "EvoMap 经验复用";
const evomapExperienceRef = "evomapExperienceInstruction";

assertIncludes(agenticDay, "文章封面可以调用 Tavily MCP");
assertIncludes(agenticDay, "七层约束");
assertIncludes(agenticDay, "规则层");
assertIncludes(agenticDay, "恰好 10 篇");
assertIncludes(agenticDay, "筛选恰好 10 篇");
assertNotIncludes(agenticDay, "筛选 8-10 篇");

assertIncludes(simDb, "文章封面可以调用 Tavily MCP");
assertIncludes(simDb, "七层约束");
assertIncludes(simDb, "规则层");
assertIncludes(simDb, "恰好 10 篇");
assertIncludes(simDb, "筛选恰好 10 篇");
assertNotIncludes(simDb, "筛选 8-10 篇");

assertIncludes(npcTools, "z.array(articleSchema).length(10)");
assertIncludes(npcTools, "valid.length !== 10");
assertNotIncludes(npcTools, "z.array(articleSchema).min(6).max(12)");

assertIncludes(roleTemplates, evomapExperience);
for (const file of [agentFactory, editorAgent, chiefAgent, boardMeeting, agenticDay]) {
  assertIncludes(file, evomapExperienceRef);
}

assertIncludes(roleTemplates, "可以先从 EvoMap 检索和读取可复用经验");
assertIncludes(roleTemplates, "可以整理为经验并通过 EvoMap 发布");

console.log(JSON.stringify({ ok: true }, null, 2));
