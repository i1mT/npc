import { createHash, randomUUID } from "node:crypto";
import { addLayerEvent } from "@/db/sim";
import type { EventType, SimEvent } from "@/lib/types";
import { agentFactory, type RuntimeAgentDef } from "@/mastra/agent-factory";
import { logEvent } from "@/simulation/mock-apis";
import type { z } from "zod";

type Mention = { agentId: string; agentName: string };
type ToolSummary = { tool: string; input: string; result: string; rawData?: unknown };
type UsageLike = {
  inputTokens?: number;
  outputTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  totalTokens?: number;
  total_tokens?: number;
};

const EVOMAP_GEMINI_MAX_OUTPUT_TOKENS = 65536;

export type CollaborationRuntime = {
  threadId: string;
  runtimeId: string;
  agents: RuntimeAgentDef[];
};

export type AgentStepResult<T> = {
  data: T;
  text: string;
  event: SimEvent;
  inputTokens: number;
  outputTokens: number;
  trace: Record<string, unknown>;
};

export async function startDailyCollaboration(day: number): Promise<CollaborationRuntime> {
  const agents = await agentFactory.loadActiveEmployees();
  await agentFactory.getMastraInstance();
  return {
    threadId: `day-${day}-mastra-${randomUUID().slice(0, 8)}`,
    runtimeId: agents[0]?.mastraRuntimeId ?? `mastra-runtime-${randomUUID().slice(0, 8)}`,
    agents,
  };
}

export async function say(input: {
  day: number;
  runtime: CollaborationRuntime;
  agentHandle: string;
  eventType?: EventType;
  content: string;
  replyTo?: SimEvent | string | null;
  mentions?: Mention[];
  toolSummary?: ToolSummary;
  extra?: Record<string, unknown>;
  costToken?: number;
  costYuan?: number;
}) {
  const agent = findRuntimeAgent(input.runtime, input.agentHandle);
  const replyTo = typeof input.replyTo === "string" ? input.replyTo : input.replyTo?.id ?? null;
  return logEvent({
    day: input.day,
    agentId: agent?.handle ?? input.agentHandle,
    agentName: agent?.displayName ?? input.agentHandle,
    eventType: input.eventType ?? "message",
    content: input.content,
    metadata: {
      source: "mastra-agent-runtime",
      mastraRuntimeId: input.runtime.runtimeId,
      mastraThreadId: input.runtime.threadId,
      mastraAgent: agent ? agentMeta(agent) : null,
      replyTo,
      mentions: input.mentions ?? [],
      toolSummary: input.toolSummary ?? null,
      messageFingerprint: fingerprint(`${input.runtime.threadId}:${agent?.handle}:${replyTo ?? ""}:${input.content}`),
      ...input.extra,
    },
    costToken: input.costToken,
    costYuan: input.costYuan,
  });
}

export async function runStructuredStep<T>(input: {
  agentHandle: string;
  prompt: string;
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  day: number;
  runtime: CollaborationRuntime;
  eventType?: EventType;
  replyTo?: SimEvent | null;
  mentions?: Mention[];
  toolSummary?: ToolSummary;
  stepKind?: string;
}): Promise<AgentStepResult<T>> {
  return runWithRetry(async () => {
    const agent = requireRuntimeAgent(input.runtime, input.agentHandle);
    const traceId = `mastra-step-${randomUUID()}`;
    const output = await agentFactory.getMastraAgent(agent.handle).generate(jsonOnlyPrompt(input.prompt, input.stepKind), {
      memory: memoryOption(input.runtime, agent.handle),
      maxOutputTokens: EVOMAP_GEMINI_MAX_OUTPUT_TOKENS,
      abortSignal: AbortSignal.timeout(timeoutForStep(input.stepKind)),
    } as never);
    const usage = extractUsage(output);
    const text = extractText(output);
    if (!text) throw new Error(`LLM structured response text was empty: ${summarizeOutput(output)}`);
    const data = input.schema.parse(parseStructuredText<T>(text));
    const event = await say({
      day: input.day,
      runtime: input.runtime,
      agentHandle: agent.handle,
      eventType: input.eventType ?? "message",
      content: text,
      replyTo: input.replyTo,
      mentions: input.mentions,
      toolSummary: input.toolSummary,
      costToken: usage.inputTokens + usage.outputTokens,
      extra: {
        stepKind: input.stepKind,
        mastraExecution: executionMeta(traceId, input.runtime, agent.handle),
        stepResult: data as Record<string, unknown>,
        usage,
      },
    });
    return {
      data,
      text,
      event,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      trace: buildMastraTrace(input.runtime, agent.handle, traceId, event.id),
    };
  }, () => recordStepError(input));
}

