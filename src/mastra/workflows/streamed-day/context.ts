import { getLatestDay, listEvents, listPublishedArticles } from "@/db/sim";
import { getTopicPerformanceLast7Days } from "@/db/memory-queries";
import { agentFactory, type RuntimeAgentDef } from "@/mastra/agent-factory";
import type { CollaborationRuntime } from "@/mastra/collaboration";
import type { DayState } from "@/lib/types";
import type { StreamedDayRun } from "./types";
import { buildSystemPrompt } from "./prompts";

export async function buildRuntimeForRun(run: StreamedDayRun): Promise<CollaborationRuntime> {
  const agents = await agentFactory.loadActiveEmployees();
  await agentFactory.getMastraInstance();
  return { threadId: run.threadId, runtimeId: run.runtimeId, agents };
}

export async function buildInitialState(day: number): Promise<DayState> {
  const previous = await getLatestDay();
  return previous
    ? { day, capital: previous.capital, reputation: previous.reputation, dau: previous.dau, subscribers: previous.subscribers, adRevenue: previous.adRevenue, llmCost: previous.llmCost, isBoardDay: day % 7 === 0 }
    : { day, capital: 10000, reputation: 62, dau: 1200, subscribers: 260, adRevenue: 0, llmCost: 0, isBoardDay: day % 7 === 0 };
}

export async function buildChatHistory(day: number, agents: RuntimeAgentDef[]) {
  const base = await buildInitialState(day);
  const topicHistory = formatTopicHistory(await getTopicPerformanceLast7Days(day));
  const systemPrompt = buildSystemPrompt({ day, state: base, topicHistory, agents });
  const events = await listEvents(day);
  const lines = events
    .filter(event => event.eventType === "message")
    .map(event => `【${event.agentName}】${event.content}`);
  return [systemPrompt, "", ...lines, ""].join("\n");
}

export async function buildPublishContext(day: number) {
  const articles = await listPublishedArticles(day);
  return {
    done: articles.length > 0,
    count: articles.length,
    titles: articles.map(article => article.titleZh),
    totalQuality: articles.reduce((sum, article) => sum + article.qualityScore, 0),
  };
}

function formatTopicHistory(topics: Awaited<ReturnType<typeof getTopicPerformanceLast7Days>>) {
  return topics
    .slice(0, 8)
    .map(t => `${t.topic}：均分 ${t.avgScore.toFixed(1)} ${t.trend === "up" ? "↑" : t.trend === "down" ? "↓" : "→"} (${t.articleCount}篇)`)
    .join("\n");
}
