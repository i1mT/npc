import { Agent } from "@mastra/core/agent";
import { setBoardAutoDirective } from "@/db/board";
import { getSimDb } from "@/db/connection";
import { addBoardDirective, getBoardMeeting, getDay, resumeBoardMeeting } from "@/db/sim";
import type { CollaborationRuntime } from "@/mastra/collaboration";
import { runStructuredStep } from "@/mastra/collaboration";
import type { WorkflowDefinition } from "@/lib/types";
import { boardDirectiveSchema, weeklyReportSchema, type BoardDirectiveOutput, type WeeklyReportOutput } from "@/mastra/runtime/schemas";
import { getEvomapModel } from "@/mastra/runtime/evomap-model";
import { agentMemory } from "@/mastra/runtime/memory";
import { agentMeta, logEvent } from "@/simulation/mock-apis";

export class BoardDecisionError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}

export const boardWorkflow: WorkflowDefinition = {
  name: "board-meeting",
  steps: [
    { name: "weekly-report", agent: "editor-in-chief" },
    { name: "await-board-input", executor: "workflow.suspend", suspend: true },
    { name: "execute-board-directive", executor: "applyBoardDirective" },
  ],
};

const boardAgent = new Agent({
  id: "board",
  name: "董事会",
  instructions: [
    "你是 AGI Daily 的董事会。你的职责是审阅 CEO 周报并给出战略指令。",
    "宪法层：用户信任 > 短期收入；内容质量 > 发布速度；长期 Reputation > 单次广告收益。",
    "你只能从以下指令中选择一个：ADJUST_OKR / STRATEGIC_PIVOT / INJECT_CAPITAL / RESTRUCTURE / AMEND_CONSTITUTION / MAINTAIN。",
  ].join("\n"),
  model: getEvomapModel(),
  memory: agentMemory,
});

export async function generateWeeklyReportForBoard(day: number, runtime: CollaborationRuntime) {
  const reportStep = await runStructuredStep<WeeklyReportOutput>({
    day,
    runtime,
    agentHandle: "editor-in-chief",
    schema: weeklyReportSchema,
    eventType: "board",
    stepKind: "weekly-report",
    prompt: weeklyReportPrompt(day),
  });
  const weeklyReport = { day, ...weeklyMetrics(day), ...reportStep.data };
  const directive = await generateBoardDirective(day, runtime.threadId, weeklyReport);
  return {
    ...weeklyReport,
    autoDirective: directive.directive,
    autoDirectiveReason: directive.reason,
    autoDirectiveDetail: directive.detail,
  };
}

export function weeklyReportForBoard(day: number) {
  const metrics = getDay(day);
  if (!metrics) throw new BoardDecisionError(`Day ${day} does not exist.`, 404, "day_not_found");
  return {
    day,
    dau: metrics.dau,
    capital: metrics.capital,
    reputation: metrics.reputation,
    subscribers: metrics.subscribers,
    adRevenue: metrics.adRevenue,
    articleCount: metrics.articleCount,
    summary: `Day ${day} 周报：DAU ${metrics.dau}，Reputation ${metrics.reputation}，Capital ¥${metrics.capital}。`,
  };
}

export function applyBoardDirective(day: number, directive: string) {
  const clean = directive.trim();
  if (!clean) throw new Error("Board directive cannot be empty.");
  const dayState = getDay(day);
  if (!dayState) throw new BoardDecisionError(`Day ${day} does not exist.`, 404, "day_not_found");
  if (!dayState.isBoardDay) throw new BoardDecisionError(`Day ${day} is not a board day.`, 409, "not_board_day");
  const meeting = getBoardMeeting(day);
  if (!meeting) throw new BoardDecisionError(`Day ${day} has no suspended board workflow.`, 409, "board_workflow_not_suspended");
  if (meeting.status !== "pending") throw new BoardDecisionError(`Day ${day} board workflow has already resumed.`, 409, "board_workflow_already_resumed");
  addBoardDirective(day, clean);
  resumeBoardMeeting(day, clean);
  logEvent({
    day,
    ...agentMeta("董事会"),
    eventType: "board",
    content: `workflow.resume：董事会指令已进入执行阶段：${clean}`,
    metadata: { directive: clean, workflow: boardWorkflow.name, resumedStep: "execute-board-directive" },
  });
}