export async function runTextStep(input: {
  agentHandle: string;
  prompt: string;
  day: number;
  runtime: CollaborationRuntime;
  eventType?: EventType;
  replyTo?: SimEvent | null;
  mentions?: Mention[];
  toolSummary?: ToolSummary;
  stepKind?: string;
}): Promise<Omit<AgentStepResult<string>, "data">> {
  return runWithRetry(async () => {
    const agent = requireRuntimeAgent(input.runtime, input.agentHandle);
    const traceId = `mastra-step-${randomUUID()}`;
    const output = await agentFactory.getMastraAgent(agent.handle).generate(input.prompt, {
      memory: memoryOption(input.runtime, agent.handle),
      maxOutputTokens: EVOMAP_GEMINI_MAX_OUTPUT_TOKENS,
      abortSignal: AbortSignal.timeout(timeoutForStep(input.stepKind)),
    } as never);
    const usage = extractUsage(output);
    const text = extractText(output);
    const event = await say({
      day: input.day,
      runtime: input.runtime,
      agentHandle: agent.handle,
      eventType: input.eventType ?? "message",
      content: text,
      replyTo: input.replyTo,
      mentions: input.mentions,
      toolSummary: input.toolSummary,
      costToken: usage.inputTokens + usage.outputTokens,
      extra: {
        stepKind: input.stepKind,
        mastraExecution: executionMeta(traceId, input.runtime, agent.handle),
        usage,
      },
    });
    return {
      text,
      event,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      trace: buildMastraTrace(input.runtime, agent.handle, traceId, event.id),
    };
  }, () => recordStepError(input));
}

export function buildMastraTrace(runtime: CollaborationRuntime, agentHandle: string, traceId: string, sourceEventId?: string) {
  const agent = findRuntimeAgent(runtime, agentHandle);
  return {
    source: "mastra-agent-runtime",
    mastraRuntimeId: runtime.runtimeId,
    mastraThreadId: runtime.threadId,
    mastraAgent: agent ? agentMeta(agent) : null,
    mastraExecution: {
      method: "Agent.generate",
      traceId,
      sourceEventId,
    },
  };
}

function findRuntimeAgent(runtime: CollaborationRuntime, agentHandle: string) {
  return runtime.agents.find((item) => item.handle === agentHandle) ?? runtime.agents[0];
}

function requireRuntimeAgent(runtime: CollaborationRuntime, agentHandle: string) {
  const agent = findRuntimeAgent(runtime, agentHandle);
  if (!agent) throw new Error("No Mastra agents loaded.");
  return agent;
}

function memoryOption(runtime: CollaborationRuntime, agentHandle: string) {
  return {
    thread: runtime.threadId,
    resource: `npc-agent-${agentHandle}`,
  };
}

function extractText(output: unknown) {
  const record = output as {
    text?: string;
    object?: unknown;
    steps?: { text?: string; content?: { type?: string; text?: string }[] }[];
  };
  const text = record.text;
  if (typeof text === "string" && text.trim()) return text.trim();
  for (const step of record.steps ?? []) {
    if (typeof step.text === "string" && step.text.trim()) return step.text.trim();
    for (const part of step.content ?? []) {
      if (part.type === "text" && typeof part.text === "string" && part.text.trim()) return part.text.trim();
    }
  }
  const object = record.object;
  return object ? JSON.stringify(object) : "";
}

function parseStructuredText<T>(text: string): T {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`LLM structured response did not contain a JSON object: ${candidate.slice(0, 120)}`);
  }
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}

