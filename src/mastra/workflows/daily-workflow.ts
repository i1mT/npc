import { addLayerEvent, ensureBaselineData, getLatestDay, projectDay, recordDailySettlement, upsertDay } from "@/db/sim";
import type { DayState, PublishedArticle, WorkflowDefinition } from "@/lib/types";
import { runAgentStep, startDailyCollaboration } from "@/mastra/collaboration";
import { queryArticlesTool } from "@/mastra/tools/article-tools";
import { publishArticleTool, suspendBoardWorkflowTool } from "@/mastra/tools/sim-tools";
import { boardWorkflow, weeklyReportForBoard } from "@/mastra/workflows/board-meeting";
import { agentMeta, logEvent } from "@/simulation/mock-apis";
import { adRevenue, llmCost, nextCapital, nextDAU, nextReputation, nextSubscribers, socialReach } from "@/simulation/formulas";

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

function asPublished(articles: Omit<PublishedArticle, "id" | "createdAt">[]): PublishedArticle[] {
  return articles.map((article) => ({ ...article, id: "draft", createdAt: new Date().toISOString() }));
}

export async function runDailyWorkflow(day: number): Promise<DayState> {
  ensureBaselineData();
  const collaboration = startDailyCollaboration(day);
  const previous = getLatestDay();
  const base: DayState = previous
    ? {
        day,
        capital: previous.capital,
        reputation: previous.reputation,
        dau: previous.dau,
        subscribers: previous.subscribers,
        adRevenue: previous.adRevenue,
        llmCost: previous.llmCost,
        isBoardDay: day % 7 === 0,
      }
    : { day, capital: 10000, reputation: 62, dau: 1200, subscribers: 260, adRevenue: 0, llmCost: 0, isBoardDay: day % 7 === 0 };

  const agendaStep = await runAgentStep<{
    focusTopics: string[];
    blockedTopics: string[];
    note: string;
  }>({
    day,
    runtime: collaboration,
    agentHandle: "editor-in-chief",
    kind: "agenda",
    eventType: "decision",
    mentions: [{ agentId: "editor", agentName: "编辑 Agent" }],
    context: { day, reputation: base.reputation },
  });
  const agenda = agendaStep.data;

  const sources = await queryArticlesTool.execute({ day, limit: 30 });
  const queryStep = await runAgentStep<{ count: number; firstIds: string[]; focusTopics: string[] }>({
    day,
    runtime: collaboration,
    agentHandle: "editor",
    kind: "query-report",
    eventType: "tool_call",
    replyTo: agendaStep.event,
    mentions: [{ agentId: "editor-in-chief", agentName: "总编 Agent" }],
    toolSummary: {
      tool: queryArticlesTool.name,
      input: `Day ${day}，limit=30，主题=${agenda.focusTopics.join("、")}`,
      result: `得到 ${sources.length} 篇候选；前 5 个来源：${sources.slice(0, 5).map((source) => source.id).join("、")}`,
    },
    context: { count: sources.length, firstIds: sources.slice(0, 5).map((source) => source.id), focusTopics: agenda.focusTopics },
  });

  let draftStep = await runAgentStep<Omit<PublishedArticle, "id" | "createdAt">[]>({
    day,
    runtime: collaboration,
    agentHandle: "editor",
    kind: "draft",
    eventType: "message",
    replyTo: queryStep.event,
    mentions: [{ agentId: "editor-in-chief", agentName: "总编 Agent" }],
    context: { day, sources },
  });
  let drafts = draftStep.data;

  let reviewStep = await runAgentStep<{ decision: "approve" | "reject"; reason: string; averageScore: number }>({
    day,
    runtime: collaboration,
    agentHandle: "editor-in-chief",
    kind: "review",
    eventType: "decision",
    replyTo: draftStep.event,
    mentions: [{ agentId: "editor", agentName: "编辑 Agent" }],
    context: { articles: asPublished(drafts) },
  });
  let review = reviewStep.data;

  if (review.decision === "reject") {
    draftStep = await runAgentStep<Omit<PublishedArticle, "id" | "createdAt">[]>({
      day,
      runtime: collaboration,
      agentHandle: "editor",
      kind: "revise",
      eventType: "message",
      replyTo: reviewStep.event,
      mentions: [{ agentId: "editor-in-chief", agentName: "总编 Agent" }],
      context: { drafts },
    });
    drafts = draftStep.data;
    reviewStep = await runAgentStep<{ decision: "approve" | "reject"; reason: string; averageScore: number }>({
      day,
      runtime: collaboration,
      agentHandle: "editor-in-chief",
      kind: "review",
      eventType: "decision",
      replyTo: draftStep.event,
      mentions: [{ agentId: "editor", agentName: "编辑 Agent" }],
      context: { articles: asPublished(drafts) },
    });
    review = reviewStep.data;
  }

  const publishResult = await publishArticleTool.execute({ articles: drafts });
  const publishStep = await runAgentStep<{ count: number; articleIds: string[] }>({
    day,
    runtime: collaboration,
    agentHandle: "editor",
    kind: "publish-summary",
    eventType: "tool_result",
    replyTo: reviewStep.event,
    toolSummary: {
      tool: publishArticleTool.name,
      input: `${drafts.length} 篇已审核稿件`,
      result: `写入 ${publishResult.count} 篇已发布文章，并生成文章级记忆。`,
    },
    context: { count: publishResult.count, articleIds: publishResult.articles.map((article) => article.id) },
  });
  for (const article of publishResult.articles) {
    addLayerEvent({
      day,
      actorId: "editor",
      actorName: "编辑 Agent",
      layer: "memory",
      eventType: "memory_write",
      action: "write_editorial_memory",
      content: `写入文章记忆：${article.titleZh}`,
      payload: {
        ...publishStep.trace,
        articleId: article.id,
        sourceId: article.sourceId,
        tags: article.tags,
        qualityScore: article.qualityScore,
        reason: article.qualityReason,
      },
      refs: { target_table: "published_articles", target_article_id: article.id },
    });
  }

  const averageQuality = Number((drafts.reduce((sum, article) => sum + article.qualityScore, 0) / drafts.length).toFixed(1));
  const reach = socialReach(averageQuality, base.reputation, drafts.length);
  const dau = nextDAU(base.dau, averageQuality, reach);
  const reputation = nextReputation(base.reputation, averageQuality, true);
  const revenue = adRevenue(dau, reputation);
  const cost = llmCost(drafts.length, false);
  const subscribers = nextSubscribers(base.subscribers, dau, averageQuality);
  const capital = nextCapital(base.capital, revenue, cost, drafts.length);
  const nextState: DayState = { day, capital, reputation, dau, subscribers, adRevenue: revenue, llmCost: cost, isBoardDay: day % 7 === 0 };
  upsertDay(nextState);

  const settlementStep = await runAgentStep<{
    averageQuality: number;
    socialReach: number;
    capital: number;
    subscribers: number;
    protocol: string;
  }>({
    day,
    runtime: collaboration,
    agentHandle: "editor-in-chief",
    kind: "settlement",
    eventType: "tool_result",
    mentions: [
      { agentId: "editor", agentName: "编辑 Agent" },
      { agentId: "editor-in-chief", agentName: "总编 Agent" },
    ],
    toolSummary: {
      tool: "dailySettlement",
      input: `平均质量 ${averageQuality}，社交触达 ${reach}`,
      result: `Capital ¥${capital}，订阅 ${subscribers}`,
    },
    context: { averageQuality, socialReach: reach, capital, subscribers, reputation, dau, revenue },
  });
  const settlementEvent = addLayerEvent({
    day,
    actorId: "editor-in-chief",
    actorName: "总编 Agent",
    layer: "resource",
    eventType: "settlement",
    action: "daily_settlement",
    content: `资源织网结算：由 Mastra Agent 事件 #${settlementStep.event.seq} 触发，DAU ${dau}，Reputation ${reputation}，广告收入 ¥${revenue}。`,
    payload: {
      ...settlementStep.trace,
      averageQuality,
      socialReach: reach,
      capital,
      subscribers,
      protocol: settlementStep.data.protocol,
    },
    refs: { reply_to: settlementStep.event.id },
  });
  recordDailySettlement(nextState, previous ? {
    day: previous.day,
    capital: previous.capital,
    reputation: previous.reputation,
    dau: previous.dau,
    subscribers: previous.subscribers,
    adRevenue: previous.adRevenue,
    llmCost: previous.llmCost,
    isBoardDay: previous.isBoardDay,
  } : null, settlementEvent.id, { averageQuality, socialReach: reach });
  const ruleStep = await runAgentStep<{ articleCount: number; rules: string[]; outcome: string }>({
    day,
    runtime: collaboration,
    agentHandle: "editor-in-chief",
    kind: "rule-check",
    eventType: "decision",
    replyTo: publishStep.event,
    context: { articleCount: publishResult.count },
  });
  addLayerEvent({
    day,
    actorId: "editor-in-chief",
    actorName: "总编 Agent",
    layer: "rules",
    eventType: "rule_trigger",
    action: "daily_rule_check",
    content: ruleStep.text,
    payload: { ...ruleStep.trace, articleCount: publishResult.count, rules: ruleStep.data.rules },
    refs: { target_table: "published_articles", article_ids: publishResult.articles.map((article) => article.id) },
  });
  const structureStep = await runAgentStep<{ employees: string[]; articleCount: number; summary: string }>({
    day,
    runtime: collaboration,
    agentHandle: "editor-in-chief",
    kind: "structure-rollup",
    eventType: "message",
    replyTo: settlementStep.event,
    context: { articleCount: publishResult.count },
  });
  addLayerEvent({
    day,
    actorId: "editor-in-chief",
    actorName: "总编 Agent",
    layer: "structure",
    eventType: "org_change",
    action: "daily_contribution_rollup",
    content: structureStep.text,
    payload: { ...structureStep.trace, employees: structureStep.data.employees, articleCount: publishResult.count },
    refs: { target_table: "employee_daily_contribution" },
  });
  const growthStep = await runAgentStep<{ averageQuality: number; reputation: number; dau: number; capital: number; decision: string }>({
    day,
    runtime: collaboration,
    agentHandle: "editor-in-chief",
    kind: "growth-check",
    eventType: "decision",
    replyTo: settlementStep.event,
    context: { averageQuality, reputation, dau, capital },
  });
  addLayerEvent({
    day,
    actorId: "editor-in-chief",
    actorName: "总编 Agent",
    layer: "growth",
    eventType: "growth_trigger",
    action: "growth_protocol_check",
    content: growthStep.text,
    payload: { ...growthStep.trace, averageQuality, reputation, dau, capital, decision: growthStep.data.decision },
    refs: { target_table: "growth_signals" },
  });
  projectDay(day);

  if (nextState.isBoardDay) {
    const weeklyReport = weeklyReportForBoard(day);
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
      content: "workflow.suspend：进入董事会日，等待后台录入董事会指令。",
      metadata: { day, workflow: boardWorkflow.name, step: "await-board-input", status: suspendResult.status },
    });
  }

  return nextState;
}
