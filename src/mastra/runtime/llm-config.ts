export function getLLMConfig() {
  return {
    apiBase: process.env.EVOMAP_API_BASE || process.env.OPENAI_BASE_URL || "https://api.evomap.ai/v1",
    apiKey: process.env.EVOMAP_API_KEY || process.env.OPENAI_API_KEY || null,
    model: process.env.NPC_LLM_MODEL || "evomap-gemini-3.1-pro-preview",
  };
}
