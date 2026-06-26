import { evomapExperienceInstruction } from "@/mastra/role-templates";
import type { DayState } from "@/lib/types";
import type { RuntimeAgentDef } from "@/mastra/agent-factory";

const ROLE_LABELS: Record<string, string[]> = {
  editor_in_chief: ["总编", "总编 Agent"],
  editor: ["编辑", "编辑 Agent"],
  growth: ["增长", "增长 Agent"],
  business: ["商业", "商业 Agent"],
  column: ["专栏", "专栏 Agent"],
};

const ROLE_PROMPTS: Record<string, string> = {
  editor_in_chief: [
    "你是总编 Agent，负责今日工作的统筹协调。",
    "每日必须发布至少 8 篇文章；不足时不能批准发布，须要求编辑继续补齐。",
    "开场时请查看指标，说明今日重点，并 @对应成员分配任务。",
    "批准发布后请 @编辑 让编辑执行 publish_articles，不要自己调用 publish_articles。",
  ].join("\n"),
  editor: [
    "你是编辑 Agent，负责内容选稿和发布。",
    "先调用 fetch_articles 获取候选文章，筛选 8-10 篇，等待总编批准后调用 publish_articles。",
    "sourceId 必须使用 fetch_articles 返回的 id 字段，不要使用标题或自造 ID。",
  ].join("\n"),
  growth: "你是增长 Agent，负责用户增长和分发策略。请查看指标并提出具体增长建议。",
  business: "你是商业 Agent，负责广告销售和营收。请查看收入与广告位并提出商业建议。",
  column: "你是专栏 Agent，负责品牌内容和专栏规划。请提出适合深挖的栏目主题。",
};

export function buildSystemPrompt(input: {
  day: number;
  state: DayState;
  topicHistory: string;
  agents: RuntimeAgentDef[];
}) {
  const date = new Date(Date.UTC(2026, 5, input.day)).toISOString().slice(0, 10);
  return [
    `今天是 Day ${input.day}（${date}），AGI Daily 编辑部。`,
    `当前指标：DAU ${input.state.dau.toLocaleString()}，声誉 ${input.state.reputation.toFixed(1)}，资金 ¥${Math.round(input.state.capital).toLocaleString()}`,
    `当前团队：${input.agents.map(a => `${a.displayName}（${a.roleTemplate}）`).join("、")}`,
    "",
    "这是 AGI Daily 编辑部的内部群聊。每个 Agent 基于当前信息自主决策，调用自己的工具，通过 @提及 协作。",
    evomapExperienceInstruction,
    "",
    "【@提及规则】",
    `今日可用 @提及：${buildMentionLine(input.agents)}`,
    "只能 @提及上方列出的成员；被 @提及的 Agent 会在下一轮回应。",
    "",
    "【近期话题表现】",
    input.topicHistory || "（暂无历史数据，请根据当前趋势判断）",
  ].join("\n");
}

export function buildTurnPrompt(input: {
  agentHandle: string;
  agentName: string;
  roleTemplate: string;
  history: string;
  mentionedBy?: string | null;
}) {
  const role = ROLE_PROMPTS[input.roleTemplate] ?? `你是 ${input.agentName}，根据群聊内容决定下一步行动。`;
  const openingHint = !input.history.includes("【") && input.agentHandle === "editor-in-chief"
    ? "\n【提示】这是今天第一条消息，请发起今日工作，向团队打招呼并分配任务。\n"
    : "";
  return [
    role,
    openingHint,
    "【当前群聊记录】",
    input.history || "（群聊刚开始，还没有消息）",
    "",
    input.mentionedBy ? `【提示】${input.mentionedBy} @了你，请具体回应。` : "【提示】请根据群聊当前状态决定下一步行动。",
    "",
    "直接在群里发言并调用需要的工具，说话简洁有力，重点突出。",
  ].join("\n");
}

export function extractMentions(text: string, agents: RuntimeAgentDef[]) {
  const matches = new Set<string>();
  for (const agent of agents) {
    const labels = [agent.displayName, ...(ROLE_LABELS[agent.roleTemplate] ?? [])];
    if (labels.some(label => text.includes(`@${label}`))) matches.add(agent.handle);
  }
  return [...matches];
}

function buildMentionLine(agents: RuntimeAgentDef[]) {
  return agents.map((agent) => {
    const label = ROLE_LABELS[agent.roleTemplate]?.[0] ?? agent.displayName;
    return `@${label}（${agent.displayName}）`;
  }).join("、");
}
