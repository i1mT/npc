import assert from "node:assert/strict";
import { chooseInitialAgentTurn, chooseNextAgentTurns } from "@/mastra/workflows/streamed-day/scheduler";

const queue = ["editor-in-chief", "editor", "growth"];

const initial = chooseInitialAgentTurn(queue);
assert.deepEqual(initial, [{ handle: "editor-in-chief", mentionedBy: undefined }]);

const mentioned = chooseNextAgentTurns({
  agentQueue: queue,
  completedHandles: ["editor-in-chief"],
  mentionedHandles: ["editor", "growth", "unknown", "editor-in-chief"],
  mentionSource: "总编 Agent",
});
assert.deepEqual(mentioned, [
  { handle: "editor", mentionedBy: "总编 Agent" },
  { handle: "growth", mentionedBy: "总编 Agent" },
]);

const rotated = chooseNextAgentTurns({
  agentQueue: queue,
  completedHandles: ["editor"],
  mentionedHandles: [],
});
assert.deepEqual(rotated, [{ handle: "growth", mentionedBy: undefined }]);

console.log("streamed day scheduler checks passed");
