type StreamableAgent = {
  stream: (prompt: string, options: unknown) => Promise<{
    fullStream?: AsyncIterable<unknown> | ReadableStream<unknown>;
    textStream?: AsyncIterable<string> | ReadableStream<string>;
    text?: Promise<string> | string;
    totalUsage?: Promise<Record<string, number>>;
    usage?: Record<string, number>;
  }>;
  generate: (prompt: string, options: unknown) => Promise<unknown>;
};

type StreamChunk = {
  type?: string;
  payload?: { text?: string; delta?: string; content?: string };
  text?: string;
  delta?: string;
};

export type LlmStreamEvent =
  | { status: "start"; content: string; delta: string }
  | { status: "delta"; content: string; delta: string }
  | { status: "done"; content: string; delta: string }
  | { status: "error"; content: string; delta: string };

export async function runLlmStream(input: {
  agent: unknown;
  prompt: string;
  options: unknown;
  onEvent: (event: LlmStreamEvent) => void;
}) {
  const agent = input.agent as Partial<StreamableAgent>;
  input.onEvent({ status: "start", content: "", delta: "" });

  if (typeof agent.stream !== "function") {
    if (typeof agent.generate !== "function") throw new Error("Mastra agent has no stream or generate method.");
    const response = await agent.generate(input.prompt, input.options);
    const text = extractText(response);
    input.onEvent({ status: "done", content: text, delta: "" });
    return { text, usage: extractUsage(response) };
  }

  try {
    const output = await agent.stream(input.prompt, input.options);
    let text = "";
    if (output.fullStream) {
      for await (const chunk of readUnknownStream(output.fullStream)) {
        const delta = getTextDelta(chunk);
        if (!delta) continue;
        text += delta;
        input.onEvent({ status: "delta", content: text, delta });
      }
    } else if (output.textStream) {
      for await (const delta of readTextStream(output.textStream)) {
        if (!delta) continue;
        text += delta;
        input.onEvent({ status: "delta", content: text, delta });
      }
    }
    if (!text && output.text) text = typeof output.text === "string" ? output.text : await output.text;
    const usage = output.totalUsage ? extractUsage(await output.totalUsage.catch(() => ({}))) : extractUsage(output.usage);
    input.onEvent({ status: "done", content: text, delta: "" });
    return { text: text.trim(), usage };
  } catch (error) {
    input.onEvent({ status: "error", content: "", delta: "" });
    throw error;
  }
}

export function extractText(output: unknown): string {
  const record = output as { text?: string; object?: unknown; steps?: { text?: string; content?: { type?: string; text?: string }[] }[] };
  if (typeof record.text === "string" && record.text.trim()) return record.text.trim();
  for (const step of record.steps ?? []) {
    if (typeof step.text === "string" && step.text.trim()) return step.text.trim();
    for (const part of step.content ?? []) {
      if (part.type === "text" && typeof part.text === "string" && part.text.trim()) return part.text.trim();
    }
  }
  return record.object ? JSON.stringify(record.object) : "";
}

export function extractUsage(output: unknown) {
  const usage = output as Record<string, number> | undefined;
  return {
    inputTokens: usage?.inputTokens ?? usage?.promptTokens ?? usage?.input_tokens ?? usage?.prompt_tokens ?? 0,
    outputTokens: usage?.outputTokens ?? usage?.completionTokens ?? usage?.output_tokens ?? usage?.completion_tokens ?? 0,
  };
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

function getTextDelta(chunk: unknown) {
  const c = chunk as StreamChunk;
  if (c.type !== "text-delta" && !String(c.type ?? "").endsWith("text-delta")) return "";
  return c.payload?.text ?? c.payload?.delta ?? c.payload?.content ?? c.text ?? c.delta ?? "";
}
