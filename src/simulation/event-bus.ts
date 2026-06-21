import type { DayState, SimEvent, SimStatus } from "@/lib/types";

export type SimStatusSnapshot = {
  day: number;
  status: SimStatus;
  state: DayState;
  runningDay: number | null;
  reason?: string;
};

export type AgentStreamUpdate = {
  streamId: string;
  day: number;
  agentId: string;
  agentName: string;
  eventType: SimEvent["eventType"];
  content: string;
  delta: string;
  status: "start" | "delta" | "done" | "error";
  turn?: number;
};

export type SimStreamMessage =
  | { type: "event"; event: SimEvent }
  | { type: "status"; status: SimStatusSnapshot }
  | { type: "agent-stream"; update: AgentStreamUpdate };

type Listener = (message: SimStreamMessage) => void;
type EventBusState = {
  listeners: Set<Listener>;
  latestStatus: SimStatusSnapshot | null;
  activeAgentStreams: Map<string, AgentStreamUpdate>;
};

const globalForEventBus = globalThis as unknown as { __npcEventBus?: EventBusState };
const state = globalForEventBus.__npcEventBus ?? {
  listeners: new Set<Listener>(),
  latestStatus: null,
  activeAgentStreams: new Map<string, AgentStreamUpdate>(),
};
globalForEventBus.__npcEventBus = state;

export function subscribe(listener: Listener) {
  state.listeners.add(listener);
  queueMicrotask(() => {
    if (!state.listeners.has(listener)) return;
    if (state.latestStatus) listener({ type: "status", status: state.latestStatus });
    for (const update of state.activeAgentStreams.values()) {
      listener({ type: "agent-stream", update });
    }
  });
  return () => state.listeners.delete(listener);
}

export function emit(event: SimEvent) {
  emitMessage({ type: "event", event });
}

export function emitStatus(status: SimStatusSnapshot) {
  state.latestStatus = status;
  emitMessage({ type: "status", status });
}

export function emitAgentStream(update: AgentStreamUpdate) {
  if (update.status === "done" || update.status === "error") {
    emitMessage({ type: "agent-stream", update });
    state.activeAgentStreams.delete(update.streamId);
    return;
  }
  state.activeAgentStreams.set(update.streamId, update);
  emitMessage({ type: "agent-stream", update });
}

function emitMessage(message: SimStreamMessage) {
  for (const listener of state.listeners) {
    listener(message);
  }
}