function jsonOnlyPrompt(prompt: string, stepKind?: string) {
  return [
    prompt,
    "",
    "输出格式要求：只输出一个合法 JSON 对象，不要 Markdown，不要代码块，不要解释文字。",
    `JSON 结构：${schemaHint(stepKind)}`,
  ].join("\n");
}

function schemaHint(stepKind?: string) {
  if (stepKind === "agenda") {
    return '{"focusTopics":["..."],"blockedTopics":["..."],"reasoning":"...","note":"..."}';
  }
  if (stepKind === "draft" || stepKind === "revise") {
    return '{"articles":[{"sourceId":"...","titleZh":"...","summaryZh":"...","contentZh":"...","qualityScore":8,"qualityReason":"...","tags":["..."]}]}';
  }
  if (stepKind?.startsWith("review")) {
    return '{"decision":"approve","reason":"...","averageScore":8,"articleFeedback":[{"sourceId":"...","issue":"..."}]}';
  }
  if (stepKind === "editor-note") return '{"note":"..."}';
  if (stepKind === "growth-check") return '{"status":"maintain","reason":"...","newAgentRole":"growth","newAgentName":"..."}';
  if (stepKind === "weekly-report") return '{"summary":"...","majorDecisions":["..."],"pendingItems":["..."],"risks":["..."]}';
  if (stepKind === "board-directive") return '{"directive":"MAINTAIN","reason":"...","detail":"..."}';
  return '{"result":"..."}';
}

function timeoutForStep(stepKind?: string) {
  if (stepKind === "draft" || stepKind === "revise") return 120000;
  if (stepKind === "weekly-report") return 90000;
  return 60000;
}

function extractUsage(output: unknown) {
  const usage = (output as { usage?: UsageLike }).usage ?? {};
  const inputTokens = usage.inputTokens ?? usage.input_tokens ?? usage.promptTokens ?? usage.prompt_tokens ?? 0;
  const outputTokens = usage.outputTokens ?? usage.output_tokens ?? usage.completionTokens ?? usage.completion_tokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: usage.totalTokens ?? usage.total_tokens ?? inputTokens + outputTokens,
  };
}

async function runWithRetry<T>(operation: () => Promise<T>, onError: (error: unknown) => void): Promise<T> {
  try {
    return await operation();
  } catch {
    try {
      return await operation();
    } catch (error) {
      onError(error);
      throw error;
    }
  }
}

function recordStepError(input: { day: number; runtime: CollaborationRuntime; agentHandle: string; stepKind?: string }) {
  const agent = findRuntimeAgent(input.runtime, input.agentHandle);
  return (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    void addLayerEvent({
      day: input.day,
      actorId: agent?.handle ?? input.agentHandle,
      actorName: agent?.displayName ?? input.agentHandle,
      layer: "work",
      eventType: "error",
      action: "llm_step_error",
      content: message,
      payload: {
        stepKind: input.stepKind,
        mastraThreadId: input.runtime.threadId,
      },
    });
  };
}

function executionMeta(traceId: string, runtime: CollaborationRuntime, agentHandle: string) {
  return {
    method: "Agent.generate",
    traceId,
    resourceId: `npc-agent-${agentHandle}`,
    threadId: runtime.threadId,
  };
}

function agentMeta(agent: RuntimeAgentDef) {
  return {
    handle: agent.handle,
    roleTemplate: agent.roleTemplate,
    instructionHash: agent.instructionHash,
    tools: agent.tools,
  };
}

function fingerprint(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function summarizeOutput(output: unknown) {
  const record = output as {
    finishReason?: unknown;
    usage?: unknown;
    steps?: { finishReason?: unknown; usage?: unknown; text?: string; content?: unknown }[];
  };
  return JSON.stringify({
    finishReason: record.finishReason,
    usage: record.usage,
    steps: (record.steps ?? []).map((step) => ({
      finishReason: step.finishReason,
      usage: step.usage,
      hasText: Boolean(step.text),
      contentType: Array.isArray(step.content) ? step.content.map((part) => typeof part === "object" && part ? (part as { type?: unknown }).type : typeof part) : typeof step.content,
    })),
  }).slice(0, 1200);
}
