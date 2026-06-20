import { LibSQLStore, LibSQLVector } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import { getEvomapEmbeddingModel } from "@/mastra/runtime/evomap-model";

const memoryDbUrl = process.env.NPC_MEMORY_DB_URL ?? "file:./memory.db";
const embeddingModel = process.env.NPC_EMBEDDING_MODEL;

export const mastraStorage = new LibSQLStore({
  id: "npc-agent-memory",
  url: memoryDbUrl,
});

export const agentMemory = new Memory({
  storage: mastraStorage,
  ...(embeddingModel ? {
    vector: new LibSQLVector({
      id: "npc-agent-memory-vector",
      url: memoryDbUrl,
    }),
    embedder: getEvomapEmbeddingModel(embeddingModel),
  } : {}),
  options: {
    lastMessages: 20,
    semanticRecall: embeddingModel ? {
      topK: 5,
      messageRange: {
        before: 2,
        after: 2,
      },
    } : false,
  },
});
