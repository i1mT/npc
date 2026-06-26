import { z } from "zod";
import { getDay, getLatestDay, listPublishedArticles, setStatus } from "@/db/sim";
import { dbAll, dbFirst, upsertSoulSnapshot } from "@/db/connection";
import { insertReview } from "@/db/feedback";
import { agentFactory } from "@/mastra/agent-factory";
import { say, startDailyCollaboration } from "@/mastra/collaboration";
import { createToolsForTurn } from "@/mastra/tools/npc-tools";
import { getTavilyToolsets } from "@/mastra/tools/tavily-mcp";
import { logEvent } from "@/simulation/mock-apis";
import { buildChatHistory, buildPublishContext, buildRuntimeForRun } from "./context";
import { settleRunDay, applyEditorNote, applyGrowthDecision, finishRunDay, buildEditorNotePrompt, buildGrowthPrompt } from "./finalizer";
import { runLlmStream, type LlmStreamEvent } from "./llm-stream";
import { buildTurnPrompt, extractMentions } from "./prompts";
import { chooseInitialAgentTurn, chooseNextAgentTurns } from "./scheduler";
import { createRun, createTurn, getActiveRun, getRun, getSnapshot, getTurn, listTurns, updateRun, updateTurn } from "./store";
import type { LlmTurn, RunSnapshot, StreamedDayRun } from "./types";

const MAX_TURNS = 14;
const TURN_TIMEOUT_MS = 120_000;
const EVOMAP_MAX_OUTPUT = 65_536;

const reviewSchema = z.object({
  info_density: z.number().min(0).max(10),
  readability: z.number().min(0).max(10),
  timeliness: z.number().min(0).max(10),
  uniqueness: z.number().min(0).max(10),
  ai_relevance: z.number().min(0).max(10),
  overall: z.number().min(0).max(10),
  comment: z.string().min(5).max(200),
});

export async function startStreamedDayRun(days = 1): Promise<RunSnapshot> {
  const active = await getActiveRun();
  if (active) return getSnapshot(active.id);
  const latest = await getLatestDay();
  const day = (latest?.day ?? 0) + 1;
  const runtime = await startDailyCollaboration(day);
  const queue = runtime.agents.map(a => a.handle);
  if (!queue.includes("editor-in-chief")) queue.unshift("editor-in-chief");
  const run = await createRun({ day, targetDays: days, threadId: runtime.threadId, runtimeId: runtime.runtimeId, agentQueue: queue });
  if (!run) throw new Error("Failed to create streamed day run.");
  await setStatus("running");
  await scheduleInitialTurns(run);
  return getSnapshot(run.id);
}

export async function getStreamedSimStatus() {
  const status = (await import("@/db/sim")).getStatus;
  const base = await status();
  const active = await getActiveRun();
  if (!active) return { ...base, runningDay: null, activeRunId: null };
  return { ...base, status: active.status, day: active.day, runningDay: active.day, activeRunId: active.id };
}

export async function stopActiveStreamedRun() {
  const active = await getActiveRun();
  if (active) await updateRun(active.id, { status: "paused" });
  await setStatus("paused");
  return getStreamedSimStatus();
}

export async function advanceRun(runId: string): Promise<RunSnapshot> {
  const run = await requireRun(runId);
  if (run.status !== "running") return getSnapshot(run.id);
  if ((await listTurns(run.id, "pending")).length > 0) return getSnapshot(run.id);
  if ((await listTurns(run.id, "running")).length > 0) return getSnapshot(run.id);

  if (run.phase === "chat") await advanceChat(run);
  else if (run.phase === "memory") await advanceMemory(run);
  else if (run.phase === "reader") await advanceReader(run);
  else if (run.phase === "settlement") await advanceSettlement(run);
  else if (run.phase === "editor_note") await advanceEditorNote(run);
  else if (run.phase === "growth") await advanceGrowth(run);
  return getSnapshot(run.id);
}