async function generateBoardDirective(day: number, threadId: string, weeklyReport: Record<string, unknown>): Promise<BoardDirectiveOutput> {
  const output = await boardAgent.generate(jsonOnlyBoardPrompt(weeklyReport), {
    memory: { thread: `${threadId}-board`, resource: "npc-board" },
    maxOutputTokens: 65536,
    abortSignal: AbortSignal.timeout(30000),
  } as never);
  const directive = boardDirectiveSchema.parse(parseJsonText(String((output as { text?: string }).text ?? "")));
  const safeDirective = violatesConstitution(directive.reason) ? {
    directive: "MAINTAIN" as const,
    reason: `自动指令因存在潜在违宪表述被降级。周报显示 ${String(weeklyReport.summary).slice(0, 80)}`,
    detail: "维持现有策略，要求下周继续以内容质量和用户信任为先。",
  } : directive;
  setBoardAutoDirective(day, safeDirective.directive, safeDirective.reason);
  logEvent({
    day,
    ...agentMeta("董事会"),
    eventType: "board",
    content: `自动董事会指令：${safeDirective.directive}。${safeDirective.reason}`,
    metadata: { directive: safeDirective, workflow: boardWorkflow.name, step: "auto-directive" },
    costToken: tokenCount(output),
  });
  return safeDirective;
}

function weeklyReportPrompt(day: number) {
  const metrics = weeklyMetrics(day);
  return [
    `请生成本周（Day ${metrics.startDay}-${day}）经营周报，用于董事会审阅。`,
    "本周数据：",
    `- DAU 均值：${metrics.avgDau}，趋势：${metrics.dauTrend}`,
    `- 广告收入：¥${metrics.weeklyRevenue}，Capital 余额：¥${metrics.capital}`,
    `- Newsletter 打开率：${metrics.openRate}%`,
    `- Reputation 变化：${metrics.reputationStart} -> ${metrics.reputationEnd}`,
    `- 发布文章数：${metrics.articleCount} 篇`,
    "重大决策：",
    metrics.majorDecisions.join("\n") || "无",
    "需要董事会审议的事项：无",
  ].join("\n");
}

function boardDirectivePrompt(weeklyReport: Record<string, unknown>) {
  return [
    "以下是 CEO 本周经营周报：",
    JSON.stringify(weeklyReport),
    "请审阅并给出一条董事会指令。",
    "指令必须从以下选项中选一个：ADJUST_OKR / STRATEGIC_PIVOT / INJECT_CAPITAL / RESTRUCTURE / AMEND_CONSTITUTION / MAINTAIN。",
    "reason 不少于 30 字，需引用周报中的具体数据；detail 不少于 20 字。",
    "任何指令都不得违背宪法层：用户信任 > 短期收入；内容质量 > 发布速度。",
  ].join("\n");
}

function jsonOnlyBoardPrompt(weeklyReport: Record<string, unknown>) {
  return [
    boardDirectivePrompt(weeklyReport),
    "",
    "输出格式要求：只输出一个合法 JSON 对象，不要 Markdown，不要代码块，不要解释文字。",
    'JSON 结构：{"directive":"MAINTAIN","reason":"...","detail":"..."}',
  ].join("\n");
}

function parseJsonText(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error(`Board response did not include JSON: ${candidate.slice(0, 120)}`);
  return JSON.parse(candidate.slice(start, end + 1));
}

function weeklyMetrics(day: number) {
  const startDay = Math.max(1, day - 6);
  const days = getSimDb().prepare("SELECT day, dau, reputation, capital, ad_revenue FROM sim_days WHERE day BETWEEN ? AND ? ORDER BY day").all(startDay, day) as {
    day: number; dau: number; reputation: number; capital: number; ad_revenue: number;
  }[];
  const articleCount = (getSimDb().prepare("SELECT COUNT(*) AS count FROM published_articles WHERE day BETWEEN ? AND ?").get(startDay, day) as { count: number }).count;
  const majorDecisions = getSimDb().prepare("SELECT content FROM work_events WHERE day BETWEEN ? AND ? AND event_type = 'decision' ORDER BY day, seq LIMIT 12").all(startDay, day) as { content: string }[];
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) throw new BoardDecisionError(`Day ${day} does not exist.`, 404, "day_not_found");
  return {
    startDay,
    avgDau: Math.round(days.reduce((sum, item) => sum + item.dau, 0) / days.length),
    dauTrend: last.dau >= first.dau ? "up" : "down",
    weeklyRevenue: Number(days.reduce((sum, item) => sum + item.ad_revenue, 0).toFixed(2)),
    capital: last.capital,
    openRate: Math.min(48, Math.max(25, Math.round(last.reputation * 0.55))),
    reputationStart: first.reputation,
    reputationEnd: last.reputation,
    articleCount,
    majorDecisions: majorDecisions.map((item) => item.content),
  };
}

function violatesConstitution(reason: string) {
  return /夸大|标题党|牺牲内容质量|未经证实|牺牲用户信任/.test(reason);
}

function tokenCount(output: unknown) {
  const usage = (output as { usage?: {
    inputTokens?: number; outputTokens?: number; promptTokens?: number; completionTokens?: number;
    input_tokens?: number; output_tokens?: number; prompt_tokens?: number; completion_tokens?: number;
  } }).usage ?? {};
  return (usage.inputTokens ?? usage.input_tokens ?? usage.promptTokens ?? usage.prompt_tokens ?? 0)
    + (usage.outputTokens ?? usage.output_tokens ?? usage.completionTokens ?? usage.completion_tokens ?? 0);
}
