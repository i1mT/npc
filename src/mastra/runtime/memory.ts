import { D1Store } from "@mastra/cloudflare-d1";
import { Memory } from "@mastra/memory";
import { getDb } from "@/db/connection";

let cachedStorage: D1Store | null = null;
let cachedMemory: Memory | null = null;

export async function getMastraStorage() {
  if (!cachedStorage) {
    cachedStorage = new D1Store({
      id: "npc-agent-memory",
      binding: await getDb(),
    });
  }
  return cachedStorage;
}

export async function getAgentMemory() {
  if (!cachedMemory) {
    cachedMemory = new Memory({
      storage: await getMastraStorage(),
      options: {
        lastMessages: 20,
        semanticRecall: false,
      },
    });
  }
  return cachedMemory;
}
