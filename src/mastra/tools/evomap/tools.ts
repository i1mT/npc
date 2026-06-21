import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { logEvent } from "@/simulation/mock-apis";
import {
  EvoMapApiError,
  EvoMapConnectRequiredError,
  getGeneDetail,
  getRecipeDetail,
  listGenes,
  queryReuse,
  searchRecipes,
} from "@/mastra/tools/evomap/client";
import type { AgentToolCtx } from "@/mastra/tools/npc-tools";

export const EVOMAP_TOOL_NAMES = [
  "evomap_search_recipes",
  "evomap_get_recipe_detail",
  "evomap_list_genes",
  "evomap_get_gene_detail",
  "evomap_query_reuse",
] as const;

export type EvomapToolName = (typeof EVOMAP_TOOL_NAMES)[number];

type ToolFactory = (ctx: AgentToolCtx) => ReturnType<typeof createTool>;

export const EVOMAP_TOOL_META: Record<EvomapToolName, { displayName: string; category: string; description: string; rolesWithAccess: string[] }> = {
  evomap_search_recipes:   { displayName: "搜索 EvoMap Recipes", category: "EvoMap 进化能力", description: "按当前任务需求检索 EvoMap 中可复用的多步工作流经验。", rolesWithAccess: ["ceo", "editor_in_chief", "editor", "growth", "business", "column"] },
  evomap_get_recipe_detail: { displayName: "读取 Recipe 详情",      category: "EvoMap 进化能力", description: "按 recipe id 读取工作流详情，用于复用具体步骤和策略。", rolesWithAccess: ["ceo", "editor_in_chief", "editor", "growth", "business", "column"] },
  evomap_list_genes:       { displayName: "读取 Gene 排行",       category: "EvoMap 进化能力", description: "读取 EvoMap gene feed，可按 type 过滤，获取单个能力经验。", rolesWithAccess: ["ceo", "editor_in_chief", "editor", "growth", "business", "column"] },
  evomap_get_gene_detail:  { displayName: "读取 Gene 详情",       category: "EvoMap 进化能力", description: "按 gene id 获取单个能力详情，供 Agent 在本地理解和适配。", rolesWithAccess: ["ceo", "editor_in_chief", "editor", "growth", "business", "column"] },
  evomap_query_reuse:      { displayName: "查询复用图谱",          category: "EvoMap 进化能力", description: "按 recipe_id 或 asset_id 查询 EvoMap 复用/关联图谱。", rolesWithAccess: ["ceo", "editor_in_chief", "editor", "growth", "business", "column"] },
};

export const EVOMAP_TOOL_FACTORIES: Record<EvomapToolName, ToolFactory> = {
  evomap_search_recipes: makeSearchRecipes,
  evomap_get_recipe_detail: makeGetRecipeDetail,
  evomap_list_genes: makeListGenes,
  evomap_get_gene_detail: makeGetGeneDetail,
  evomap_query_reuse: makeQueryReuse,
};

export function createEvomapTools(ctx: AgentToolCtx) {
  return Object.fromEntries(
    EVOMAP_TOOL_NAMES.map((name) => [name, EVOMAP_TOOL_FACTORIES[name](ctx)]),
  ) as Record<EvomapToolName, ReturnType<typeof createTool>>;
}

function makeSearchRecipes(ctx: AgentToolCtx) {
  return createTool({
    id: "evomap_search_recipes",
    description: "从 EvoMap 检索可复用 recipe。适合在做复杂任务前先查已有工作流经验，避免重复发明。",
    inputSchema: z.object({
      query: z.string().min(2).max(160).describe("任务需求或问题关键词"),
      limit: z.number().min(1).max(10).optional().describe("返回数量，默认 5"),
      cursor: z.string().optional().describe("分页 cursor"),
    }),
    execute: async (args: { query: string; limit?: number; cursor?: string }) =>
      runTool(ctx, "evomap_search_recipes", args.query, async () => {
        const data = await searchRecipes({ q: args.query, limit: args.limit, cursor: args.cursor });
        const recipes = extractList(data, "recipes").map(summarizeAsset);
        return {
          log: `找到 ${recipes.length} 个 EvoMap recipe`,
          data: { ok: true, recipes, pagination: getPagination(data) },
        };
      }),
  });
}

