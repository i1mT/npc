import { getTopicPerformanceLast7Days } from "@/db/memory-queries";
import { employeeExistsByRole, listActiveEmployeeLabels, spawnActiveEmployee } from "@/db/employees";
import { updateDayEditorNote } from "@/db/day-notes";
import { addLayerEvent, ensureBaselineData, getLatestDay, projectDay, recordDailySettlement, upsertDay } from "@/db/sim";
import type { DayState, PublishedArticle, WorkflowDefinition } from "@/lib/types";
import { runStructuredStep, runTextStep, startDailyCollaboration } from "@/mastra/collaboration";
import { queryArticlesTool } from "@/mastra/tools/article-tools";
import { publishArticleTool, suspendBoardWorkflowTool } from "@/mastra/tools/sim-tools";
import { agendaSchema, articleDraftSchema, editorNoteSchema, growthDecisionSchema, reviewSchema, type AgendaOutput, type GrowthDecisionOutput, type ReviewOutput } from "@/mastra/runtime/schemas";
import { averageScore, formatTopTags, normalizeDrafts, stepTokens, writeArticleMemory } from "@/mastra/workflows/daily-article-utils";
import { boardWorkflow, generateWeeklyReportForBoard } from "@/mastra/workflows/board-meeting";
import { agendaPrompt, draftPrompt, editorNotePrompt, formatTopicHistory, growthPrompt, growthThresholdHint, reviewPrompt, revisePrompt, socialPrompt } from "@/mastra/workflows/daily-prompts";
import type { RoleTemplateName } from "@/mastra/role-templates";
import { agentMeta, logEvent } from "@/simulation/mock-apis";
import { adRevenue, nextCapital, nextDAU, nextReputation, nextSubscribers, socialReach } from "@/simulation/formulas";

type GrowthRole = Extract<RoleTemplateName, "growth" | "business" | "column">;

export const dailyWorkflow: WorkflowDefinition = {
  name: "daily-run",
  steps: [
    { name: "set-agenda", agent: "editor-in-chief" },
    { name: "select-and-write", agent: "editor" },
    { name: "review", agent: "editor-in-chief" },
    { name: "publish", agent: "editor" },
    { name: "settle-day", executor: "settleDay" },
    { name: "board-meeting", executor: boardWorkflow.name, suspend: true },
  ],
};

