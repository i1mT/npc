export const localMastraModel = {
  specificationVersion: "v2",
  provider: "npc-local",
  modelId: "npc-deterministic-agent",
  supportedUrls: {},
  async doGenerate(options: { prompt: unknown }) {
    const promptText = JSON.stringify(options.prompt);
    const context = extractContext(promptText);
    const text = context?.responseText ?? "已执行当前 Mastra Agent 步骤。";
    return {
      content: [{ type: "text", text }],
      finishReason: "stop",
      usage: {
        inputTokens: Math.max(1, Math.round(promptText.length / 4)),
        outputTokens: Math.max(1, Math.round(text.length / 4)),
        totalTokens: Math.max(2, Math.round((promptText.length + text.length) / 4)),
      },
      request: { body: { prompt: options.prompt } },
      response: { id: context?.traceId, timestamp: new Date(), modelId: "npc-deterministic-agent", body: { text, context } },
      warnings: [],
    };
  },
  async doStream(options: { prompt: unknown }) {
    const generated = await this.doGenerate(options);
    const text = generated.content.find((part) => part.type === "text")?.text ?? "";
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "text-start", id: "local-text" });
        controller.enqueue({ type: "text-delta", id: "local-text", delta: text });
        controller.enqueue({ type: "text-end", id: "local-text" });
        controller.enqueue({ type: "finish", finishReason: generated.finishReason, usage: generated.usage });
        controller.close();
      },
    });
    return {
      stream,
      request: generated.request,
      response: generated.response,
      warnings: [],
    };
  },
} as const;

function extractContext(promptText: string) {
  const marker = "NPC_AGENT_CONTEXT:";
  const start = promptText.indexOf(marker);
  if (start < 0) return null;
  const raw = promptText.slice(start + marker.length);
  const match = raw.match(/\{.*\}/s);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as { responseText?: string; traceId?: string };
  } catch {
    return null;
  }
}
