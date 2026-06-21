import { createOpenAI } from "@ai-sdk/openai";
import { getLLMConfig } from "@/mastra/runtime/llm-config";

export function getEvomapModel(modelId = getLLMConfig().model) {
  return createEvomapClient().chat(modelId);
}

export function getEvomapEmbeddingModel(modelId = process.env.NPC_EMBEDDING_MODEL ?? "text-embedding-3-small") {
  return createEvomapClient().embedding(modelId);
}

function createEvomapClient() {
  const config = getLLMConfig();
  return createOpenAI({
    baseURL: config.apiBase,
    apiKey: config.apiKey ?? "",
  });
}