export async function runDailyWorkflow(day: number): Promise<DayState> {
  ensureBaselineData();
  const collaboration = startDailyCollaboration(day);
  const previous = getLatestDay();
  const base = previous ? inheritDay(day, previous) : initialDay(day);
  let tokenTotal = 0;

  console.log(`[daily-workflow] day ${day} agenda`);
  const topicHistory = formatTopicHistory(getTopicPerformanceLast7Days(day));
  const agendaStep = await runStructuredStep<AgendaOutput>({
    day,
    runtime: collaboration,
    agentHandle: "editor-in-chief",
    schema: agendaSchema,
    eventType: "decision",
    mentions: [{ agentId: "editor", agentName: "编辑 Agent" }],
    stepKind: "agenda",
    prompt: agendaPrompt({ day, dau: base.dau, reputation: base.reputation, capital: base.capital, topicHistory }),
  });
  tokenTotal += stepTokens(agendaStep);
  const agenda = agendaStep.data;

  console.log(`[daily-workflow] day ${day} query`);
  const sources = await queryArticlesTool.execute({ day, limit: 30 });
  const queryStep = await runTextStep({
    day,
    runtime: collaboration,
    agentHandle: "editor",
    eventType: "tool_call",
    replyTo: agendaStep.event,
    mentions: [{ agentId: "editor-in-chief", agentName: "总编 Agent" }],
    stepKind: "query-report",
    toolSummary: {
      tool: queryArticlesTool.name,
      input: `Day ${day}，limit=30，主题=${agenda.focusTopics.join("、")}`,
      result: `得到 ${sources.length} 篇候选；前 5 个来源：${sources.slice(0, 5).map((source) => source.id).join("、")}`,
    },
    prompt: `工具返回 ${sources.length} 篇候选文章。请向总编简要说明你会如何按议程筛选，不要输出 JSON。`,
  });
  tokenTotal += stepTokens(queryStep);

  console.log(`[daily-workflow] day ${day} draft`);
  let draftStep = await runStructuredStep({
    day,
    runtime: collaboration,
    agentHandle: "editor",
    schema: articleDraftSchema,
    eventType: "message",
    replyTo: queryStep.event,
    mentions: [{ agentId: "editor-in-chief", agentName: "总编 Agent" }],
    stepKind: "draft",
    prompt: draftPrompt({ focusTopics: agenda.focusTopics, blockedTopics: agenda.blockedTopics, note: agenda.note, sources }),
  });
  tokenTotal += stepTokens(draftStep);
  let drafts = normalizeDrafts(day, draftStep.data.articles, sources);

  console.log(`[daily-workflow] day ${day} review`);
  let reviewStep = await runStructuredStep<ReviewOutput>({
    day,
    runtime: collaboration,
    agentHandle: "editor-in-chief",
    schema: reviewSchema,
    eventType: "decision",
    replyTo: draftStep.event,
    mentions: [{ agentId: "editor", agentName: "编辑 Agent" }],
    stepKind: "review",
    prompt: reviewPrompt(drafts),
  });
  tokenTotal += stepTokens(reviewStep);
  let review = reviewStep.data;

  if (review.decision === "reject") {
    console.log(`[daily-workflow] day ${day} revise`);
    draftStep = await runStructuredStep({
      day,
      runtime: collaboration,
      agentHandle: "editor",
      schema: articleDraftSchema,
      eventType: "message",
      replyTo: reviewStep.event,
      mentions: [{ agentId: "editor-in-chief", agentName: "总编 Agent" }],
      stepKind: "revise",
      prompt: revisePrompt({ review, drafts }),
    });
    tokenTotal += stepTokens(draftStep);
    drafts = normalizeDrafts(day, draftStep.data.articles, sources);
    reviewStep = await runStructuredStep<ReviewOutput>({
      day,
      runtime: collaboration,
      agentHandle: "editor-in-chief",
      schema: reviewSchema,
      eventType: "decision",
      replyTo: draftStep.event,
      mentions: [{ agentId: "editor", agentName: "编辑 Agent" }],
      stepKind: "review-after-revise",
      prompt: reviewPrompt(drafts),
    });
    tokenTotal += stepTokens(reviewStep);
    review = reviewStep.data;
  }

  console.log(`[daily-workflow] day ${day} publish`);
  const publishResult = await publishArticleTool.execute({ articles: drafts });
  const publishStep = await runTextStep({
    day,
    runtime: collaboration,
    agentHandle: "editor",
    eventType: "tool_result",
    replyTo: reviewStep.event,
    stepKind: "publish-summary",
    toolSummary: {
      tool: publishArticleTool.name,
      input: `${drafts.length} 篇已审核稿件`,
      result: `写入 ${publishResult.count} 篇已发布文章，并生成文章级记忆。`,
    },
    prompt: `已发布 ${publishResult.count} 篇文章：${publishResult.articles.map((article) => article.titleZh).join("；")}。请用具体标题向总编汇报发布结果。`,
  });
  tokenTotal += stepTokens(publishStep);
  writeArticleMemory(day, publishResult.articles, publishStep.trace);

  const averageQuality = averageScore(drafts);
  const baseReach = socialReach(averageQuality, base.reputation, drafts.length);
  const growthReach = await runGrowthDistributionIfAvailable(day, collaboration, publishResult.articles, baseReach);
  const reach = baseReach + growthReach;
  const dau = nextDAU(base.dau, averageQuality, reach);
  const reputation = nextReputation(base.reputation, averageQuality, review.decision === "approve");
  const revenue = adRevenue(dau, reputation);
  const cost = Number(Math.max(0.01, tokenTotal * 0.000002).toFixed(2));
  const subscribers = nextSubscribers(base.subscribers, dau, averageQuality);
  const capital = nextCapital(base.capital, revenue, cost, drafts.length);
  const nextState: DayState = { day, capital, reputation, dau, subscribers, adRevenue: revenue, llmCost: cost, isBoardDay: day % 7 === 0 };
  upsertDay(nextState);

  console.log(`[daily-workflow] day ${day} settlement`);
  const settlementStep = await runTextStep({
    day,
    runtime: collaboration,
    agentHandle: "editor-in-chief",
    eventType: "tool_result",
    stepKind: "settlement",
    mentions: [
      { agentId: "editor", agentName: "编辑 Agent" },
      { agentId: "editor-in-chief", agentName: "总编 Agent" },
    ],
    toolSummary: {
      tool: "dailySettlement",
      input: `平均质量 ${averageQuality}，社交触达 ${reach}`,
      result: `Capital ¥${capital}，订阅 ${subscribers}`,
    },
    prompt: `今日结算完成：DAU ${dau}，Reputation ${reputation}，广告收入 ¥${revenue}，LLM token ${tokenTotal}。请向团队说明结果和一个明日注意点。`,
  });
  tokenTotal += stepTokens(settlementStep);
  recordSettlement(day, nextState, previous, settlementStep, averageQuality, reach);
  console.log(`[daily-workflow] day ${day} editor-note`);
  await writeEditorNote(day, collaboration, publishResult.articles, averageQuality, dau, reputation);
  console.log(`[daily-workflow] day ${day} growth`);
  await runGrowthProtocol(day, collaboration, { dau, reputation, capital, monthlyRevenue: revenue });
  await writeDailyRuleAndStructureEvents(day, collaboration, publishResult.count, publishResult.articles, publishStep.event, settlementStep.event);
  projectDay(day);

  if (nextState.isBoardDay) {
    const weeklyReport = await generateWeeklyReportForBoard(day, collaboration);
    const suspendResult = await suspendBoardWorkflowTool.execute({ day, weeklyReport });
    logEvent({
      day,
      ...agentMeta("总编"),
      eventType: "board",
      content: `生成董事会周报：${weeklyReport.summary}`,
      metadata: { workflow: boardWorkflow.name, step: "weekly-report", weeklyReport },
    });
    logEvent({
      day,
      ...agentMeta("董事会"),
      eventType: "board",
      content: "workflow.suspend：进入董事会日，等待后台确认或覆盖董事会自动指令。",
      metadata: { day, workflow: boardWorkflow.name, step: "await-board-input", status: suspendResult.status },
    });
  }

  return nextState;
}