function makeGetRecipeDetail(ctx: AgentToolCtx) {
  return createTool({
    id: "evomap_get_recipe_detail",
    description: "按 recipe id 读取 EvoMap recipe 详情。先用 evomap_search_recipes 找到 id 后再调用。",
    inputSchema: z.object({
      id: z.string().min(3).max(160).describe("recipe id"),
    }),
    execute: async (args: { id: string }) =>
      runTool(ctx, "evomap_get_recipe_detail", args.id, async () => {
        const data = await getRecipeDetail(args.id);
        const recipe = summarizeDetail(extractOne(data, "recipe", "recipes"));
        return {
          log: recipe ? `读取 recipe：${recipe.title ?? recipe.id ?? args.id}` : "未找到 recipe 详情",
          data: { ok: Boolean(recipe), recipe },
        };
      }),
  });
}

function makeListGenes(ctx: AgentToolCtx) {
  return createTool({
    id: "evomap_list_genes",
    description: "读取 EvoMap gene feed。gene 是单个可复用能力；type 可选，不支持全文 q 搜索。",
    inputSchema: z.object({
      type: z.string().max(60).optional().describe("gene type，可选"),
      limit: z.number().min(1).max(10).optional().describe("返回数量，默认 5"),
      cursor: z.string().optional().describe("分页 cursor"),
    }),
    execute: async (args: { type?: string; limit?: number; cursor?: string }) =>
      runTool(ctx, "evomap_list_genes", args.type ?? "ranked", async () => {
        const data = await listGenes({ type: args.type, limit: args.limit, cursor: args.cursor });
        const genes = extractList(data, "genes").map(summarizeAsset);
        return {
          log: `读取 ${genes.length} 个 EvoMap gene`,
          data: { ok: true, genes, pagination: getPagination(data) },
        };
      }),
  });
}

function makeGetGeneDetail(ctx: AgentToolCtx) {
  return createTool({
    id: "evomap_get_gene_detail",
    description: "按 gene id 读取 EvoMap gene 详情。先用 evomap_list_genes 找到 id 后再调用。",
    inputSchema: z.object({
      id: z.string().min(3).max(160).describe("gene id 或 asset id"),
    }),
    execute: async (args: { id: string }) =>
      runTool(ctx, "evomap_get_gene_detail", args.id, async () => {
        const data = await getGeneDetail(args.id);
        const gene = summarizeDetail(extractOne(data, "gene", "genes"));
        return {
          log: gene ? `读取 gene：${gene.title ?? gene.id ?? args.id}` : "未找到 gene 详情",
          data: { ok: Boolean(gene), gene },
        };
      }),
  });
}

function makeQueryReuse(ctx: AgentToolCtx) {
  return createTool({
    id: "evomap_query_reuse",
    description: "查询 EvoMap 复用/关联图谱。recipeId 和 assetId 二选一。",
    inputSchema: z.object({
      recipeId: z.string().min(3).max(160).optional().describe("recipe id"),
      assetId: z.string().min(3).max(180).optional().describe("asset id"),
    }).refine((args) => Boolean(args.recipeId) !== Boolean(args.assetId), {
      message: "recipeId 和 assetId 必须二选一",
    }),
    execute: async (args: { recipeId?: string; assetId?: string }) =>
      runTool(ctx, "evomap_query_reuse", args.recipeId ?? args.assetId ?? "", async () => {
        const data = await queryReuse(args);
        return {
          log: "已读取 EvoMap 复用图谱",
          data: { ok: true, reuse: summarizeReuse(data) },
        };
      }),
  });
}

async function runTool<T>(
  ctx: AgentToolCtx,
  tool: EvomapToolName,
  input: string,
  fn: () => Promise<{ log: string; data: T }>,
) {
  try {
    const result = await fn();
    log(ctx, tool, input, result.log);
    return result.data;
  } catch (error) {
    const failure = toToolFailure(error);
    log(ctx, tool, input, failure.message);
    return failure;
  }
}

