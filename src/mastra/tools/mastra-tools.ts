/**
 * Mastra-native tool definitions (MCP-compatible).
 * Tools are registered with agents so the LLM decides when to call them.
 * AsyncLocalStorage passes day/agent context to tool execute functions.
 */
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { AsyncLocalStorage } from "node:async_hooks";
import { queryArticles } from "@/db/articles";
import { getLatestDay, publishArticles as dbPublishArticles, usedSourceIds } from "@/db/sim";
import { getTopicPerformanceLast7Days } from "@/db/memory-queries";
import { logEvent } from "@/simulation/mock-apis";
import type { CollaborationRuntime } from "@/mastra/collaboration";

// ─── Per-turn execution context ───────────────────────────────────────────────

export type AgentToolCtx = {
  day: number;
  agentHandle: string;
  agentName: string;
  runtime: CollaborationRuntime;
  published: { done: boolean; count: number; titles: string[]; totalQuality: number };
};

export const toolCtx = new AsyncLocalStorage<AgentToolCtx>();

function ctx() {
  const c = toolCtx.getStore();
  if (!c) throw new Error("Tool called outside of agent run context");
  return c;
}

async function logToolEvent(tool: string, input: string, result: string) {
  const c = ctx();
  await logEvent({
    day: c.day,
    agentId: c.agentHandle,
    agentName: c.agentName,
    eventType: "tool_call",
    content: result,
    metadata: { source: "mastra-tool", toolSummary: { tool, input, result } },
  });
}

// ─── Tool: fetch_articles ─────────────────────────────────────────────────────

export const fetchArticlesTool = createTool({
  id: "fetch_articles",
  description: "从文章库获取今日候选稿源。每日只调用一次，获取后按议程筛选。",
  inputSchema: z.object({
    limit: z.number().min(10).max(50).optional().describe("最多返回篇数，默认 30"),
  }),
  execute: async (args: { limit?: number }) => {
    const c = ctx();
    const articles = await queryArticles({
      day: c.day,
      limit: args.limit ?? 30,
      usedSourceIds: await usedSourceIds(),
    });
    await logToolEvent("fetch_articles", `day=${c.day} limit=${args.limit ?? 30}`, `返回 ${articles.length} 篇候选`);
    return articles.map(a => ({
      id: a.id,
      title: a.title,
      summary: (a.summary ?? "").slice(0, 180),
      tags: a.tags.slice(0, 4),
    }));
  },
});

// ─── Tool: publish_articles ───────────────────────────────────────────────────

const articleSchema = z.object({
  sourceId:      z.string().min(10).describe("来自 fetch_articles 返回的 id 字段（十六进制字符串）"),
  titleZh:       z.string().max(30).describe("中文标题"),
  summaryZh:     z.string().max(200).describe("中文摘要"),
  contentZh:     z.string().min(400).max(1200).describe("中文正文，400-1000 字"),
  qualityScore:  z.number().min(1).max(10).describe("质量评分 1-10"),
  qualityReason: z.string().max(100).describe("评分理由一句话").optional(),
  tags:          z.array(z.string()).max(5).describe("标签列表"),
});

export const publishArticlesTool = createTool({
  id: "publish_articles",
  description: "发布审核通过的文章到今日日报。只在总编批准后调用，一次性提交 8-10 篇。",
  inputSchema: z.object({
    articles: z.array(articleSchema).min(8).max(10),
  }),
  execute: async (args: { articles: Array<z.infer<typeof articleSchema>> }) => {
    const c = ctx();
    const valid = args.articles.filter(a => !a.sourceId.startsWith("http") && a.sourceId.length > 10);
    const toPublish = valid.map(a => ({
      day: c.day,
      sourceId: a.sourceId,
      sourceUrl: "",
      titleZh: a.titleZh,
      summaryZh: a.summaryZh,
      contentZh: a.contentZh,
      qualityScore: a.qualityScore,
      qualityReason: a.qualityReason ?? "",
      tags: a.tags,
      imageUrl: null as string | null,
    }));
    const published = await dbPublishArticles(toPublish);
    const titles = published.map(a => a.titleZh);
    const totalQuality = published.reduce((s, a) => s + a.qualityScore, 0);
    c.published.done = true;
    c.published.count = published.length;
    c.published.titles = titles;
    c.published.totalQuality = totalQuality;
    await logToolEvent("publish_articles", `${toPublish.length} 篇`, `已发布 ${published.length} 篇：${titles.slice(0, 3).join("、")}…`);
    return { count: published.length, titles };
  },
});

// ─── Tool: get_metrics ────────────────────────────────────────────────────────

export const getMetricsTool = createTool({
  id: "get_metrics",
  description: "查看公司当前经营指标：DAU、声誉、资金、订阅数等。",
  inputSchema: z.object({}),
  execute: async (_args: Record<string, never>) => {
    const c = ctx();
    const row = await getLatestDay();
    await logToolEvent("get_metrics", `day=${c.day}`, row ? `DAU ${row.dau} 声誉 ${row.reputation.toFixed(1)} 资金 ¥${Math.round(row.capital)}` : "暂无数据");
    if (!row) return null;
    return { day: row.day, dau: row.dau, reputation: row.reputation, capital: row.capital, subscribers: row.subscribers };
  },
});

// ─── Tool: read_memory ────────────────────────────────────────────────────────

export const readMemoryTool = createTool({
  id: "read_memory",
  description: "读取近期话题表现数据，用于制定选题方向、避免重复选题。",
  inputSchema: z.object({
    days: z.number().min(1).max(14).optional().describe("回溯天数，默认 7"),
  }),
  execute: async (args: { days?: number }) => {
    const c = ctx();
    const topics = await getTopicPerformanceLast7Days(c.day);
    await logToolEvent("read_memory", `最近 ${args.days ?? 7} 天`, `得到 ${topics.length} 个话题表现记录`);
    return topics.slice(0, 20);
  },
});

// ─── Tool: write_memory ───────────────────────────────────────────────────────

export const writeMemoryTool = createTool({
  id: "write_memory",
  description: "将今日工作要点写入编辑记忆，供明日参考。",
  inputSchema: z.object({
    entries: z.array(z.string().max(100)).max(10).describe("记忆条目列表"),
  }),
  execute: async (args: { entries: string[] }) => {
    const c = ctx();
    for (const entry of args.entries) {
      await logEvent({
        day: c.day,
        agentId: c.agentHandle,
        agentName: c.agentName,
        eventType: "memory_write",
        content: entry,
        metadata: { source: "mastra-tool", toolSummary: { tool: "write_memory", input: entry, result: "已写入" } },
      });
    }
    return { ok: true, count: args.entries.length };
  },
});

// ─── Tools per role ───────────────────────────────────────────────────────────

export const TOOLS_BY_ROLE: Record<string, Record<string, ReturnType<typeof createTool>>> = {
  editor_in_chief: { get_metrics: getMetricsTool, read_memory: readMemoryTool, write_memory: writeMemoryTool, fetch_articles: fetchArticlesTool },
  editor:          { fetch_articles: fetchArticlesTool, publish_articles: publishArticlesTool, read_memory: readMemoryTool, write_memory: writeMemoryTool },
  growth:          { get_metrics: getMetricsTool, write_memory: writeMemoryTool },
  business:        { get_metrics: getMetricsTool, write_memory: writeMemoryTool },
  column:          { fetch_articles: fetchArticlesTool, read_memory: readMemoryTool, write_memory: writeMemoryTool },
};