async function runGrowthDistributionIfAvailable(day: number, runtime: ReturnType<typeof startDailyCollaboration>, articles: PublishedArticle[], baseReach: number) {
  if (!runtime.agents.some((agent) => agent.roleTemplate === "growth")) return 0;
  const tags = Array.from(new Set(articles.flatMap((article) => article.tags)));
  await runTextStep({
    day,
    runtime,
    agentHandle: "growth-agent",
    eventType: "tool_result",
    stepKind: "social-distribute",
    prompt: socialPrompt({ day, titles: articles.map((article) => article.titleZh), tags }),
    toolSummary: { tool: "sim.social.post", input: `${articles.length} 篇文章`, result: "生成社交分发计划并放大高质量触达。" },
  });
  return Math.round(baseReach * 0.35);
}

function recordSettlement(day: number, state: DayState, previous: ReturnType<typeof getLatestDay>, settlementStep: { event: { id: string; seq: number }; trace: Record<string, unknown> }, averageQuality: number, reach: number) {
  const event = addLayerEvent({
    day,
    actorId: "editor-in-chief",
    actorName: "总编 Agent",
    layer: "resource",
    eventType: "settlement",
    action: "daily_settlement",
    content: `资源织网结算：由 Mastra Agent 事件 #${settlementStep.event.seq} 触发，DAU ${state.dau}，Reputation ${state.reputation}，广告收入 ¥${state.adRevenue}。`,
    payload: { ...settlementStep.trace, averageQuality, socialReach: reach, capital: state.capital, subscribers: state.subscribers },
    refs: { reply_to: settlementStep.event.id },
  });
  recordDailySettlement(state, previous, event.id, { averageQuality, socialReach: reach });
}

async function writeEditorNote(day: number, runtime: ReturnType<typeof startDailyCollaboration>, articles: PublishedArticle[], averageQuality: number, dau: number, reputation: number) {
  const topTags = formatTopTags(articles);
  const noteStep = await runStructuredStep({
    day,
    runtime,
    agentHandle: "editor-in-chief",
    schema: editorNoteSchema,
    eventType: "message",
    stepKind: "editor-note",
    prompt: editorNotePrompt({ day, topTags, averageScore: averageQuality, dau, reputation }),
  });
  updateDayEditorNote(day, noteStep.data.note);
}

