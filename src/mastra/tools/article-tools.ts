import { queryArticles } from "@/db/articles";
import { usedSourceIds } from "@/db/sim";
import type { ToolDefinition } from "@/lib/types";

export const queryArticlesTool: ToolDefinition<{ day: number; limit?: number }, ReturnType<typeof queryArticles>> = {
  name: "queryArticles",
  description: "查询 agidaily.db 文章池，过滤低价值抓取噪音并返回可发布候选稿源。",
  execute: async ({ day, limit = 30 }) => queryArticles({ day, limit, usedSourceIds: await usedSourceIds() }),
};

export const articleTools = {
  queryArticles: queryArticlesTool,
};
