/**
 * NPC simulation tools — MCP-compatible via createTool.
 *
 * Tools are created fresh each agent turn via createToolsForTurn(), with
 * context (day, agent handle, role, runtime) captured by closure.
 * This eliminates AsyncLocalStorage and makes context explicit.
 *
 * Permission sets are defined in TOOL_GRANTS_BY_ROLE: each role only
 * receives the tools it is allowed to call.
 */
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { queryArticles } from "@/db/articles";
import {
  getLatestDay,
  publishArticles as dbPublishArticles,
  usedSourceIds,
} from "@/db/sim";
import { getSimDb } from "@/db/connection";
import { getTopicPerformanceLast7Days } from "@/db/memory-queries";
import { logEvent } from "@/simulation/mock-apis";
import type { CollaborationRuntime } from "@/mastra/collaboration";

// ─── Context type ─────────────────────────────────────────────────────────────

export type AgentToolCtx = {
  day: number;
  agentHandle: string;
  agentName: string;
  roleTemplate: string;
  runtime: CollaborationRuntime;
  published: { done: boolean; count: number; titles: string[]; totalQuality: number };
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(ctx: AgentToolCtx, tool: string, input: string, result: string) {
  logEvent({
    day: ctx.day,
    agentId: ctx.agentHandle,
    agentName: ctx.agentName,
    eventType: "tool_call",
    content: result,
    metadata: { toolSummary: { tool, input, result } },
  });
}

// ─── Content tools ─────────────────────────────────────────────────────────────

function makeFetchArticles(ctx: AgentToolCtx) {
  return createTool({
    id: "fetch_articles",
    description: "从文章库获取今日候选稿源列表，用于选题和内容策划。每日建议调用一次。",
    inputSchema: z.object({
      limit: z.number().min(5).max(50).optional().describe("最多返回篇数，默认 30"),
    }),
    execute: async (args: { limit?: number }) => {
      const articles = queryArticles({
        day: ctx.day,
        limit: args.limit ?? 30,
        usedSourceIds: usedSourceIds(),
      });
      log(ctx, "fetch_articles", `limit=${args.limit ?? 30}`, `返回 ${articles.length} 篇候选`);
      return articles.map(a => ({
        id: a.id,           // ← publish_articles 的 sourceId 必须用这个值，不要用 URL
        title: a.title,
        summary: (a.summary ?? "").slice(0, 200),
        tags: a.tags.slice(0, 5),
      }));
    },
  });
}

const articleSchema = z.object({
  sourceId:      z.string().regex(/^[0-9a-f]{16,}$/, "sourceId 必须是 fetch_articles 返回的十六进制 id，不能是 URL").describe("fetch_articles 返回的 id 字段（十六进制字符串，如 a1b2c3d4e5f60001，绝对不能是 URL）"),
  titleZh:       z.string().max(60).describe("中文标题（不超过 60 字）"),
  summaryZh:     z.string().max(300).describe("中文摘要"),
  contentZh:     z.string().min(300).max(1500).describe("中文正文，300-1200 字"),
  qualityScore:  z.number().min(1).max(10).describe("质量评分 1-10"),
  qualityReason: z.string().max(150).optional().describe("评分理由一句话"),
  tags:          z.array(z.string()).max(5).describe("内容标签"),
});

function makePublishArticles(ctx: AgentToolCtx) {
  return createTool({
    id: "publish_articles",
    description: "发布审核通过的文章到今日日报。总编批准后由编辑调用，一次性提交 8-10 篇。",
    inputSchema: z.object({
      articles: z.array(articleSchema).min(6).max(12),
    }),
    execute: async (args: { articles: Array<z.infer<typeof articleSchema>> }) => {
      const valid = args.articles.filter(
        a => a.sourceId.length > 10 && !a.sourceId.startsWith("http"),
      );
      const toPublish = valid.map(a => ({
        day: ctx.day,
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
      const published = dbPublishArticles(toPublish);
      const titles = published.map(a => a.titleZh);
      const totalQuality = published.reduce((s, a) => s + a.qualityScore, 0);
      ctx.published.done = true;
      ctx.published.count = published.length;
      ctx.published.titles = titles;
      ctx.published.totalQuality = totalQuality;
      const articleCards = published.map(a => ({
        id: a.id, titleZh: a.titleZh, summaryZh: a.summaryZh, qualityScore: a.qualityScore, tags: a.tags,
      }));
      logEvent({
        day: ctx.day, agentId: ctx.agentHandle, agentName: ctx.agentName,
        eventType: "tool_call",
        content: `发布 ${published.length} 篇文章`,
        metadata: {
          toolSummary: { tool: "publish_articles", input: `${published.length} 篇`, result: `已发布 ${published.length} 篇` },
          publishedArticles: articleCards,
        },
      });
      return { ok: true, count: published.length, titles };
    },
  });
}

// ─── Metrics tools ─────────────────────────────────────────────────────────────

function makeGetMetrics(ctx: AgentToolCtx) {
  return createTool({
    id: "get_metrics",
    description: "查看公司当前核心经营指标：DAU、声誉值、资金余额、订阅人数、广告收入等。",
    inputSchema: z.object({}),
    execute: async (_: Record<string, never>) => {
      const row = getLatestDay();
      const summary = row
        ? `DAU ${row.dau} 声誉 ${row.reputation.toFixed(1)} 资金 ¥${Math.round(row.capital)} 订阅 ${row.subscribers}`
        : "暂无数据";
      log(ctx, "get_metrics", "", summary);
      if (!row) return null;
      return {
        day: row.day,
        dau: row.dau,
        reputation: row.reputation,
        capital: row.capital,
        subscribers: row.subscribers,
        adRevenue: row.adRevenue,
        llmCost: row.llmCost,
      };
    },
  });
}

function makeGetRevenue(ctx: AgentToolCtx) {
  return createTool({
    id: "get_revenue",
    description: "查看收入与支出明细：近期广告收入、运营成本、毛利率等财务数据。",
    inputSchema: z.object({
      days: z.number().min(1).max(30).optional().describe("回溯天数，默认 7"),
    }),
    execute: async (args: { days?: number }) => {
      const db = getSimDb();
      const n = args.days ?? 7;
      const rows = db
        .prepare("SELECT day, ad_revenue, llm_cost, reputation FROM sim_days ORDER BY day DESC LIMIT ?")
        .all(n) as { day: number; ad_revenue: number; llm_cost: number; reputation: number }[];
      const totalRevenue = rows.reduce((s, r) => s + r.ad_revenue, 0);
      const totalCost = rows.reduce((s, r) => s + r.llm_cost, 0);
      const summary = `近 ${n} 天：总收入 ¥${totalRevenue.toFixed(0)}  总成本 ¥${totalCost.toFixed(0)}`;
      log(ctx, "get_revenue", `days=${n}`, summary);
      return { days: rows, totalRevenue, totalCost, netIncome: totalRevenue - totalCost };
    },
  });
}

// ─── Memory tools ─────────────────────────────────────────────────────────────

const MEMORY_MAX_CHARS = 800;

function makeReadMemory(ctx: AgentToolCtx) {
  return createTool({
    id: "read_memory",
    description: "读取自己的工作记忆（过去积累的洞察、策略、经验）以及近期话题表现数据。",
    inputSchema: z.object({}),
    execute: async (_: Record<string, never>) => {
      const db = getSimDb();
      const emp = db.prepare("SELECT memory FROM employees WHERE agent_handle = ?").get(ctx.agentHandle) as { memory: string | null } | null;
      const personalMemory = emp?.memory ?? "（暂无记忆）";
      const topics = getTopicPerformanceLast7Days(ctx.day);
      log(ctx, "read_memory", "", `个人记忆 ${personalMemory.length} 字，话题数据 ${topics.length} 条`);
      return { personalMemory, topicPerformance: topics.slice(0, 15) };
    },
  });
}

function makeWriteMemory(ctx: AgentToolCtx) {
  return createTool({
    id: "write_memory",
    description: `更新自己的工作记忆（最多 ${MEMORY_MAX_CHARS} 字）。内容应反映今日工作洞察、用户/市场反应，而非仅列文章标题。新内容会替换旧内容，请保留重要历史。`,
    inputSchema: z.object({
      memory: z.string().max(MEMORY_MAX_CHARS).describe("完整的新记忆内容（Markdown），包含今日新增洞察和保留的重要历史记忆"),
    }),
    execute: async (args: { memory: string }) => {
      const db = getSimDb();
      const trimmed = args.memory.slice(0, MEMORY_MAX_CHARS);
      db.prepare("UPDATE employees SET memory = ? WHERE agent_handle = ?").run(trimmed, ctx.agentHandle);
      logEvent({
        day: ctx.day, agentId: ctx.agentHandle, agentName: ctx.agentName,
        eventType: "memory_write",
        content: trimmed.slice(0, 120),
        metadata: { toolSummary: { tool: "write_memory", input: `${trimmed.length} 字`, result: "记忆已更新" } },
      });
      log(ctx, "write_memory", `${trimmed.length} 字`, "记忆已更新");
      return { ok: true, chars: trimmed.length, maxChars: MEMORY_MAX_CHARS };
    },
  });
}

// ─── Soul tools ───────────────────────────────────────────────────────────────

function makeUpdateMySoul(ctx: AgentToolCtx) {
  return createTool({
    id: "update_my_soul",
    description: "更新自己的人格特质、价值观、工作风格描述（soul）。在经历重大事件后可以进化自己的角色认知。",
    inputSchema: z.object({
      soul:   z.string().min(30).max(600).describe("新的 soul 描述（Markdown 格式），描述人格、价值观和工作风格"),
      reason: z.string().max(150).describe("更新原因，简述什么事件触发了这次进化"),
    }),
    execute: async (args: { soul: string; reason: string }) => {
      const db = getSimDb();
      db.prepare("UPDATE employees SET soul = ? WHERE agent_handle = ?").run(args.soul, ctx.agentHandle);
      logEvent({
        day: ctx.day, agentId: ctx.agentHandle, agentName: ctx.agentName,
        eventType: "memory_write",
        content: `[Soul 进化] ${args.reason}`,
        metadata: { toolSummary: { tool: "update_my_soul", input: args.reason, result: "soul 已更新" } },
      });
      log(ctx, "update_my_soul", args.reason, "soul 已更新");
      return { ok: true };
    },
  });
}

// ─── Org tools (CEO / editor-in-chief) ────────────────────────────────────────

function makeListEmployees(ctx: AgentToolCtx) {
  return createTool({
    id: "list_employees",
    description: "查看当前所有在职员工：姓名、角色、加入日期等。",
    inputSchema: z.object({}),
    execute: async (_: Record<string, never>) => {
      const db = getSimDb();
      const rows = db
        .prepare("SELECT display_name, role_template, agent_handle, joined_day FROM employees WHERE status='active' ORDER BY joined_day")
        .all() as { display_name: string; role_template: string; agent_handle: string; joined_day: number }[];
      log(ctx, "list_employees", "", `在职员工 ${rows.length} 人`);
      return rows;
    },
  });
}

function makeHireEmployee(ctx: AgentToolCtx) {
  return createTool({
    id: "hire_employee",
    description: "招聘新员工（新 Agent）加入公司团队。需要提供姓名、角色、系统提示和灵魂描述。",
    inputSchema: z.object({
      display_name:  z.string().min(2).max(20).describe("员工姓名"),
      role_template: z.enum(["editor", "growth", "business", "column", "editor_in_chief"]).describe("角色模板"),
      system_prompt: z.string().min(50).max(600).describe("员工的职责和工作指令"),
      soul:          z.string().min(20).max(400).describe("员工的人格特质和价值观描述"),
      reason:        z.string().max(150).describe("招聘原因"),
    }),
    execute: async (args: {
      display_name: string;
      role_template: string;
      system_prompt: string;
      soul: string;
      reason: string;
    }) => {
      const db = getSimDb();
      const roleKey = args.role_template as keyof typeof TOOL_GRANTS_BY_ROLE;
      const grantedTools = JSON.stringify(TOOL_GRANTS_BY_ROLE[roleKey] ?? TOOL_GRANTS_BY_ROLE.editor);
      const handle = `${args.role_template.replace("_", "-")}-${randomUUID().slice(0, 8)}`;
      const id = randomUUID();
      db.prepare(
        `INSERT INTO employees (id, display_name, role_template, status, joined_day, system_prompt, soul, tools_granted, agent_handle, caused_by_event)
         VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
      ).run(id, args.display_name, args.role_template, ctx.day, args.system_prompt, args.soul, grantedTools, handle, `hire:${ctx.agentHandle}:day${ctx.day}`);
      logEvent({
        day: ctx.day, agentId: ctx.agentHandle, agentName: ctx.agentName,
        eventType: "org_change",
        content: `招聘 ${args.display_name}（${args.role_template}）— ${args.reason}`,
        metadata: { toolSummary: { tool: "hire_employee", input: args.display_name, result: `已创建 handle=${handle}` }, hiredEmployee: { id, display_name: args.display_name, role_template: args.role_template, handle } },
      });
      return { ok: true, handle, id };
    },
  });
}

function makeFireEmployee(ctx: AgentToolCtx) {
  return createTool({
    id: "fire_employee",
    description: "解雇员工（停用 Agent）。",
    inputSchema: z.object({
      agent_handle: z.string().describe("员工的 agent_handle"),
      reason:       z.string().max(150).describe("解雇原因"),
    }),
    execute: async (args: { agent_handle: string; reason: string }) => {
      const db = getSimDb();
      const result = db
        .prepare("UPDATE employees SET status='inactive', left_day=? WHERE agent_handle=? AND status='active'")
        .run(ctx.day, args.agent_handle);
      if (result.changes === 0) return { ok: false, error: "未找到该员工或已离职" };
      const emp = db.prepare("SELECT display_name FROM employees WHERE agent_handle=?").get(args.agent_handle) as { display_name: string } | null;
      logEvent({
        day: ctx.day,
        agentId: ctx.agentHandle,
        agentName: ctx.agentName,
        eventType: "org_change",
        content: `解雇 ${emp?.display_name ?? args.agent_handle} — ${args.reason}`,
        metadata: { toolSummary: { tool: "fire_employee", input: args.agent_handle, result: "已离职" } },
      });
      return { ok: true };
    },
  });
}

// ─── Company vision tools (CEO only) ─────────────────────────────────────────

function makeUpdateVision(ctx: AgentToolCtx) {
  return createTool({
    id: "update_vision",
    description: "更新公司使命与价值观宣言（mission charter）。仅 CEO 可用。",
    inputSchema: z.object({
      statement: z.string().min(50).max(500).describe("新的使命宣言"),
      values:    z.array(z.string().max(30)).min(2).max(6).describe("核心价值观列表"),
      reason:    z.string().max(150).describe("更新原因"),
    }),
    execute: async (args: { statement: string; values: string[]; reason: string }) => {
      const db = getSimDb();
      const existing = db.prepare("SELECT id FROM mission_charter ORDER BY created_at DESC LIMIT 1").get() as { id: string } | null;
      if (existing) {
        db.prepare("UPDATE mission_charter SET statement=?, values_json=? WHERE id=?")
          .run(args.statement, JSON.stringify(args.values), existing.id);
      } else {
        db.prepare("INSERT INTO mission_charter (id, statement, values_json, locked, created_at) VALUES (?,?,?,0,datetime('now'))")
          .run(randomUUID(), args.statement, JSON.stringify(args.values));
      }
      logEvent({
        day: ctx.day,
        agentId: ctx.agentHandle,
        agentName: ctx.agentName,
        eventType: "org_change",
        content: `[使命更新] ${args.reason}\n${args.statement}`,
        metadata: { toolSummary: { tool: "update_vision", input: args.reason, result: "使命宣言已更新" } },
      });
      return { ok: true };
    },
  });
}

function makeUpdateRules(ctx: AgentToolCtx) {
  return createTool({
    id: "update_rules",
    description: "添加或修改公司内容规则（如选题禁区、质量标准等）。",
    inputSchema: z.object({
      code:     z.string().max(40).describe("规则代码，如 NO_POLITICS"),
      category: z.string().max(20).describe("规则分类，如 content / quality / ethic"),
      text:     z.string().min(20).max(300).describe("规则描述"),
      reason:   z.string().max(100).describe("制定原因"),
    }),
    execute: async (args: { code: string; category: string; text: string; reason: string }) => {
      const db = getSimDb();
      db.prepare(
        `INSERT OR REPLACE INTO rules (id, code, category, text, threshold_json, effective_from, status)
         VALUES (?, ?, ?, ?, NULL, ?, 'active')`,
      ).run(randomUUID(), args.code, args.category, args.text, ctx.day);
      logEvent({
        day: ctx.day,
        agentId: ctx.agentHandle,
        agentName: ctx.agentName,
        eventType: "rule_trigger",
        content: `[规则更新] ${args.code}: ${args.text}`,
        metadata: { toolSummary: { tool: "update_rules", input: args.code, result: "规则已生效" } },
      });
      return { ok: true };
    },
  });
}

// ─── Advertising tools (business) ─────────────────────────────────────────────

function makeGetAdSlots(ctx: AgentToolCtx) {
  return createTool({
    id: "get_ad_slots",
    description: "查看当前可用的广告位库存及底价，用于制定广告销售策略。",
    inputSchema: z.object({}),
    execute: async (_: Record<string, never>) => {
      const db = getSimDb();
      const slots = db.prepare("SELECT slot_code, cpm_base FROM ad_inventory ORDER BY cpm_base DESC").all() as { slot_code: string; cpm_base: number }[];
      log(ctx, "get_ad_slots", "", `${slots.length} 个广告位`);
      return slots;
    },
  });
}

function makeRecordAdSale(ctx: AgentToolCtx) {
  return createTool({
    id: "record_ad_sale",
    description: "记录一笔广告销售（客户 × 广告位 × CPM）并写入今日收入。",
    inputSchema: z.object({
      client_name:  z.string().max(50).describe("广告主名称"),
      slot_code:    z.string().describe("广告位代码，来自 get_ad_slots"),
      cpm:          z.number().min(0).describe("实际 CPM（每千次展示价格，元）"),
      impressions:  z.number().min(1000).describe("预计展示量"),
      reason:       z.string().max(100).describe("成交策略或谈判要点"),
    }),
    execute: async (args: {
      client_name: string;
      slot_code: string;
      cpm: number;
      impressions: number;
      reason: string;
    }) => {
      const revenue = (args.cpm * args.impressions) / 1000;
      const db = getSimDb();
      const payload = JSON.stringify({ cpm: args.cpm, impressions: args.impressions, reason: args.reason });
      db.prepare(
        `INSERT INTO ad_placements (id, day, slot_id, advertiser, payload, revenue, caused_by_event)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), ctx.day, args.slot_code, args.client_name, payload, revenue, `tool:record_ad_sale:${ctx.agentHandle}`);
      logEvent({
        day: ctx.day,
        agentId: ctx.agentHandle,
        agentName: ctx.agentName,
        eventType: "growth_trigger",
        content: `广告成交：${args.client_name} × ${args.slot_code}，CPM=${args.cpm}，预计收入 ¥${revenue.toFixed(0)}`,
        metadata: { toolSummary: { tool: "record_ad_sale", input: args.client_name, result: `收入 ¥${revenue.toFixed(0)}` } },
      });
      return { ok: true, revenue };
    },
  });
}

// ─── Resource/budget tools ─────────────────────────────────────────────────────

function makeAuthorizeBudget(ctx: AgentToolCtx) {
  return createTool({
    id: "authorize_budget",
    description: "审批一笔运营支出（如工具订阅、市场活动、技术投入等）。",
    inputSchema: z.object({
      item:    z.string().max(100).describe("支出项目名称"),
      amount:  z.number().min(1).describe("金额（元）"),
      reason:  z.string().max(200).describe("必要性说明"),
    }),
    execute: async (args: { item: string; amount: number; reason: string }) => {
      logEvent({
        day: ctx.day,
        agentId: ctx.agentHandle,
        agentName: ctx.agentName,
        eventType: "settlement",
        content: `[支出审批] ${args.item}：¥${args.amount} — ${args.reason}`,
        metadata: { toolSummary: { tool: "authorize_budget", input: args.item, result: `已批 ¥${args.amount}` } },
      });
      return { ok: true, approved: args.amount };
    },
  });
}

// ─── Tool factory: create per-turn context-bound toolsets ─────────────────────

export type ToolName =
  | "fetch_articles" | "publish_articles"
  | "get_metrics" | "get_revenue"
  | "read_memory" | "write_memory" | "update_my_soul"
  | "list_employees" | "hire_employee" | "fire_employee"
  | "update_vision" | "update_rules"
  | "get_ad_slots" | "record_ad_sale"
  | "authorize_budget";

type ToolFactory = (ctx: AgentToolCtx) => ReturnType<typeof createTool>;

const ALL_TOOL_FACTORIES: Record<ToolName, ToolFactory> = {
  fetch_articles:   makeFetchArticles,
  publish_articles: makePublishArticles,
  get_metrics:      makeGetMetrics,
  get_revenue:      makeGetRevenue,
  read_memory:      makeReadMemory,
  write_memory:     makeWriteMemory,
  update_my_soul:   makeUpdateMySoul,
  list_employees:   makeListEmployees,
  hire_employee:    makeHireEmployee,
  fire_employee:    makeFireEmployee,
  update_vision:    makeUpdateVision,
  update_rules:     makeUpdateRules,
  get_ad_slots:     makeGetAdSlots,
  record_ad_sale:   makeRecordAdSale,
  authorize_budget: makeAuthorizeBudget,
};

/** Tools each role is permitted to call. */
export const TOOL_GRANTS_BY_ROLE: Record<string, ToolName[]> = {
  ceo: [
    "get_metrics", "get_revenue",
    "read_memory", "write_memory", "update_my_soul",
    "list_employees", "hire_employee", "fire_employee",
    "update_vision", "update_rules",
    "fetch_articles",
    "authorize_budget",
  ],
  editor_in_chief: [
    "fetch_articles",
    "get_metrics",
    "read_memory", "write_memory", "update_my_soul",
    "list_employees", "hire_employee",
    "authorize_budget",
  ],
  editor: [
    "fetch_articles", "publish_articles",
    "read_memory", "write_memory", "update_my_soul",
  ],
  growth: [
    "get_metrics", "get_revenue",
    "read_memory", "write_memory", "update_my_soul",
  ],
  business: [
    "get_metrics", "get_revenue",
    "get_ad_slots", "record_ad_sale",
    "read_memory", "write_memory", "update_my_soul",
    "authorize_budget",
  ],
  column: [
    "fetch_articles",
    "read_memory", "write_memory", "update_my_soul",
  ],
};

/**
 * Build a Mastra-compatible toolset for one agent turn.
 * Reads tools_granted from employees DB first; falls back to TOOL_GRANTS_BY_ROLE.
 * Tools are namespaced under "npc" → "npc.fetch_articles", etc.
 */
export function createToolsForTurn(ctx: AgentToolCtx, dbGrantedNames?: ToolName[]): Record<string, Record<string, ReturnType<typeof createTool>>> {
  const grantedNames = dbGrantedNames ?? TOOL_GRANTS_BY_ROLE[ctx.roleTemplate] ?? TOOL_GRANTS_BY_ROLE.editor;
  const tools: Record<string, ReturnType<typeof createTool>> = {};
  for (const name of grantedNames) {
    const factory = ALL_TOOL_FACTORIES[name];
    if (factory) tools[name] = factory(ctx);
  }
  return { npc: tools };
}

/** Tool catalog for the Tools dashboard page. */
export const TOOL_META: Record<ToolName, { displayName: string; category: string; description: string; rolesWithAccess: string[] }> = {
  fetch_articles:   { displayName: "获取候选文章",   category: "内容",   description: "从 AGI Daily 源库获取当日可发布的候选文章，包含标题、摘要、来源评分",           rolesWithAccess: ["editor_in_chief", "editor", "column"] },
  publish_articles: { displayName: "发布文章",       category: "内容",   description: "将总编批准的文章一次性发布到今日日报，更新 published_articles 表",              rolesWithAccess: ["editor"] },
  get_metrics:      { displayName: "查看经营指标",   category: "数据",   description: "获取 DAU、声誉值、资金余额、订阅人数、广告收入等核心运营数据",                   rolesWithAccess: ["editor_in_chief", "growth", "business", "ceo"] },
  get_revenue:      { displayName: "查看收入明细",   category: "数据",   description: "获取近期广告收入、LLM 成本、净利润等财务数据",                                  rolesWithAccess: ["editor_in_chief", "growth", "business", "ceo"] },
  read_memory:      { displayName: "读取工作记忆",   category: "记忆",   description: "读取自己的个人工作记忆和近期话题表现数据",                                      rolesWithAccess: ["editor_in_chief", "editor", "growth", "business", "column", "ceo"] },
  write_memory:     { displayName: "更新工作记忆",   category: "记忆",   description: "更新自己的工作记忆（最多 800 字），记录洞察、策略和市场反应",                    rolesWithAccess: ["editor_in_chief", "editor", "growth", "business", "column", "ceo"] },
  update_my_soul:   { displayName: "进化灵魂",       category: "记忆",   description: "更新自己的人格特质、价值观和工作风格描述（soul）",                              rolesWithAccess: ["editor_in_chief", "editor", "growth", "business", "column", "ceo"] },
  list_employees:   { displayName: "查看团队成员",   category: "组织",   description: "获取所有在职员工的姓名、角色、入职日期",                                        rolesWithAccess: ["editor_in_chief", "ceo"] },
  hire_employee:    { displayName: "招聘新员工",     category: "组织",   description: "创建新的 Agent 员工，分配角色、系统提示和灵魂",                                rolesWithAccess: ["editor_in_chief", "ceo"] },
  fire_employee:    { displayName: "解雇员工",       category: "组织",   description: "将员工状态改为 inactive，停止其参与日常协作",                                  rolesWithAccess: ["ceo"] },
  update_vision:    { displayName: "更新公司愿景",   category: "治理",   description: "修改公司使命宣言和核心价值观（mission charter），仅 CEO 可用",                  rolesWithAccess: ["ceo"] },
  update_rules:     { displayName: "更新规则库",     category: "治理",   description: "新增或修改内部运营规则",                                                        rolesWithAccess: ["ceo"] },
  get_ad_slots:     { displayName: "查看广告位",     category: "商业",   description: "获取可用广告位列表及当前 CPM 基准价格",                                         rolesWithAccess: ["business"] },
  record_ad_sale:   { displayName: "记录广告合同",   category: "商业",   description: "记录一笔广告销售合同，更新 ad_placements 表和当日收入",                          rolesWithAccess: ["business"] },
  authorize_budget: { displayName: "审批支出预算",   category: "商业",   description: "审批运营支出（工具订阅、市场活动等）并记录到日志",                              rolesWithAccess: ["editor_in_chief", "business", "ceo"] },
};
