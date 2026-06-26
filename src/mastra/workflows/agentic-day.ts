/**
 * Agentic daily loop.
 * Instead of a fixed workflow, agents receive a shared chat history and decide
 * what to say and which tools to call. The orchestrator only handles:
 *   - Routing based on @mentions
 *   - Settlement after publish_articles is called
 *   - Safety limits (max turns, timeout)
 */
import { randomUUID } from "node:crypto";
import { ensureBaselineData, getLatestDay, projectDay, recordDailySettlement, upsertDay, addLayerEvent, upsertAgentStream } from "@/db/sim";
import { getTopicPerformanceLast7Days } from "@/db/memory-queries";
import { employeeExistsByRole, listActiveEmployeeLabels, spawnActiveEmployee } from "@/db/employees";
import { dbAll, dbFirst, upsertSoulSnapshot } from "@/db/connection";
import { updateDayEditorNote } from "@/db/day-notes";
import type { DayState } from "@/lib/types";

export class SimFatalError extends Error {
  constructor(
    public readonly agentHandle: string,
    public readonly turnNumber: number,
    public readonly cause: unknown,
  ) {
    super(`Agent ${agentHandle} turn ${turnNumber} fatal: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "SimFatalError";
  }
}
import { agentFactory } from "@/mastra/agent-factory";
import { startDailyCollaboration, say, type CollaborationRuntime } from "@/mastra/collaboration";
import { createToolsForTurn, type AgentToolCtx } from "@/mastra/tools/npc-tools";
import { getTavilyToolsets } from "@/mastra/tools/tavily-mcp";
import { agentMeta, logEvent } from "@/simulation/mock-apis";
import { emitAgentStream } from "@/simulation/event-bus";
import { adRevenue, nextCapital, nextDAU, nextReputation, nextSubscribers, socialReach, laborCost, subscriptionRevenue } from "@/simulation/formulas";
import { runReaderAgent } from "@/mastra/workflows/reader-agent";
import { getYesterdayFeedbackContext } from "@/db/feedback";
import { boardWorkflow, generateWeeklyReportForBoard } from "@/mastra/workflows/board-meeting";
import { suspendBoardWorkflowTool } from "@/mastra/tools/sim-tools";
import { evomapExperienceInstruction, type RoleTemplateName } from "@/mastra/role-templates";

// ─── @mention routing ─────────────────────────────────────────────────────────

// Role-label → role_template mapping (constant)
const ROLE_LABELS: Record<string, string[]> = {
  "editor_in_chief": ["总编", "总编辑"],
  "editor":          ["编辑"],
  "growth":          ["增长"],
  "business":        ["商业"],
  "column":          ["专栏"],
};

/**
 * Build a live mention map from the current agent roster so that agents
 * hired mid-day (with dynamic handles) are immediately reachable via @mention.
 */
function buildMentionMap(agents: Array<{ handle: string; displayName: string; roleTemplate: string }>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const agent of agents) {
    for (const label of ROLE_LABELS[agent.roleTemplate] ?? []) {
      map[label] = agent.handle;
    }
    if (agent.displayName) map[agent.displayName] = agent.handle;
    map[agent.handle] = agent.handle;
  }
  return map;
}

function extractMentions(text: string, mentionMap: Record<string, string>): string[] {
  const re = /@([A-Za-z0-9_\-\u4e00-\u9fff]{1,16})/g;
  const handles: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const handle = mentionMap[m[1]];
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

type StreamableAgent = {
  stream: (prompt: string, options: unknown) => Promise<{
    fullStream?: AsyncIterable<unknown> | ReadableStream<unknown>;
    textStream?: AsyncIterable<string> | ReadableStream<string>;
    text?: Promise<string> | string;
    totalUsage?: Promise<Record<string, number>>;
    usage?: Record<string, number>;
  }>;
};

async function streamAgentTurn(input: {
  agent: unknown;
  prompt: string;
  options: unknown;
  day: number;
  agentHandle: string;
  agentName: string;
  turn: number;
}) {
  const streamId = `agent-stream-${randomUUID()}`;
  const agent = input.agent as Partial<StreamableAgent>;
  if (typeof agent.stream !== "function") throw new Error("Mastra Agent.stream is not available.");

  emitAgentStream({
    streamId,
    day: input.day,
    agentId: input.agentHandle,
    agentName: input.agentName,
    eventType: "message",
    content: "",
    delta: "",
    status: "start",
    turn: input.turn,
  });
  upsertAgentStream({ streamId, day: input.day, agentId: input.agentHandle, agentName: input.agentName, eventType: "message", content: "", status: "start", turn: input.turn }).catch(e => console.warn("[d1-stream] start", e));

  try {
    const output = await agent.stream(input.prompt, input.options);
    let text = "";
    let lastD1WriteAt = 0;
    const D1_THROTTLE_MS = 1000;
    if (output.fullStream) {
      for await (const chunk of readUnknownStream(output.fullStream)) {
        logLlmStreamChunk(input, chunk);
        const delta = getTextDelta(chunk);
        if (!delta) continue;
        text += delta;
        emitAgentStream({
          streamId,
          day: input.day,
          agentId: input.agentHandle,
          agentName: input.agentName,
          eventType: "message",
          content: text,
          delta,
          status: "delta",
          turn: input.turn,
        });
        if (Date.now() - lastD1WriteAt >= D1_THROTTLE_MS) {
          lastD1WriteAt = Date.now();
          upsertAgentStream({ streamId, day: input.day, agentId: input.agentHandle, agentName: input.agentName, eventType: "message", content: text, status: "delta", turn: input.turn }).catch(e => console.warn("[d1-stream] delta", e));
        }
      }
    } else if (output.textStream) {
      for await (const delta of readTextStream(output.textStream)) {
        if (!delta) continue;
        logLlmStreamChunk(input, { type: "text-delta", payload: { text: delta } });
        text += delta;
        emitAgentStream({
          streamId,
          day: input.day,
          agentId: input.agentHandle,
          agentName: input.agentName,
          eventType: "message",
          content: text,
          delta,
          status: "delta",
          turn: input.turn,
        });
        if (Date.now() - lastD1WriteAt >= D1_THROTTLE_MS) {
          lastD1WriteAt = Date.now();
          upsertAgentStream({ streamId, day: input.day, agentId: input.agentHandle, agentName: input.agentName, eventType: "message", content: text, status: "delta", turn: input.turn }).catch(e => console.warn("[d1-stream] delta", e));
        }
      }
    }
    if (!text && output.text) text = typeof output.text === "string" ? output.text : await output.text;
    const usage = output.totalUsage ? await output.totalUsage.catch(() => undefined) : output.usage;
    emitAgentStream({
      streamId,
      day: input.day,
      agentId: input.agentHandle,
      agentName: input.agentName,
      eventType: "message",
      content: text,
      delta: "",
      status: "done",
      turn: input.turn,
    });
    await upsertAgentStream({ streamId, day: input.day, agentId: input.agentHandle, agentName: input.agentName, eventType: "message", content: text, status: "done", turn: input.turn }).catch(e => console.warn("[d1-stream] done", e));
    return { text: text.trim(), output: { ...output, text, usage } };
  } catch (error) {
    emitAgentStream({
      streamId,
      day: input.day,
      agentId: input.agentHandle,
      agentName: input.agentName,
      eventType: "message",
      content: "",
      delta: "",
      status: "error",
      turn: input.turn,
    });
    await upsertAgentStream({ streamId, day: input.day, agentId: input.agentHandle, agentName: input.agentName, eventType: "message", content: "", status: "error", turn: input.turn }).catch(e => console.warn("[d1-stream] error", e));
    throw error;
  }
}

type StreamChunk = {
  type?: string;
  payload?: {
    text?: string;
    delta?: string;
    content?: string;
  };
  text?: string;
  delta?: string;
};

function logLlmStreamChunk(input: { day: number; turn: number; agentHandle: string; agentName: string }, chunk: unknown) {
  const c = chunk as StreamChunk;
  const delta = getTextDelta(chunk);
  if (delta) {
    console.log(`[llm-stream][day=${input.day} turn=${input.turn} agent=${input.agentHandle}] ${JSON.stringify(delta)}`);
    return;
  }
  if (c.type) {
    console.log(`[llm-stream][day=${input.day} turn=${input.turn} agent=${input.agentHandle}] chunk=${c.type}`);
  }
}

function getTextDelta(chunk: unknown) {
  const c = chunk as StreamChunk;
  if (c.type !== "text-delta" && !String(c.type ?? "").endsWith("text-delta")) return "";
  return c.payload?.text ?? c.payload?.delta ?? c.payload?.content ?? c.text ?? c.delta ?? "";
}

async function* readTextStream(stream: AsyncIterable<string> | ReadableStream<string>) {
  for await (const value of readUnknownStream(stream)) {
    if (typeof value === "string") yield value;
  }
}

async function* readUnknownStream<T>(stream: AsyncIterable<T> | ReadableStream<T>) {
  if (Symbol.asyncIterator in stream) {
    yield* stream as AsyncIterable<T>;
    return;
  }
  const reader = (stream as ReadableStream<T>).getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildMentionLine(agents: Array<{ handle: string; displayName: string; roleTemplate: string }>): string {
  const entries = agents.map(a => {
    const labels = ROLE_LABELS[a.roleTemplate] ?? [];
    const label = labels[0] ?? a.displayName;
    return `@${label}（${a.displayName}）`;
  });
  return entries.length ? entries.join("、") : "（暂无其他成员）";
}

function buildSystemPrompt(
  day: number,
  state: DayState,
  topicHistory: string,
  agents: Array<{ handle: string; displayName: string; roleTemplate: string }>,
  feedbackCtx?: Awaited<ReturnType<typeof getYesterdayFeedbackContext>>,
): string {
  const date = new Date(Date.UTC(2026, 5, day)); // Day 1 = 2026-06-01
  const dateStr = date.toISOString().slice(0, 10);
  const teamLabels = agents.map(a => `${a.displayName}（${a.roleTemplate}）`).join("、");
  const parts = [
    `今天是 Day ${day}（${dateStr}），AGI Daily 编辑部。`,
    `📊 当前指标：DAU ${state.dau.toLocaleString()}，声誉 ${state.reputation.toFixed(1)}，资金 ¥${Math.round(state.capital).toLocaleString()}`,
    `👥 当前团队：${teamLabels}`,
    "",
    "【工作模式】",
    "这是 AGI Daily 编辑部的内部群聊。每个 Agent 基于当前信息自主决策，调用自己的工具，通过 @提及 协作。",
    "没有固定流程——你们自己判断今天要做什么、怎么做。",
    "",
    evomapExperienceInstruction,
    "",
    "【@提及规则】",
    `- 今日可用 @提及：${buildMentionLine(agents)}`,
    "- 只能 @提及上方列出的成员；不在列表中的角色今日尚未入职，不要凭空 @提及",
    "- 被 @提及 的 Agent 会在下一轮收到通知并回应",
    "- 工具调用结果需在群里汇报要点",
    "",
    "【近期话题表现】",
    topicHistory || "（暂无历史数据，请根据当前趋势判断）",
  ];
  if (feedbackCtx) {
    parts.push("", "【昨日读者反馈】");
    parts.push(`整体满意度：${feedbackCtx.avgOverall.toFixed(1)}/10  最受好评：${feedbackCtx.bestArticleTitle}  最需改进：${feedbackCtx.worstArticleTitle}`);
    if (feedbackCtx.topComments.length) {
      parts.push("读者声音：");
      feedbackCtx.topComments.forEach(c => parts.push(`  · ${c}`));
    }
    if (feedbackCtx.humanComments.length) {
      parts.push("人类读者留言：");
      feedbackCtx.humanComments.slice(0, 3).forEach(c => parts.push(`  · ${c.authorName}：${c.content.slice(0, 80)}`));
    }
  }
  return parts.join("\n");
}

// ─── Agent turn prompts ───────────────────────────────────────────────────────

const ROLE_PROMPTS: Record<string, string> = {
  "editor-in-chief": [
    "你是总编 Agent，负责今日工作的统筹协调。",
    "你必须以公司的七层约束做决策：使命层、能力层、记忆层、组织层、规则层、资源层、生长协议层。",
    "规则层硬约束：每日 AGI Daily 必须发布至少 8 篇文章；不足时不能批准发布，须要求编辑继续补齐。",
    "**今日开场任务**：",
    "  - 简短问候团队，说明今日重点方向",
    "  - 调用 get_metrics 了解现状",
    "  - 根据【当前团队】中实际存在的成员，按角色分配任务（用 @提及规则 中列出的 @名字 通知对应人）",
    "  - 审核编辑选稿，决定是否批准发布",
    "⚠️ 批准发布后请 @编辑 让他执行发布，不要自己调用 publish_articles。",
  ].join("\n"),

  "editor": [
    "你是编辑 Agent，负责内容选稿和发布。",
    "你的工作流：",
    "  1. 调用 fetch_articles 获取今日候选文章（id 是十六进制字符串）",
    "  2. 筛选恰好 10 篇，在群聊中告知总编选了哪些，为每篇写中文标题和摘要",
    "  3. 文章封面可以调用 Tavily MCP 的 tavily_search 寻找合适的封面，参数建议 include_images=true、include_image_descriptions=true、max_results=5、search_depth=basic",
    "  4. 等总编审核批准后，调用 publish_articles 发布；可在单篇文章里提交 imageUrl，原文已有封面图时系统会优先使用原文图",
    "  5. 发布后调用 write_memory 记录今日选题方向",
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

type AgentTurnResult = {
  handle: string;
  agentName: string;
  text: string;
  mentions: string[];
  tokens: { input: number; output: number };
  turn: number;
};

export async function runAgenticDay(day: number): Promise<DayState> {
  await ensureBaselineData();
  const runtime = await startDailyCollaboration(day);
  const previous = await getLatestDay();
  const base: DayState = previous
    ? { day, capital: previous.capital, reputation: previous.reputation, dau: previous.dau, subscribers: previous.subscribers, adRevenue: previous.adRevenue, llmCost: previous.llmCost, isBoardDay: day % 7 === 0 }
    : { day, capital: 10000, reputation: 62, dau: 1200, subscribers: 260, adRevenue: 0, llmCost: 0, isBoardDay: day % 7 === 0 };

  const topicHistory = formatTopicHistory(await getTopicPerformanceLast7Days(day));
  const feedbackCtx  = day > 1 ? await getYesterdayFeedbackContext(day - 1) : null;
  const systemPrompt = buildSystemPrompt(day, base, topicHistory, runtime.agents, feedbackCtx ?? undefined);

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

  // Live mention map — rebuilt after each turn batch to include newly hired agents
  let mentionMap = buildMentionMap(runtime.agents);

  console.log(`[agentic-day] day ${day} starting with ${agentQueue.length} agents`);

  async function runAgentTurn(activeHandle: string, turnNumber: number, mentionedBy?: string, history = chatLines.join("\n")): Promise<AgentTurnResult | null> {
    const agent = agentFactory.getMastraAgent(activeHandle);
    const agentDef = runtime.agents.find(a => a.handle === activeHandle);
    const agentName = agentDef?.displayName ?? activeHandle;

    console.log(`[agentic-day] day ${day} turn ${turnNumber}: ${activeHandle} (${agentName})`);

    const turnPrompt = buildTurnPrompt(activeHandle, agentName, history, mentionedBy);

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
    const localToolsets = createToolsForTurn(toolContext, agentDef2.grantedToolNames);
    const tavilyToolsets = roleTemplate === "editor" ? await getTavilyToolsets() : {};
    const toolsets = { ...localToolsets, ...tavilyToolsets };

    let response: unknown;
    let text = "";
    try {
      const streamed = await streamAgentTurn({
        agent,
        prompt: turnPrompt,
        options: {
          toolsets,
          memory: { thread: runtime.threadId, resource: `npc-agent-${activeHandle}` },
          maxOutputTokens: EVOMAP_MAX_OUTPUT,
          abortSignal: AbortSignal.timeout(TURN_TIMEOUT_MS),
        },
        day,
        agentHandle: activeHandle,
        agentName,
        turn: turnNumber,
      });
      response = streamed.output;
      text = streamed.text;
    } catch (err) {
      console.warn(`[agentic-day] stream fallback for ${activeHandle} turn ${turnNumber}:`, err instanceof Error ? err.message : err);
      const fallbackStreamId = `agent-stream-${randomUUID()}`;
      emitAgentStream({
        streamId: fallbackStreamId,
        day,
        agentId: activeHandle,
        agentName,
        eventType: "message",
        content: "",
        delta: "",
        status: "start",
        turn: turnNumber,
      });
      upsertAgentStream({ streamId: fallbackStreamId, day, agentId: activeHandle, agentName, eventType: "message", content: "", status: "start", turn: turnNumber }).catch(e => console.warn("[d1-stream] fallback start", e));
      try {
        response = await agent.generate(turnPrompt, {
          toolsets,
          memory: { thread: runtime.threadId, resource: `npc-agent-${activeHandle}` },
          maxOutputTokens: EVOMAP_MAX_OUTPUT,
          abortSignal: AbortSignal.timeout(TURN_TIMEOUT_MS),
        } as never);
        text = extractText(response);
        emitAgentStream({
          streamId: fallbackStreamId,
          day,
          agentId: activeHandle,
          agentName,
          eventType: "message",
          content: text,
          delta: "",
          status: "done",
          turn: turnNumber,
        });
        await upsertAgentStream({ streamId: fallbackStreamId, day, agentId: activeHandle, agentName, eventType: "message", content: text, status: "done", turn: turnNumber }).catch(e => console.warn("[d1-stream] fallback done", e));
      } catch (err) {
        emitAgentStream({
          streamId: fallbackStreamId,
          day,
          agentId: activeHandle,
          agentName,
          eventType: "message",
          content: "",
          delta: "",
          status: "error",
          turn: turnNumber,
        });
        await upsertAgentStream({ streamId: fallbackStreamId, day, agentId: activeHandle, agentName, eventType: "message", content: "", status: "error", turn: turnNumber }).catch(e => console.warn("[d1-stream] fallback error", e));
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[agentic-day] agent ${activeHandle} turn ${turnNumber} error:`, errMsg);
        await logEvent({
          day,
          agentId: activeHandle,
          agentName,
          eventType: "error",
          content: `${agentName} 第 ${turnNumber} 轮执行失败：${errMsg.slice(0, 200)}`,
          metadata: { source: "agentic-day", error: errMsg, turn: turnNumber },
        });
        throw new SimFatalError(activeHandle, turnNumber, err);
      }
    }

    const tokens = extractTokens(response);
    const mentions = extractMentions(text, mentionMap);
    return { handle: activeHandle, agentName, text, mentions, tokens, turn: turnNumber };
  }

  const validAgentHandles = (handles: string[]) => [...new Set(handles)].filter(h => agentQueue.includes(h));
  let nextHandles = ["editor-in-chief"];
  let mentionSources = new Map<string, string | undefined>();

  while (turn < MAX_TURNS && !publishCtx.done) {
    const batchHandles = validAgentHandles(nextHandles);
    const handlesToRun = batchHandles.length ? batchHandles : [agentQueue[0]];
    const plannedTurns = handlesToRun.slice(0, MAX_TURNS - turn).map(handle => ({
      handle,
      mentionedBy: mentionSources.get(handle),
      turnNumber: ++turn,
    }));
    const sharedHistory = chatLines.join("\n");

    if (plannedTurns.length > 1) {
      console.log(`[agentic-day] day ${day} parallel turns: ${plannedTurns.map(t => `${t.turnNumber}:${t.handle}`).join(", ")}`);
    }

    // SimFatalError propagates out of Promise.all and is caught in engine.ts
    const results = (await Promise.all(plannedTurns.map(t => runAgentTurn(t.handle, t.turnNumber, t.mentionedBy, sharedHistory))))
      .filter((result): result is AgentTurnResult => Boolean(result));

    if (results.length === 0) {
      const lastHandle = plannedTurns.at(-1)?.handle ?? agentQueue[0];
      const idx = agentQueue.indexOf(lastHandle);
      nextHandles = [agentQueue[(idx + 1) % agentQueue.length]];
      mentionSources = new Map();
      continue;
    }

    const mentionedHandles: string[] = [];
    const nextMentionSources = new Map<string, string | undefined>();

    for (const result of results.sort((a, b) => a.turn - b.turn)) {
      totalInputTokens  += result.tokens.input;
      totalOutputTokens += result.tokens.output;
      if (!result.text) continue;

      chatLines.push(`【${result.agentName}】${result.text}`, "");
      for (const handle of result.mentions) {
        if (!agentQueue.includes(handle) || handle === result.handle) continue;
        mentionedHandles.push(handle);
        if (!nextMentionSources.has(handle)) nextMentionSources.set(handle, result.agentName);
      }

      await say({
        day,
        runtime,
        agentHandle: result.handle,
        eventType: "message",
        content: result.text,
        mentions: result.mentions.map(h => {
          const a = runtime.agents.find(x => x.handle === h);
          return { agentId: h, agentName: a?.displayName ?? h };
        }),
        extra: { mentions: result.mentions, turn: result.turn },
      });
    }

    if (publishCtx.done) break;

    // Sync agents hired during this turn batch into the queue
    {
      const knownHandles = new Set(agentQueue);
      const freshAgents = await agentFactory.loadActiveEmployees();
      for (const emp of freshAgents) {
        if (!knownHandles.has(emp.handle)) {
          agentQueue.push(emp.handle);
          runtime.agents.push(emp);
          console.log(`[agentic-day] day ${day}: new agent joined mid-day: ${emp.handle} (${emp.displayName})`);
        }
      }
      // Rebuild mention map to include new agent labels and display names
      mentionMap = buildMentionMap(runtime.agents);
    }

    const routedMentions = validAgentHandles(mentionedHandles);
    if (routedMentions.length > 0) {
      nextHandles = routedMentions;
      mentionSources = nextMentionSources;
      continue;
    }

    const lastHandle = plannedTurns.at(-1)?.handle ?? agentQueue[0];
    const idx = agentQueue.indexOf(lastHandle);
    nextHandles = [agentQueue[(idx + 1) % agentQueue.length]];
    mentionSources = new Map();
  }

  // ─── Memory reflection (each agent reflects on the day before settlement) ──

  await runMemoryReflection(day, runtime, chatLines.join("\n"), publishCtx);

  // ─── Reader Agent feedback (after publishing, before settlement) ──────────

  let readerResult: { avgOverall: number; reviewCount: number } = { avgOverall: 0, reviewCount: 0 };
  try {
    readerResult = await runReaderAgent(day, runtime);
  } catch (err) {
    console.warn("[reader-agent] failed:", err instanceof Error ? err.message : err);
  }

  // ─── Settlement ───────────────────────────────────────────────────────────

  const tokenTotal = totalInputTokens + totalOutputTokens;
  const averageQuality = publishCtx.count > 0 ? publishCtx.totalQuality / publishCtx.count : 6.5;

  // Quality momentum: weight current quality with past 3 days (涟漪效应)
  const pastDays = await dbAll<{ avg_quality: number }>("SELECT avg_quality FROM sim_days WHERE day < ? AND avg_quality > 0 ORDER BY day DESC LIMIT 3", day);
  const qualityMomentum = pastDays.length > 0
    ? pastDays.reduce((s, r) => s + r.avg_quality, 0) / pastDays.length
    : averageQuality;
  const effectiveQuality = averageQuality * 0.4 + qualityMomentum * 0.6;

  const baseReach = socialReach(effectiveQuality, base.reputation, publishCtx.count || 5);

  // Growth agent social boost scales with quality momentum
  let growthBoost = 0;
  if (runtime.agents.some(a => a.roleTemplate === "growth")) {
    growthBoost = Math.round(baseReach * 0.35 * Math.min(1.25, qualityMomentum / 7));
  }
  const reach = baseReach + growthBoost;

  const readerScore = readerResult.reviewCount > 0 ? readerResult.avgOverall : undefined;
  const dau         = nextDAU(base.dau, effectiveQuality, reach, readerScore);
  const reputation  = nextReputation(base.reputation, averageQuality, publishCtx.count >= 8);

  // Advertising revenue: organic (CPM-tiered) + contract (Agent-negotiated placements)
  const placementRow = await dbFirst<{ total: number }>("SELECT COALESCE(SUM(revenue), 0) AS total FROM ad_placements WHERE day = ?", day);
  const contractAdRevenue = Number((placementRow?.total ?? 0).toFixed(2));
  const organicAdRevenue  = adRevenue(dau, reputation);
  const totalAdRevenue    = Number((contractAdRevenue + organicAdRevenue).toFixed(2));

  const cost        = Number(Math.max(0.01, tokenTotal * 0.000002).toFixed(2));
  const subscribers = nextSubscribers(base.subscribers, dau, averageQuality);

  // Calculate labor cost from active employees
  const activeEmps = await dbAll<{ daily_salary: number }>("SELECT daily_salary FROM employees WHERE status = 'active'");
  const laborCostAmount = laborCost(activeEmps);

  const capital = nextCapital(base.capital, totalAdRevenue + subscriptionRevenue(subscribers), cost + laborCostAmount, publishCtx.count);

  const nextState: DayState = { day, capital, reputation, dau, subscribers, adRevenue: totalAdRevenue, llmCost: cost, isBoardDay: day % 7 === 0 };
  await upsertDay({ ...nextState, laborCost: laborCostAmount, avgQuality: averageQuality });

  // Settlement event
  const chiefName = runtime.agents.find(a => a.handle === "editor-in-chief")?.displayName ?? "总编 Agent";
  const adSummary = contractAdRevenue > 0
    ? `有机广告 ¥${organicAdRevenue.toFixed(2)} + 合同广告 ¥${contractAdRevenue.toFixed(2)}`
    : `有机广告 ¥${organicAdRevenue.toFixed(2)}`;
  const settlementEvent = await addLayerEvent({
    day,
    actorId: "editor-in-chief",
    actorName: chiefName,
    layer: "resource",
    eventType: "settlement",
    action: "daily_settlement",
    content: `资源织网结算：发布 ${publishCtx.count} 篇，DAU ${dau}，声誉 ${reputation.toFixed(1)}，广告收入 ¥${totalAdRevenue.toFixed(2)}（${adSummary}）。`,
    payload: { averageQuality, qualityMomentum, socialReach: reach, capital, subscribers, tokenTotal, contractAdRevenue, organicAdRevenue },
  });
  await logEvent({
    day,
    agentId: "editor-in-chief",
    agentName: chiefName,
    eventType: "settlement",
    content: `今日结算完成：发布 ${publishCtx.count} 篇，DAU ${dau.toLocaleString()}，声誉 ${reputation.toFixed(1)}，广告收入 ¥${totalAdRevenue.toFixed(2)}，资金 ¥${Math.round(capital).toLocaleString()}。`,
    metadata: { source: "agentic-day", toolSummary: { tool: "dailySettlement", input: `质量 ${averageQuality.toFixed(1)} 动量 ${qualityMomentum.toFixed(1)} 触达 ${reach}`, result: `DAU ${dau} 声誉 ${reputation.toFixed(1)}` } },
  });

  await recordDailySettlement(
    { ...nextState, laborCost: laborCostAmount, contractAdRevenue, organicAdRevenue },
    previous,
    settlementEvent.id,
    { averageQuality, socialReach: reach, readerScore },
  );
  await writeEditorNote(day, runtime, publishCtx.titles, averageQuality, dau, reputation);
  await runGrowthProtocol(day, runtime, { dau, reputation, capital, monthlyRevenue: totalAdRevenue });
  await writeDailyLayerEvents(day, runtime, publishCtx.count, settlementEvent.id);
  await projectDay(day);

  // Board meeting on day % 7
  if (nextState.isBoardDay) {
    const weeklyReport = await generateWeeklyReportForBoard(day, runtime);
    await suspendBoardWorkflowTool.execute({ day, weeklyReport });
    await logEvent({
      day,
      ...agentMeta("总编"),
      eventType: "board",
      content: `生成董事会周报：${weeklyReport.summary}`,
      metadata: { workflow: boardWorkflow.name, step: "weekly-report", weeklyReport },
    });
    await logEvent({
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
    if (note) await updateDayEditorNote(day, note);
  } catch { /* non-critical */ }
}

async function runGrowthProtocol(
  day: number,
  runtime: CollaborationRuntime,
  metrics: { dau: number; reputation: number; capital: number; monthlyRevenue: number },
) {
  const fallbackRole = await growthRoleFromThreshold(metrics);
  const agent = agentFactory.getMastraAgent("editor-in-chief");
  const prompt = [
    `请判断今日增长协议（Day ${day}）：`,
    `DAU=${metrics.dau} 声誉=${metrics.reputation.toFixed(1)} 资金=¥${Math.round(metrics.capital)} 月收入=¥${metrics.monthlyRevenue.toFixed(2)}`,
    `当前团队：${(await listActiveEmployeeLabels()).map(e => `${e.display_name}(${e.role_template})`).join("、")}`,
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

  await addLayerEvent({
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
  await logEvent({
    day,
    agentId: "editor-in-chief",
    agentName: "总编 Agent",
    eventType: "decision",
    content: JSON.stringify(decision),
    metadata: { source: "growth-protocol", toolSummary: { tool: "growth_protocol", input: `DAU=${metrics.dau}`, result: decision.reason } },
  });

  if (decision.status === "expand" && decision.newAgentRole) {
    const roleTemplate = decision.newAgentRole as Extract<RoleTemplateName, "growth" | "business" | "column">;
    await spawnActiveEmployee({
      day,
      displayName: decision.newAgentName ?? defaultAgentName(roleTemplate),
      roleTemplate,
      agentHandle: `${roleTemplate}-agent`,
      systemPrompt: `我是第 ${day} 天孵化的 Agent。职责：${decision.reason}`,
      reason: decision.reason,
    });
  }
}

async function writeDailyLayerEvents(day: number, runtime: CollaborationRuntime, articleCount: number, settlementEventId: string) {
  await addLayerEvent({
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
  await addLayerEvent({
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
  const articlesPublished = publishCtx.count;
  const avgQuality = publishCtx.count > 0 ? publishCtx.totalQuality / publishCtx.count : 0;

  // Get today's events summary for context
  const todayEvents = await dbAll<{ event_type: string; content: string }>(
    "SELECT event_type, substr(content,1,120) as content FROM work_events WHERE day=? ORDER BY seq LIMIT 30",
    day,
  );
  const eventSummary = todayEvents
    .filter(e => e.event_type === "message" || e.event_type === "decision")
    .map(e => `- ${e.content}`)
    .slice(0, 12)
    .join("\n");

  await Promise.all(runtime.agents.map(async (agent) => {
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
        await logEvent({
          day, agentId: agent.handle, agentName: agent.displayName,
          eventType: "thinking",
          content: text,
          metadata: { source: "memory-reflection", toolSummary: { tool: "reflect", input: "daily", result: text.slice(0, 60) } },
        });
      }
    } catch (err) {
      console.error(`[memory-reflection] ${agent.handle} failed:`, err instanceof Error ? err.message : err);
    } finally {
      await snapshotAgentSoulMemory(agent.handle, day);
    }
  }));
}

async function snapshotAgentSoulMemory(agentHandle: string, day: number) {
  const row = await dbFirst<{ id: string; soul: string | null; memory: string | null }>(
    "SELECT id, soul, memory FROM employees WHERE agent_handle = ?",
    agentHandle,
  );
  if (!row) return;
  await upsertSoulSnapshot(row.id, day, row.soul ?? "", row.memory ?? "");
}

function formatTopicHistory(topics: Awaited<ReturnType<typeof getTopicPerformanceLast7Days>>) {
  if (!topics.length) return "";
  return topics
    .slice(0, 8)
    .map(t => `  ${t.topic}：均分 ${t.avgScore.toFixed(1)} ${t.trend === "up" ? "↑" : t.trend === "down" ? "↓" : "→"} (${t.articleCount}篇)`)
    .join("\n");
}

async function growthRoleFromThreshold(metrics: { dau: number; monthlyRevenue: number }): Promise<GrowthRole | null> {
  if (metrics.dau > 100000 && !(await employeeExistsByRole("column")))   return "column";
  if (metrics.monthlyRevenue > 30000 && !(await employeeExistsByRole("business"))) return "business";
  if (metrics.dau > 10000  && !(await employeeExistsByRole("growth")))   return "growth";
  return null;
}

function defaultAgentName(role: GrowthRole) {
  if (role === "growth")   return "增长 Agent";
  if (role === "business") return "商业 Agent";
  return "专栏 Agent";
}
