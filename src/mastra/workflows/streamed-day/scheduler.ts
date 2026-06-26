export type PlannedAgentTurn = {
  handle: string;
  mentionedBy?: string;
};

export function chooseInitialAgentTurn(agentQueue: string[]): PlannedAgentTurn[] {
  if (agentQueue.includes("editor-in-chief")) return [{ handle: "editor-in-chief", mentionedBy: undefined }];
  const first = agentQueue[0];
  return first ? [{ handle: first, mentionedBy: undefined }] : [];
}

export function chooseNextAgentTurns(input: {
  agentQueue: string[];
  completedHandles: string[];
  mentionedHandles: string[];
  mentionSource?: string;
}): PlannedAgentTurn[] {
  const validMentions = unique(input.mentionedHandles)
    .filter((handle) => input.agentQueue.includes(handle))
    .filter((handle) => !input.completedHandles.includes(handle));

  if (validMentions.length > 0) {
    return validMentions.map((handle) => ({ handle, mentionedBy: input.mentionSource }));
  }

  const lastHandle = input.completedHandles.at(-1) ?? input.agentQueue[0];
  if (!lastHandle || input.agentQueue.length === 0) return [];
  const idx = input.agentQueue.indexOf(lastHandle);
  const next = input.agentQueue[(idx + 1 + input.agentQueue.length) % input.agentQueue.length];
  return next ? [{ handle: next, mentionedBy: undefined }] : [];
}

function unique(values: string[]) {
  return [...new Set(values)];
}
