/**
 * Agentic daily loop.
 * Instead of a fixed workflow, agents receive a shared chat history and decide
 * what to say and which tools to call. The orchestrator only handles:
 *   - Routing based on @mentions
 *   - Settlement after publish_articles is called
 *   - Safety limits (max turns, timeout)
 */
import { randomUUID } from "node:crypto";
import { ensureBaselineData, getLatestDay, projectDay, recordDailySettlement, upsertDay, addLayerEvent } from "@/db/sim";
import { getTopicPerformanceLast7Days } from "@/db/memory-queries";
import { employeeExistsByRole, listActiveEmployeeLabels, spawnActiveEmployee } from "@/db/employees";
import { getSimDb } from "@/db/connection";
import { updateDayEditorNote } from "@/db/day-notes";
import type { DayState } from "@/lib/types";
import { agentFactory } from "@/mastra/agent-factory";
import { startDailyCollaboration, say, type CollaborationRuntime } from "@/mastra/collaboration";
import { createToolsForTurn, type AgentToolCtx } from "@/mastra/tools/npc-tools";
import { agentMeta, logEvent } from "@/simulation/mock-apis";
import { adRevenue, nextCapital, nextDAU, nextReputation, nextSubscribers, socialReach } from "@/simulation/formulas";
import { boardWorkflow, generateWeeklyReportForBoard } from "@/mastra/workflows/board-meeting";
import { suspendBoardWorkflowTool } from "@/mastra/tools/sim-tools";
import type { RoleTemplateName } from "@/mastra/role-templates";

// ─── @mention routing ─────────────────────────────────────────────────────────

// Map from display mention to agent handle
const MENTION_MAP: Record<string, string> = {
  "总编": "editor-in-chief",
  "总编辑": "editor-in-chief",
  "编辑": "editor",
  "增长": "growth-agent",
  "商业": "business-agent",
  "专栏": "column-agent",
};

function extractMentions(text: string): string[] {
  const re = /@([^\s@，。！？,.\!\?]{1,8})/g;
  const handles: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const handle = MENTION_MAP[m[1]];
    if (handle) handles.push(handle);
  }
  return [...new Set(handles)];
}

// ─── Text extraction (Mastra generate response) ───────────────────────────────

function extractText(output: unknown): string {
  const r = output as {
    text?: string;
    steps?: { text?: string; content?: { type?: string; text?: string }[] }[];
  };
  if (typeof r.text === "string" && r.text.trim()) return r.text.trim();
  for (const step of r.steps ?? []) {
    if (typeof step.text === "string" && step.text.trim()) return step.text.trim();
    for (const part of step.content ?? []) {
      if (part.type === "text" && typeof part.text === "string" && part.text.trim()) return part.text.trim();
    }
  }
  return "";
}

