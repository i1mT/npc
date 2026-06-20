import { getDay, getLatestDay, publishArticles, suspendBoardMeeting } from "@/db/sim";
import type { DayState, PublishedArticle, ToolDefinition } from "@/lib/types";

export const getSimStateTool: ToolDefinition<{ day?: number }, DayState | null> = {
  name: "getSimState",
  description: "读取指定 day 或最新 day 的经营状态快照。",
  execute: ({ day }) => {
    const row = day ? getDay(day) : getLatestDay();
    if (!row) return null;
    return {
      day: row.day,
      capital: row.capital,
      reputation: row.reputation,
      dau: row.dau,
      subscribers: row.subscribers,
      adRevenue: row.adRevenue,
      llmCost: row.llmCost,
      isBoardDay: row.isBoardDay,
    };
  },
};

export const publishArticleTool: ToolDefinition<{ articles: Omit<PublishedArticle, "id" | "createdAt">[] }, { count: number; articles: PublishedArticle[] }> = {
  name: "publishArticle",
  description: "写入 published_articles，作为 sim.publish() 的持久化落点。",
  execute: ({ articles }) => {
    const published = publishArticles(articles);
    return { count: published.length, articles: published };
  },
};

export const suspendBoardWorkflowTool: ToolDefinition<{ day: number; weeklyReport: Record<string, unknown> }, { status: "pending" }> = {
  name: "workflow.suspend",
  description: "董事会工作流生成周报后挂起，等待 /api/sim/board-decision resume。",
  execute: ({ day, weeklyReport }) => {
    suspendBoardMeeting(day, weeklyReport);
    return { status: "pending" };
  },
};

export const simTools = {
  getSimState: getSimStateTool,
  publishArticle: publishArticleTool,
  suspendBoardWorkflow: suspendBoardWorkflowTool,
};