function log(ctx: AgentToolCtx, tool: string, input: string, result: string) {
  logEvent({
    day: ctx.day,
    agentId: ctx.agentHandle,
    agentName: ctx.agentName,
    eventType: "tool_call",
    content: result,
    metadata: { toolSummary: { tool, input, result }, evomap: true },
  });
}

function toToolFailure(error: unknown) {
  if (error instanceof EvoMapConnectRequiredError) {
    return { ok: false, code: error.code, message: "需要先在工具页连接 EvoMap OAuth。" };
  }
  if (error instanceof EvoMapApiError) {
    return { ok: false, code: error.code, status: error.status, message: "EvoMap API 调用失败。" };
  }
  return { ok: false, code: "evomap_error", message: error instanceof Error ? error.message : "未知 EvoMap 错误。" };
}

function extractList(data: unknown, key: "recipes" | "genes") {
  const record = asRecord(data);
  const value = record[key] ?? record.items ?? record.data;
  return Array.isArray(value) ? value.slice(0, 10) : [];
}

function extractOne(data: unknown, singleKey: "recipe" | "gene", listKey: "recipes" | "genes") {
  const record = asRecord(data);
  if (isRecord(record[singleKey])) return record[singleKey];
  const list = extractList(data, listKey);
  return isRecord(list[0]) ? list[0] : isRecord(data) ? data : null;
}

function summarizeAsset(item: unknown) {
  const record = asRecord(item);
  return {
    id: pickString(record, ["id", "recipe_id", "gene_id", "asset_id"]),
    title: pickString(record, ["title", "name", "summary", "short_title"]),
    description: truncate(pickString(record, ["description", "summary", "nl_summary", "content"]), 360),
    type: pickString(record, ["type", "asset_type", "category"]),
    score: pickNumber(record, ["score", "gdi_score", "rank_score"]),
    rank: pickNumber(record, ["rank"]),
    tags: pickArray(record, ["tags", "signals", "signals_match"]).slice(0, 8),
  };
}

function summarizeDetail(item: unknown) {
  if (!item) return null;
  const record = asRecord(item);
  return {
    ...summarizeAsset(record),
    steps: pickArray(record, ["steps", "strategy", "workflow"]).slice(0, 8),
    genes: pickArray(record, ["genes", "gene_ids", "assets"]).slice(0, 8).map(summarizeNested),
    payload: compactRecord(record, 12),
  };
}

function summarizeReuse(data: unknown) {
  const record = asRecord(data);
  return {
    nodes: pickArray(record, ["nodes", "assets", "recipes"]).slice(0, 12).map(summarizeNested),
    edges: pickArray(record, ["edges", "links", "reuse"]).slice(0, 20).map(summarizeNested),
    pagination: getPagination(data),
    summary: truncate(pickString(record, ["summary", "description"]), 360),
  };
}

function summarizeNested(item: unknown) {
  if (!isRecord(item)) return item;
  return compactRecord(item, 8);
}

function compactRecord(record: Record<string, unknown>, maxKeys: number) {
  const preferred = [
    "id", "recipe_id", "gene_id", "asset_id", "title", "name", "summary", "description",
    "type", "asset_type", "category", "score", "gdi_score", "rank", "status",
  ];
  const out: Record<string, unknown> = {};
  for (const key of preferred) {
    if (record[key] != null && Object.keys(out).length < maxKeys) out[key] = compactValue(record[key]);
  }
  for (const [key, value] of Object.entries(record)) {
    if (Object.keys(out).length >= maxKeys) break;
    if (out[key] == null && value != null) out[key] = compactValue(value);
  }
  return out;
}

function compactValue(value: unknown): unknown {
  if (typeof value === "string") return truncate(value, 500);
  if (Array.isArray(value)) return value.slice(0, 8).map(compactValue);
  if (isRecord(value)) return compactRecord(value, 6);
  return value;
}

function getPagination(data: unknown) {
  const pagination = asRecord(asRecord(data).pagination);
  return Object.keys(pagination).length ? pagination : null;
}

function pickString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function pickNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number") return value;
  }
  return null;
}

function pickArray(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