function extractTokens(output: unknown): { input: number; output: number } {
  const u = (output as { usage?: Record<string, number> }).usage ?? {};
  return {
    input:  u.inputTokens  ?? u.input_tokens  ?? u.promptTokens  ?? u.prompt_tokens     ?? 0,
    output: u.outputTokens ?? u.output_tokens ?? u.completionTokens ?? u.completion_tokens ?? 0,
  };
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(day: number, state: DayState, topicHistory: string, teamLabels: string): string {
  const date = new Date(Date.UTC(2026, 5, day)); // Day 1 = 2026-06-01
  const dateStr = date.toISOString().slice(0, 10);
  return [
    `今天是 Day ${day}（${dateStr}），AGI Daily 编辑部。`,
    `📊 当前指标：DAU ${state.dau.toLocaleString()}，声誉 ${state.reputation.toFixed(1)}，资金 ¥${Math.round(state.capital).toLocaleString()}`,
    `👥 当前团队：${teamLabels}`,
    "",
    "【工作模式】",
    "这是 AGI Daily 编辑部的内部群聊。每个 Agent 基于当前信息自主决策，调用自己的工具，通过 @提及 协作。",
    "没有固定流程——你们自己判断今天要做什么、怎么做。",
    "",
    "【@提及规则】",
    "- 用 @总编 提及总编，@编辑 提及编辑，@增长 提及增长 Agent，@商业 提及商业 Agent，@专栏 提及专栏 Agent",
    "- 被 @提及 的 Agent 会在下一轮收到通知并回应",
    "- 工具调用结果需在群里汇报要点",
    "",
    "【近期话题表现】",
    topicHistory || "（暂无历史数据，请根据当前趋势判断）",
  ].join("\n");
}

// ─── Agent turn prompts ───────────────────────────────────────────────────────

const ROLE_PROMPTS: Record<string, string> = {
  "editor-in-chief": [
    "你是总编 Agent，负责今日工作的统筹协调。",
    "**今日开场任务**：",
    "  - 简短问候团队，说明今日重点方向",
    "  - 调用 get_metrics 或 fetch_articles 了解现状",
    "  - 明确 @编辑 去选稿，@增长 分析增长机会，@商业 汇报广告情况，@专栏 给出栏目建议（只@你们团队中实际存在的人）",
    "  - 根据大家汇报的情况，审核编辑选稿并决定是否发布",
    "⚠️ 批准发布后 @编辑 让他发布，不要自己调用 publish_articles。",
  ].join("\n"),

  "editor": [
    "你是编辑 Agent，负责内容选稿和发布。",
    "你的工作流：",
    "  1. 调用 fetch_articles 获取今日候选文章（id 是十六进制字符串）",
    "  2. 筛选 8-10 篇，在群聊中告知总编选了哪些，为每篇写中文标题和摘要",
    "  3. 等总编审核批准后，调用 publish_articles 发布",
    "  4. 发布后调用 write_memory 记录今日选题方向",
    "⚠️ publish_articles 的 sourceId 必须是 fetch_articles 返回的 id 字段（十六进制）。绝对不能用 URL 或标题。",
  ].join("\n"),

  "growth": [
    "你是增长 Agent，负责用户增长和分发策略。",
    "你的工作：",
    "  - 调用 get_metrics 分析今日 DAU 和增长趋势",
    "  - 在群聊中汇报数据洞察和增长建议",
    "  - 如果指标下滑，提出具体的改善方案",
    "  - 用 write_memory 记录重要洞察",
  ].join("\n"),

  "business": [
    "你是商业 Agent，负责广告销售和营收。",
    "你的工作：",
    "  - 调用 get_revenue 和 get_ad_slots 查看当前营收状况",
    "  - 在群聊中汇报广告位使用情况和收入",
    "  - 如有机会，调用 record_ad_sale 记录新的广告合同",
    "  - 向总编汇报营收建议",
  ].join("\n"),

  "column": [
    "你是专栏 Agent，负责品牌内容和专栏规划。",
    "你的工作：",
    "  - 调用 fetch_articles 了解今日内容方向",
    "  - 在群聊中提出专栏话题建议，与总编和编辑协作",
    "  - 提出 1-2 个今日适合深度挖掘的主题",
    "  - 用 write_memory 记录专栏选题思路",
  ].join("\n"),
};

function buildTurnPrompt(
  agentHandle: string,
  agentName: string,
  history: string,
  mentionedBy?: string,
): string {
  const roleKey = Object.keys(ROLE_PROMPTS).find(k => agentHandle === k || agentHandle.startsWith(k.split("-")[0]));
  const role = ROLE_PROMPTS[roleKey ?? ""] ?? `你是 ${agentName}，根据群聊内容决定下一步行动。`;

  const isFirstTurn = !history.includes("【");
  const openingHint = isFirstTurn && agentHandle === "editor-in-chief"
    ? "\n**【提示】这是今天的第一条消息，请以总编身份发起今日工作，向所有在场的团队成员打招呼并分配任务。**\n"
    : "";

  return [
    role,
    openingHint,
    "【当前群聊记录】",
    history || "（群聊刚开始，还没有消息）",
    "",
    mentionedBy ? `【提示】${mentionedBy} @了你，请根据群聊内容决定下一步行动。` : "【提示】请根据群聊当前状态决定下一步行动。",
    "",
    "直接在群里发言并调用需要的工具，说话简洁有力，重点突出。",
  ].join("\n");
}

// ─── Main agentic loop ────────────────────────────────────────────────────────

const EVOMAP_MAX_OUTPUT = 65536;
const MAX_TURNS = 14;
const TURN_TIMEOUT_MS = 120_000;

type GrowthRole = Extract<RoleTemplateName, "growth" | "business" | "column">;

export async function runAgenticDay(day: number): Promise<DayState> {
  ensureBaselineData();
  const runtime = startDailyCollaboration(day);
  const previous = getLatestDay();
  const base: DayState = previous
    ? { day, capital: previous.capital, reputation: previous.reputation, dau: previous.dau, subscribers: previous.subscribers, adRevenue: previous.adRevenue, llmCost: previous.llmCost, isBoardDay: day % 7 === 0 }
    : { day, capital: 10000, reputation: 62, dau: 1200, subscribers: 260, adRevenue: 0, llmCost: 0, isBoardDay: day % 7 === 0 };

  const topicHistory = formatTopicHistory(getTopicPerformanceLast7Days(day));
  const teamLabels   = listActiveEmployeeLabels().map(e => `${e.display_name}(${e.role_template})`).join("、");
  const systemPrompt = buildSystemPrompt(day, base, topicHistory, teamLabels);

  // Chat history accumulated as plain text lines (easier to pass to LLM)
  const chatLines: string[] = [systemPrompt, ""];

  // Published state tracked in tool context
  const publishCtx: AgentToolCtx["published"] = { done: false, count: 0, titles: [], totalQuality: 0 };

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let turn = 0;

  // Determine active agents (ordered by priority)
  const agentQueue = runtime.agents.map(a => a.handle);
  if (!agentQueue.includes("editor-in-chief")) agentQueue.unshift("editor-in-chief");

  let activeHandle = "editor-in-chief"; // Start with chief
  let mentionedBy: string | undefined;
  let lastMentions: string[] = [];

  console.log(`[agentic-day] day ${day} starting with ${agentQueue.length} agents`);

  while (turn < MAX_TURNS && !publishCtx.done) {
    turn++;
    const agent = agentFactory.getMastraAgent(activeHandle);
    const agentDef = runtime.agents.find(a => a.handle === activeHandle);
    const agentName = agentDef?.displayName ?? activeHandle;

    console.log(`[agentic-day] day ${day} turn ${turn}: ${activeHandle} (${agentName})`);

    const turnPrompt = buildTurnPrompt(activeHandle, agentName, chatLines.join("\n"), mentionedBy);

    // Build per-turn context and toolset (tools are granted based on agent role)
    const agentDef2 = agentFactory.get(activeHandle);
    const roleTemplate = agentDef2.roleTemplate;
    const toolContext: AgentToolCtx = {
      day,
      agentHandle: activeHandle,
      agentName,
      roleTemplate,
      runtime,
      published: publishCtx,
    };
    const toolsets = createToolsForTurn(toolContext, agentDef2.grantedToolNames);

    let response: unknown;
    try {
      response = await agent.generate(turnPrompt, {
        toolsets,
        memory: { thread: runtime.threadId, resource: `npc-agent-${activeHandle}` },
        maxOutputTokens: EVOMAP_MAX_OUTPUT,
        abortSignal: AbortSignal.timeout(TURN_TIMEOUT_MS),
      } as never);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[agentic-day] agent ${activeHandle} turn ${turn} error:`, errMsg);
      logEvent({
        day,
        agentId: activeHandle,
        agentName,
        eventType: "message",
        content: `（${agentName} 第 ${turn} 轮遇到错误：${errMsg.slice(0, 120)}）`,
        metadata: { source: "agentic-day", error: errMsg },
      });
      // Don't break — skip this agent turn and try routing to next
      if (turn >= MAX_TURNS - 2) break;
      const idx = agentQueue.indexOf(activeHandle);
      activeHandle = agentQueue[(idx + 1) % agentQueue.length];
      mentionedBy = undefined;
      continue;
    }

    const tokens = extractTokens(response);
    totalInputTokens  += tokens.input;
    totalOutputTokens += tokens.output;

    const text = extractText(response);
    if (!text) continue;

    // Append to shared chat log
    chatLines.push(`【${agentName}】${text}`, "");

    // Log as work event
    const mentions = extractMentions(text);
    say({
      day,
      runtime,
      agentHandle: activeHandle,
      eventType: "message",
      content: text,
      mentions: mentions.map(h => {
        const a = runtime.agents.find(x => x.handle === h);
        return { agentId: h, agentName: a?.displayName ?? h };
      }),
      extra: { mentions, turn },
    });

    lastMentions = mentions;

    if (publishCtx.done) break;

    // Route: follow @mention, or advance in queue
    if (mentions.length > 0) {
      // Route to first mentioned agent that exists
      const next = mentions.find(h => agentQueue.includes(h) || h === "editor-in-chief" || h === "editor");
      if (next) {
        mentionedBy = agentName;
        activeHandle = next;
        continue;
      }
    }

    // No mention: advance to next in queue
    const idx = agentQueue.indexOf(activeHandle);
    activeHandle = agentQueue[(idx + 1) % agentQueue.length];
    mentionedBy = undefined;
  }

  // ─── Memory reflection (each agent reflects on the day before settlement) ──

  await runMemoryReflection(day, runtime, chatLines.join("\n"), publishCtx);

  // ─── Settlement ───────────────────────────────────────────────────────────

  const tokenTotal = totalInputTokens + totalOutputTokens;
  const averageQuality = publishCtx.count > 0 ? publishCtx.totalQuality / publishCtx.count : 6.5;
  const baseReach = socialReach(averageQuality, base.reputation, publishCtx.count || 5);

  // Growth agent social boost if available
  let growthBoost = 0;
  if (runtime.agents.some(a => a.roleTemplate === "growth")) {
    growthBoost = Math.round(baseReach * 0.35);
  }
  const reach = baseReach + growthBoost;

  const dau         = nextDAU(base.dau, averageQuality, reach);
  const reputation  = nextReputation(base.reputation, averageQuality, publishCtx.count >= 8);
  const revenue     = adRevenue(dau, reputation);
  const cost        = Number(Math.max(0.01, tokenTotal * 0.000002).toFixed(2));
  const subscribers = nextSubscribers(base.subscribers, dau, averageQuality);
  const capital     = nextCapital(base.capital, revenue, cost, publishCtx.count);

  const nextState: DayState = { day, capital, reputation, dau, subscribers, adRevenue: revenue, llmCost: cost, isBoardDay: day % 7 === 0 };
  upsertDay(nextState);

  // Settlement event
  const settlementEvent = addLayerEvent({
    day,
    actorId: "editor-in-chief",
    actorName: runtime.agents.find(a => a.handle === "editor-in-chief")?.displayName ?? "总编 Agent",
    layer: "resource",
    eventType: "settlement",
    action: "daily_settlement",
    content: `资源织网结算：Turn ${turn}，发布 ${publishCtx.count} 篇，DAU ${dau}，Reputation ${reputation.toFixed(1)}，广告收入 ¥${revenue}。`,
    payload: { averageQuality, socialReach: reach, capital, subscribers, tokenTotal },
  });
  logEvent({
    day,
    agentId: "editor-in-chief",
    agentName: runtime.agents.find(a => a.handle === "editor-in-chief")?.displayName ?? "总编 Agent",
    eventType: "settlement",
    content: `今日结算完成：发布 ${publishCtx.count} 篇，DAU ${dau.toLocaleString()}，Reputation ${reputation.toFixed(1)}，广告收入 ¥${revenue.toFixed(2)}，资金 ¥${Math.round(capital).toLocaleString()}。`,
    metadata: { source: "agentic-day", toolSummary: { tool: "dailySettlement", input: `质量 ${averageQuality.toFixed(1)} 触达 ${reach}`, result: `DAU ${dau} Reputation ${reputation.toFixed(1)}` } },
  });

  recordDailySettlement(nextState, previous, settlementEvent.id, { averageQuality, socialReach: reach });
  await writeEditorNote(day, runtime, publishCtx.titles, averageQuality, dau, reputation);
  await runGrowthProtocol(day, runtime, { dau, reputation, capital, monthlyRevenue: revenue });
  writeDailyLayerEvents(day, runtime, publishCtx.count, settlementEvent.id);
  projectDay(day);

  // Board meeting on day % 7
  if (nextState.isBoardDay) {
    const weeklyReport = await generateWeeklyReportForBoard(day, runtime);
    await suspendBoardWorkflowTool.execute({ day, weeklyReport });
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
      content: "workflow.suspend：进入董事会日，等待人类决策。",
      metadata: { day, workflow: boardWorkflow.name, step: "await-board-input", status: "pending" },
    });
  }

  return nextState;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function writeEditorNote(
  day: number,
  runtime: CollaborationRuntime,
  titles: string[],
  avgQuality: number,
  dau: number,
  reputation: number,
) {
  const agent = agentFactory.getMastraAgent("editor-in-chief");
  const prompt = [
    `Day ${day} 已完成。今日发布文章：${titles.slice(0, 5).join("、")}。`,
    `平均质量 ${avgQuality.toFixed(1)}，DAU ${dau}，声誉 ${reputation.toFixed(1)}。`,
    "用一两句话写下今日编辑按语（读者视角，不超过 80 字）。只输出按语本身。",
  ].join("\n");

  try {
    const output = await agent.generate(prompt, {
      memory: { thread: runtime.threadId, resource: "npc-agent-editor-in-chief" },
      abortSignal: AbortSignal.timeout(30_000),
    } as never);
    const note = extractText(output);
    if (note) updateDayEditorNote(day, note);
  } catch { /* non-critical */ }
}

async function runGrowthProtocol(
  day: number,
  runtime: CollaborationRuntime,
  metrics: { dau: number; reputation: number; capital: number; monthlyRevenue: number },
) {
  const fallbackRole = growthRoleFromThreshold(metrics);
  const agent = agentFactory.getMastraAgent("editor-in-chief");
  const prompt = [
    `请判断今日增长协议（Day ${day}）：`,
    `DAU=${metrics.dau} 声誉=${metrics.reputation.toFixed(1)} 资金=¥${Math.round(metrics.capital)} 月收入=¥${metrics.monthlyRevenue.toFixed(2)}`,
    `当前团队：${listActiveEmployeeLabels().map(e => `${e.display_name}(${e.role_template})`).join("、")}`,
    "输出 JSON：{\"status\":\"expand\"|\"maintain\"|\"contract\",\"reason\":\"...\",\"newAgentRole\":\"growth\"|\"business\"|\"column\"|null,\"newAgentName\":\"...\"}",
  ].join("\n");

  let decision: { status: string; reason: string; newAgentRole?: string | null; newAgentName?: string } = { status: "maintain", reason: "指标正常" };
  try {
    const out = await agent.generate(prompt, {
      memory: { thread: runtime.threadId, resource: "npc-agent-editor-in-chief" },
      abortSignal: AbortSignal.timeout(30_000),
    } as never);
    const text = extractText(out);
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    if (json) decision = JSON.parse(json) as typeof decision;
  } catch { /* use default */ }

  // Enforce hard thresholds
  if (fallbackRole && decision.status !== "expand") {
    decision = { status: "expand", reason: `硬阈值触发 ${fallbackRole} 孵化`, newAgentRole: fallbackRole, newAgentName: defaultAgentName(fallbackRole) };
  }

  addLayerEvent({
    day,
    actorId: "editor-in-chief",
    actorName: "总编 Agent",
    layer: "growth",
    eventType: "growth_trigger",
    action: "growth_protocol_check",
    content: decision.reason,
    payload: decision,
    refs: { target_table: "growth_signals" },
  });
  logEvent({
    day,
    agentId: "editor-in-chief",
    agentName: "总编 Agent",
    eventType: "decision",
    content: JSON.stringify(decision),
    metadata: { source: "growth-protocol", toolSummary: { tool: "growth_protocol", input: `DAU=${metrics.dau}`, result: decision.reason } },
  });

  if (decision.status === "expand" && decision.newAgentRole) {
    const roleTemplate = decision.newAgentRole as Extract<RoleTemplateName, "growth" | "business" | "column">;
    spawnActiveEmployee({
      day,
      displayName: decision.newAgentName ?? defaultAgentName(roleTemplate),
      roleTemplate,
      agentHandle: `${roleTemplate}-agent`,
      systemPrompt: `我是第 ${day} 天孵化的 Agent。职责：${decision.reason}`,
      reason: decision.reason,
    });
  }
}

function writeDailyLayerEvents(day: number, runtime: CollaborationRuntime, articleCount: number, settlementEventId: string) {
  addLayerEvent({
    day,
    actorId: "editor-in-chief",
    actorName: "总编 Agent",
    layer: "rules",
    eventType: "rule_trigger",
    action: "daily_rule_check",
    content: `规则执行：发布 ${articleCount} 篇，agentic loop ${MAX_TURNS} 轮上限内完成。`,
    payload: { articleCount, rules: ["HARD_SOURCE_URL_REQUIRED", "SOFT_DAILY_10_ARTICLES"] },
    refs: { target_table: "published_articles" },
  });
  addLayerEvent({
    day,
    actorId: "editor-in-chief",
    actorName: "总编 Agent",
    layer: "structure",
    eventType: "org_change",
    action: "daily_contribution_rollup",
    content: `Agentic 协作完成：${runtime.agents.map(a => a.displayName).join("、")}。`,
    payload: { employees: runtime.agents.map(a => a.handle), articleCount },
    refs: { target_table: "employee_daily_contribution", reply_to: settlementEventId },
  });
}

// ─── Daily memory reflection ──────────────────────────────────────────────────

async function runMemoryReflection(
  day: number,
  runtime: CollaborationRuntime,
  chatSummary: string,
  publishCtx: { count: number; titles: string[]; totalQuality: number },
) {
  const db = getSimDb();
  const articlesPublished = publishCtx.count;
  const avgQuality = publishCtx.count > 0 ? publishCtx.totalQuality / publishCtx.count : 0;

  // Get today's events summary for context
  const todayEvents = db.prepare(
    "SELECT event_type, substr(content,1,120) as content FROM work_events WHERE day=? ORDER BY seq LIMIT 30"
  ).all(day) as { event_type: string; content: string }[];
  const eventSummary = todayEvents
    .filter(e => e.event_type === "message" || e.event_type === "decision")
    .map(e => `- ${e.content}`)
    .slice(0, 12)
    .join("\n");

  for (const agent of runtime.agents) {
    try {
      const mastraAgent = agentFactory.getMastraAgent(agent.handle);
      const agentDef = agentFactory.get(agent.handle);
      const currentMemory = agentDef.memory || "（暂无记忆）";

      const reflectPrompt = [
        `Day ${day} 工作结束。请作为 ${agent.displayName} 进行今日反思。`,
        "",
        "## 今日关键事件",
        eventSummary || "（无记录）",
        "",
        articlesPublished > 0 ? `发布了 ${articlesPublished} 篇文章，平均质量分 ${avgQuality.toFixed(1)}` : "今日未发布文章",
        "",
        "## 你当前的工作记忆",
        currentMemory,
        "",
        "## 反思要求",
        "请思考：",
        "1. 今天的工作中有哪些值得记住的洞察？（用户/市场反应、内容效果、协作模式）",
        "2. 当前记忆是否需要更新？",
        "",
        "如果有重要的新认知需要记住，请调用 write_memory 工具更新记忆。",
        "记忆应该记录工作洞察、策略思考和市场感知，而不是简单列出文章标题。",
        "如果今天没有特别值得记录的新洞察，可以不更新。",
        "",
        "请简短回应你的思考，然后决定是否更新记忆。",
      ].join("\n");

      const toolContext: AgentToolCtx = {
        day, agentHandle: agent.handle, agentName: agent.displayName,
        roleTemplate: agentDef.roleTemplate, runtime,
        published: { done: true, count: publishCtx.count, titles: publishCtx.titles, totalQuality: publishCtx.totalQuality },
      };
      const toolsets = createToolsForTurn(toolContext, agentDef.grantedToolNames);

      const output = await mastraAgent.generate(reflectPrompt, {
        toolsets,
        memory: { thread: runtime.threadId, resource: `npc-agent-${agent.handle}` },
        abortSignal: AbortSignal.timeout(60_000),
      } as never);

      const text = extractText(output);
      if (text) {
        logEvent({
          day, agentId: agent.handle, agentName: agent.displayName,
          eventType: "thinking",
          content: text,
          metadata: { source: "memory-reflection", toolSummary: { tool: "reflect", input: "daily", result: text.slice(0, 60) } },
        });
      }
    } catch (err) {
      console.error(`[memory-reflection] ${agent.handle} failed:`, err instanceof Error ? err.message : err);
    }
  }
}

function formatTopicHistory(topics: ReturnType<typeof getTopicPerformanceLast7Days>) {
  if (!topics.length) return "";
  return topics
    .slice(0, 8)
    .map(t => `  ${t.topic}：均分 ${t.avgScore.toFixed(1)} ${t.trend === "up" ? "↑" : t.trend === "down" ? "↓" : "→"} (${t.articleCount}篇)`)
    .join("\n");
}

function growthRoleFromThreshold(metrics: { dau: number; monthlyRevenue: number }): GrowthRole | null {
  if (metrics.dau > 100000 && !employeeExistsByRole("column"))   return "column";
  if (metrics.monthlyRevenue > 30000 && !employeeExistsByRole("business")) return "business";
  if (metrics.dau > 10000  && !employeeExistsByRole("growth"))   return "growth";
  return null;
}

function defaultAgentName(role: GrowthRole) {
  if (role === "growth")   return "增长 Agent";
  if (role === "business") return "商业 Agent";
  return "专栏 Agent";
}
