export type StreamedRunStatus = "running" | "completed" | "paused" | "error";
export type StreamedRunPhase = "chat" | "memory" | "reader" | "settlement" | "editor_note" | "growth" | "done";
export type LlmTurnKind = "agent_chat" | "memory_reflection" | "reader_review" | "editor_note" | "growth_protocol";
export type LlmTurnStatus = "pending" | "running" | "completed" | "error";

export type StreamedDayRun = {
  id: string;
  day: number;
  status: StreamedRunStatus;
  phase: StreamedRunPhase;
  targetDays: number;
  threadId: string;
  runtimeId: string;
  agentQueue: string[];
  nextTurnNo: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LlmTurn = {
  id: string;
  runId: string;
  day: number;
  kind: LlmTurnKind;
  status: LlmTurnStatus;
  agentId: string;
  agentName: string;
  roleTemplate: string;
  turnNo: number;
  prompt: string;
  mentionedBy: string | null;
  outputText: string | null;
  inputTokens: number;
  outputTokens: number;
  metadata: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RunSnapshot = {
  run: StreamedDayRun;
  pendingTurns: LlmTurn[];
  events: Array<{
    id: string;
    day: number;
    seq: number;
    agentId: string;
    agentName: string;
    eventType: string;
    content: string;
    metadata: Record<string, unknown> | null;
    createdAt: string;
  }>;
};