async function runGrowthProtocol(day: number, runtime: ReturnType<typeof startDailyCollaboration>, metrics: { dau: number; reputation: number; capital: number; monthlyRevenue: number }) {
  const fallbackRole = growthRoleFromThreshold(metrics);
  const decisionStep = await runStructuredStep<GrowthDecisionOutput>({
    day,
    runtime,
    agentHandle: "editor-in-chief",
    schema: growthDecisionSchema,
    eventType: "decision",
    stepKind: "growth-check",
    prompt: growthPrompt({
      ...metrics,
      employees: listActiveEmployeeLabels().map((item) => `${item.display_name}(${item.role_template})`).join("、"),
      thresholdHint: growthThresholdHint({ status: "maintain", reason: "pending" }, fallbackRole),
    }),
  });
  const decision = enforceGrowthThreshold(decisionStep.data, fallbackRole);
  addLayerEvent({
    day,
    actorId: "editor-in-chief",
    actorName: "总编 Agent",
    layer: "growth",
    eventType: "growth_trigger",
    action: "growth_protocol_check",
    content: decision.reason,
    payload: { ...decisionStep.trace, ...decision },
    refs: { target_table: "growth_signals" },
  });
  if (decision.status === "expand" && decision.newAgentRole) {
    spawnActiveEmployee({
      day,
      displayName: decision.newAgentName ?? defaultAgentName(decision.newAgentRole),
      roleTemplate: decision.newAgentRole,
      agentHandle: `${decision.newAgentRole}-agent`,
      systemPrompt: `我是第 ${day} 天孵化的 Agent。职责原因：${decision.reason}`,
      reason: decision.reason,
    });
  }
}

async function writeDailyRuleAndStructureEvents(day: number, runtime: ReturnType<typeof startDailyCollaboration>, articleCount: number, articles: PublishedArticle[], publishEvent: { id: string }, settlementEvent: { id: string }) {
  addLayerEvent({
    day,
    actorId: "editor-in-chief",
    actorName: "总编 Agent",
    layer: "rules",
    eventType: "rule_trigger",
    action: "daily_rule_check",
    content: `规则执行：发布 ${articleCount} 篇，source_url 完整，标题长度已由结构化 schema 和发布前归一化约束。`,
    payload: { ...runtime, articleCount, rules: ["HARD_SOURCE_URL_REQUIRED", "SOFT_DAILY_10_ARTICLES", "SOFT_TITLE_MAX_20"] },
    refs: { target_table: "published_articles", article_ids: articles.map((article) => article.id), reply_to: publishEvent.id },
  });
  addLayerEvent({
    day,
    actorId: "editor-in-chief",
    actorName: "总编 Agent",
    layer: "structure",
    eventType: "org_change",
    action: "daily_contribution_rollup",
    content: `组织层日贡献汇总：${runtime.agents.map((agent) => `${agent.displayName}完成${agent.roleTemplate}`).join("；")}。`,
    payload: { employees: runtime.agents.map((agent) => agent.handle), articleCount },
    refs: { target_table: "employee_daily_contribution", reply_to: settlementEvent.id },
  });
}

function inheritDay(day: number, previous: ReturnType<typeof getLatestDay>): DayState {
  if (!previous) return initialDay(day);
  return { day, capital: previous.capital, reputation: previous.reputation, dau: previous.dau, subscribers: previous.subscribers, adRevenue: previous.adRevenue, llmCost: previous.llmCost, isBoardDay: day % 7 === 0 };
}

function initialDay(day: number): DayState {
  return { day, capital: 10000, reputation: 62, dau: 1200, subscribers: 260, adRevenue: 0, llmCost: 0, isBoardDay: day % 7 === 0 };
}

function growthRoleFromThreshold(metrics: { dau: number; monthlyRevenue: number }): GrowthRole | null {
  if (metrics.dau > 100000 && !employeeExistsByRole("column")) return "column";
  if (metrics.monthlyRevenue > 30000 && !employeeExistsByRole("business")) return "business";
  if (metrics.dau > 10000 && !employeeExistsByRole("growth")) return "growth";
  return null;
}

function enforceGrowthThreshold(decision: GrowthDecisionOutput, fallbackRole: GrowthRole | null): GrowthDecisionOutput {
  if (!fallbackRole) return decision;
  if (decision.status === "expand" && decision.newAgentRole) return decision;
  return {
    status: "expand",
    newAgentRole: fallbackRole,
    newAgentName: defaultAgentName(fallbackRole),
    reason: `硬阈值已触发 ${fallbackRole} 角色扩张，且当前组织中没有该 active Agent；为让增长协议真实改变组织结构，执行孵化。`,
  };
}

function defaultAgentName(role: GrowthRole) {
  if (role === "growth") return "增长 Agent";
  if (role === "business") return "商业 Agent";
  return "专栏 Agent";
}