export async function streamTurn(turnId: string, onEvent: (event: LlmStreamEvent & { turn: LlmTurn }) => void) {
  const turn = await getTurn(turnId);
  if (!turn) throw new Error(`Turn not found: ${turnId}`);
  if (turn.status === "completed") return turn;
  const run = await requireRun(turn.runId);
  await updateTurn(turn.id, { status: "running" });
  const runtime = await buildRuntimeForRun(run);
  const agent = agentFactory.getMastraAgent(turn.agentId);
  const published = await buildPublishContext(turn.day);
  const toolsets = await buildToolsets(turn, runtime, published);
  let latestText = "";
  try {
    const result = await runLlmStream({
      agent,
      prompt: turn.prompt,
      options: {
        toolsets,
        memory: { thread: run.threadId, resource: `npc-agent-${turn.agentId}` },
        maxOutputTokens: EVOMAP_MAX_OUTPUT,
        abortSignal: AbortSignal.timeout(TURN_TIMEOUT_MS),
      },
      onEvent: (event) => {
        latestText = event.content;
        onEvent({ ...event, turn });
      },
    });
    const metadata = await applyTurnResult(run, turn, result.text);
    await updateTurn(turn.id, {
      status: "completed",
      outputText: result.text,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      metadata,
    });
    await updateRun(run.id, {
      totalInputTokens: run.totalInputTokens + result.usage.inputTokens,
      totalOutputTokens: run.totalOutputTokens + result.usage.outputTokens,
    });
    return getTurn(turn.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateTurn(turn.id, { status: "error", outputText: latestText, error: message });
    await updateRun(run.id, { status: "error", error: message });
    await setStatus("error");
    throw error;
  }
}

async function scheduleInitialTurns(run: StreamedDayRun) {
  const runtime = await buildRuntimeForRun(run);
  const history = await buildChatHistory(run.day, runtime.agents);
  for (const planned of chooseInitialAgentTurn(run.agentQueue)) {
    await createChatTurn(run, planned.handle, history, planned.mentionedBy);
  }
}

async function advanceChat(run: StreamedDayRun) {
  const published = await buildPublishContext(run.day);
  const completed = await listTurns(run.id, "completed");
  const chatTurns = completed.filter(turn => turn.kind === "agent_chat");
  if (published.done || chatTurns.length >= MAX_TURNS) {
    await updateRun(run.id, { phase: "memory" });
    await scheduleMemoryTurns(run);
    return;
  }
  const last = chatTurns.at(-1);
  const mentions = (last?.metadata?.mentions as string[] | undefined) ?? [];
  const plans = chooseNextAgentTurns({
    agentQueue: run.agentQueue,
    completedHandles: last ? [last.agentId] : [],
    mentionedHandles: mentions,
    mentionSource: last?.agentName,
  });
  const runtime = await buildRuntimeForRun(run);
  const history = await buildChatHistory(run.day, runtime.agents);
  for (const plan of plans) await createChatTurn(run, plan.handle, history, plan.mentionedBy);
}

async function advanceMemory(run: StreamedDayRun) {
  const memoryTurns = (await listTurns(run.id)).filter(turn => turn.kind === "memory_reflection");
  if (memoryTurns.length === 0) {
    await scheduleMemoryTurns(run);
    return;
  }
  await updateRun(run.id, { phase: "reader" });
  await scheduleReaderTurns(run);
}

async function advanceReader(run: StreamedDayRun) {
  const readerTurns = (await listTurns(run.id)).filter(turn => turn.kind === "reader_review");
  const articles = await listPublishedArticles(run.day);
  if (articles.length === 0) {
    await updateRun(run.id, { phase: "settlement" });
    return;
  }
  if (readerTurns.length === 0) {
    await scheduleReaderTurns(run);
    return;
  }
  await updateRun(run.id, { phase: "settlement" });
}

async function advanceSettlement(run: StreamedDayRun) {
  const runtime = await buildRuntimeForRun(run);
  const settled = await settleRunDay(run, runtime);
  await updateRun(run.id, { phase: "editor_note" });
  const articles = await listPublishedArticles(run.day);
  const prompt = buildEditorNotePrompt(run.day, articles.map(a => a.titleZh), settled.averageQuality, settled.state.dau, settled.state.reputation);
  await createTurnForAgent(run, "editor_note", "editor-in-chief", prompt, { settlementEventId: settled.settlementEventId });
}

async function advanceEditorNote(run: StreamedDayRun) {
  await updateRun(run.id, { phase: "growth" });
  const day = await getDay(run.day);
  const team = (await dbAll<{ display_name: string; role_template: string }>("SELECT display_name, role_template FROM employees WHERE status = 'active' ORDER BY joined_day, id"))
    .map(e => `${e.display_name}(${e.role_template})`).join("、");
  const prompt = buildGrowthPrompt(run.day, {
    dau: day?.dau ?? 0,
    reputation: day?.reputation ?? 0,
    capital: day?.capital ?? 0,
    monthlyRevenue: day?.adRevenue ?? 0,
  }, team);
  await createTurnForAgent(run, "growth_protocol", "editor-in-chief", prompt);
}

async function advanceGrowth(run: StreamedDayRun) {
  const runtime = await buildRuntimeForRun(run);
  const settlement = (await listTurns(run.id)).find(t => t.kind === "editor_note")?.metadata?.settlementEventId as string | undefined;
  await finishRunDay(run, runtime, settlement);
  await updateRun(run.id, { status: "completed", phase: "done" });
  await setStatus("idle");
}

async function scheduleMemoryTurns(run: StreamedDayRun) {
  const runtime = await buildRuntimeForRun(run);
  const history = await buildChatHistory(run.day, runtime.agents);
  const published = await buildPublishContext(run.day);
  for (const agent of runtime.agents) {
    const prompt = [
      `Day ${run.day} 工作结束。请作为 ${agent.displayName} 进行今日反思。`,
      `今日发布 ${published.count} 篇，标题：${published.titles.slice(0, 8).join("、") || "无"}`,
      "请思考今天值得沉淀的工作洞察。如需更新记忆，请调用 write_memory。",
      "",
      "【今日群聊】",
      history.slice(-4000),
    ].join("\n");
    await createTurnForAgent(run, "memory_reflection", agent.handle, prompt);
  }
}

async function scheduleReaderTurns(run: StreamedDayRun) {
  const articles = await listPublishedArticles(run.day);
  for (let i = 0; i < articles.length; i++) {
    const article = articles[i]!;
    await createTurnForAgent(run, "reader_review", "editor-in-chief", buildReaderPrompt(article), {
      articleId: article.id,
      articleTitle: article.titleZh,
      readerTurn: i + 1,
    });
  }
}

async function createChatTurn(run: StreamedDayRun, handle: string, history: string, mentionedBy?: string) {
  const runtime = await buildRuntimeForRun(run);
  const agent = runtime.agents.find(a => a.handle === handle) ?? runtime.agents[0];
  if (!agent) return;
  const prompt = buildTurnPrompt({ agentHandle: agent.handle, agentName: agent.displayName, roleTemplate: agent.roleTemplate, history, mentionedBy });
  await createTurnForAgent(run, "agent_chat", agent.handle, prompt, { mentionedBy });
}

async function createTurnForAgent(run: StreamedDayRun, kind: LlmTurn["kind"], handle: string, prompt: string, metadata?: Record<string, unknown>) {
  const currentRun = await requireRun(run.id);
  const runtime = await buildRuntimeForRun(run);
  const agent = runtime.agents.find(a => a.handle === handle) ?? runtime.agents[0];
  if (!agent) return;
  const turnNo = currentRun.nextTurnNo;
  await createTurn({ runId: run.id, day: run.day, kind, agentId: agent.handle, agentName: agent.displayName, roleTemplate: agent.roleTemplate, turnNo, prompt, metadata });
  await updateRun(run.id, { nextTurnNo: turnNo + 1 });
}

async function applyTurnResult(run: StreamedDayRun, turn: LlmTurn, text: string) {
  if (turn.kind === "agent_chat") return applyChatResult(run, turn, text);
  if (turn.kind === "memory_reflection") return applyMemoryResult(turn, text);
  if (turn.kind === "reader_review") return applyReaderResult(turn, text);
  if (turn.kind === "editor_note") {
    await applyEditorNote(turn.day, text);
    return turn.metadata ?? {};
  }
  await applyGrowthDecision(turn.day, text);
  return turn.metadata ?? {};
}

async function applyChatResult(run: StreamedDayRun, turn: LlmTurn, text: string) {
  const runtime = await buildRuntimeForRun(run);
  const mentions = extractMentions(text, runtime.agents);
  await say({
    day: turn.day,
    runtime,
    agentHandle: turn.agentId,
    eventType: "message",
    content: text,
    mentions: mentions.map(handle => {
      const agent = runtime.agents.find(a => a.handle === handle);
      return { agentId: handle, agentName: agent?.displayName ?? handle };
    }),
    extra: { mentions, turn: turn.turnNo, streamedTurnId: turn.id },
  });
  return { ...(turn.metadata ?? {}), mentions };
}

async function applyMemoryResult(turn: LlmTurn, text: string) {
  if (text.trim()) {
    await logEvent({
      day: turn.day,
      agentId: turn.agentId,
      agentName: turn.agentName,
      eventType: "thinking",
      content: text,
      metadata: { source: "memory-reflection", streamedTurnId: turn.id },
    });
  }
  const row = await dbFirst<{ id: string; soul: string | null; memory: string | null }>("SELECT id, soul, memory FROM employees WHERE agent_handle = ?", turn.agentId);
  if (row) await upsertSoulSnapshot(row.id, turn.day, row.soul ?? "", row.memory ?? "");
  return turn.metadata ?? {};
}

async function applyReaderResult(turn: LlmTurn, text: string) {
  const score = parseReview(text);
  const articleId = String(turn.metadata?.articleId ?? "");
  const articleTitle = String(turn.metadata?.articleTitle ?? "");
  if (!score || !articleId) return { ...(turn.metadata ?? {}), parseError: true };
  const content = `《${articleTitle}》\n总分 ${score.overall}/10 · 信息密度 ${score.info_density} · 可读性 ${score.readability} · 时效性 ${score.timeliness} · 独特性 ${score.uniqueness} · AI相关 ${score.ai_relevance}\n\n> ${score.comment}`;
  await insertReview({
    articleId,
    day: turn.day,
    scoreInfo: score.info_density,
    scoreRead: score.readability,
    scoreTimeliness: score.timeliness,
    scoreUnique: score.uniqueness,
    scoreAiRel: score.ai_relevance,
    scoreOverall: score.overall,
    comment: score.comment,
  });
  await logEvent({ day: turn.day, agentId: "reader-agent", agentName: "读者 Agent", eventType: "message", content, metadata: { source: "reader-agent", articleId, scores: score } });
  return { ...(turn.metadata ?? {}), scores: score };
}

async function buildToolsets(turn: LlmTurn, runtime: Awaited<ReturnType<typeof buildRuntimeForRun>>, published: Awaited<ReturnType<typeof buildPublishContext>>) {
  const ctx = { day: turn.day, agentHandle: turn.agentId, agentName: turn.agentName, roleTemplate: turn.roleTemplate, runtime, published };
  const agentDef = agentFactory.get(turn.agentId);
  const local = createToolsForTurn(ctx, agentDef.grantedToolNames);
  const tavily = turn.roleTemplate === "editor" ? await getTavilyToolsets() : {};
  return { ...local, ...tavily };
}

function buildReaderPrompt(article: Awaited<ReturnType<typeof listPublishedArticles>>[number]) {
  return [
    "你是 AGI Daily 的读者 Agent，代表中文 AI 行业专业读者视角。请认真阅读并给出评价。",
    `标题：${article.titleZh}`,
    `摘要：${article.summaryZh}`,
    `正文节选：${article.contentZh.slice(0, 800)}`,
    `标签：${article.tags.join("、")}`,
    "请从 info_density/readability/timeliness/uniqueness/ai_relevance/overall 六个维度给 0-10 分，并写 30-100 字中文评论。",
    "只输出 JSON：{\"info_density\":8,\"readability\":7,\"timeliness\":6,\"uniqueness\":5,\"ai_relevance\":9,\"overall\":7.5,\"comment\":\"...\"}",
  ].join("\n");
}

function parseReview(text: string): z.infer<typeof reviewSchema> | null {
  try {
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    return json ? reviewSchema.parse(JSON.parse(json)) : null;
  } catch {
    return null;
  }
}

async function requireRun(runId: string) {
  const run = await getRun(runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  return run;
}
